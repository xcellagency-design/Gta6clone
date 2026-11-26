import type { EventBus } from '../core/EventBus';
import type { Physics } from '../core/Physics';
import { Rng } from '../core/rng';
import type { Environment } from '../environment/Environment';
import type { TrafficCar, TrafficSim } from '../traffic/TrafficSim';
import type { Vehicle, VehicleControls } from '../vehicles/Vehicle';
import type { VehicleManager } from '../vehicles/VehicleManager';
import { BLOCK, districtAnchors, nearestRoadPoint } from '../world/CityPlan';

/**
 * Crime, wanted level and police response.
 *
 * The police act only on what they know. A crime matters when somebody reports it — a witness
 * who phones it in, or an officer who sees it. Units are sent to the *last known position*, not
 * to the player. They find the player only by seeing them; lose sight and they search a growing
 * area around where the player was last seen, then give up.
 */

export type WantedState = 'clear' | 'pursuit' | 'search';

const HEAT: Record<string, number> = { collision: 0.7, vehicle_theft: 1.6, carjack: 2.6, hit_pedestrian: 3.2, reckless: 0.6, assault_officer: 3.2, evading: 1 };
const THRESHOLDS = [1, 3, 6, 10, 15];

interface Unit {
  car: TrafficCar | null;
  vehicle: Vehicle | null;
  kind: 'patrol' | 'block';
  stuck: number;
  reverse: number;
  searchT: number;
  sawPlayer: number;
}

export interface WantedSnapshot { notoriety: number; busts: number; escapes: number; crimesReported: number }

export class WantedSystem {
  level = 0;
  heat = 0;
  state: WantedState = 'clear';
  /** Where the police believe the player is. Never read from the player directly. */
  lastKnown: { x: number; z: number } | null = null;
  unseen = 0;
  searchRadius = 0;
  /** The vehicle the police have a description of (0 = on foot, −1 = unknown). */
  knownVehicle = -1;
  units: Unit[] = [];
  /** Lifetime criminal reputation; persists across saves and speeds up the response. */
  notoriety = 0;
  busts = 0;
  escapes = 0;
  crimesReported = 0;
  seen = false;
  private rng: Rng;
  private dispatchTimer = 0;
  private sightTimer = 0;
  private bustTimer = 0;
  private blockTimer = 0;
  private patrolTimer = 20;
  private recklessTimer = 0;
  enabled = true;
  /** Set by the economy: takes the fine and returns what was actually paid. */
  chargeFine: (amount: number) => number = () => 0;
  cashOnHand: () => number = () => 0;
  onBusted: (() => void) | null = null;

  constructor(
    private physics: Physics, private env: Environment, private traffic: TrafficSim, private vehicles: VehicleManager, private bus: EventBus,
    private player: () => { x: number; z: number; speed: number; vehicle: Vehicle | null }, seed: number,
  ) {
    this.rng = new Rng(seed ^ 0xc0b5);
    bus.on('crime.reported', (c) => this.onReport(c));
    bus.on('crime.committed', (c) => this.officerWitness(c));
  }

  // ── knowledge ───────────────────────────────────────────────────────────

  private los(x: number, z: number, tx: number, tz: number, range: number): boolean {
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d < 3) return true;
    return this.physics.raycastWorld(x, 1.3, z, dx / d, 0, dz / d, d - 1.5) === null;
  }

  private policePositions(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of this.traffic.cars) if (c.police) out.push(c);
    for (const u of this.units) if (u.vehicle) out.push({ x: u.vehicle.x, z: u.vehicle.z });
    return out;
  }

  /** An officer who sees a crime reports it on the spot. */
  private officerWitness(c: { type: string; x: number; z: number; severity: number }): void {
    if (!this.enabled) return;
    const range = this.env.visibility();
    for (const p of this.policePositions()) {
      if (this.los(p.x, p.z, c.x, c.z, range)) { this.bus.emit('crime.reported', { ...c, by: 'police' }); return; }
    }
  }

  private onReport(c: { type: string; x: number; z: number; severity: number; by: string }): void {
    if (!this.enabled) return;
    this.crimesReported++;
    this.heat += (HEAT[c.type] ?? 1) * (c.type === 'collision' ? c.severity : 1);
    this.lastKnown = { x: c.x, z: c.z };
    const before = this.level;
    this.level = THRESHOLDS.filter((t) => this.heat >= t).length;
    if (this.level > 0 && this.state === 'clear') { this.state = 'search'; this.searchRadius = 70; this.unseen = 0; this.dispatchTimer = Math.max(0.5, 3 - this.notoriety * 0.05); }
    if (this.state === 'search') this.unseen = Math.min(this.unseen, 4);
    if (this.level !== before) {
      this.notoriety += this.level - before;
      this.bus.emit('wanted.changed', { level: this.level, previous: before });
    }
  }

  private clear(reason: 'escaped' | 'busted' | 'paid'): void {
    const prev = this.level;
    this.level = 0; this.heat = 0; this.state = 'clear'; this.lastKnown = null; this.unseen = 0; this.seen = false; this.knownVehicle = -1; this.bustTimer = 0;
    for (const u of this.units) {
      if (u.car) { u.car.goal = null; u.car.siren = false; }
      if (u.vehicle) { this.vehicles.ai.delete(u.vehicle); u.vehicle.occupied = false; this.vehicles.transient.add(u.vehicle); }
    }
    this.units = [];
    if (prev > 0) {
      this.bus.emit('wanted.changed', { level: 0, previous: prev });
      this.bus.emit('wanted.cleared', { reason });
    }
  }

  /** Bribe, respray or story event. */
  clearByPayment(): void {
    this.clear('paid');
  }

  // ── response ────────────────────────────────────────────────────────────

  private dispatch(): void {
    if (!this.lastKnown) return;
    const lk = this.lastKnown;
    // Prefer a patrol car that is already nearby.
    let best: TrafficCar | null = null, bd = 420;
    for (const c of this.traffic.cars) {
      if (!c.police || this.units.some((u) => u.car === c)) continue;
      const d = Math.hypot(c.x - lk.x, c.z - lk.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) {
      // Otherwise one comes in from outside the area, on a real road.
      for (let tries = 0; tries < 12 && !best; tries++) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(210, 320);
        const kx = Math.round((lk.x + Math.sin(a) * r) / BLOCK), kz = Math.round((lk.z + Math.cos(a) * r) / BLOCK);
        best = this.traffic.spawnAt(kx, kz, this.rng.int(0, 3), this.rng.range(20, 60), 'police');
      }
    }
    if (!best) return;
    best.goal = { ...lk }; best.siren = true;
    this.units.push({ car: best, vehicle: null, kind: 'patrol', stuck: 0, reverse: 0, searchT: 0, sawPlayer: 0 });
  }

  private roadblock(pl: { x: number; z: number; vehicle: Vehicle | null }): void {
    const v = pl.vehicle;
    if (!v) return;
    const lv = v.body.linvel(), sp = Math.hypot(lv.x, lv.z);
    if (sp < 10) return;
    const ahead = nearestRoadPoint(pl.x + (lv.x / sp) * 230, pl.z + (lv.z / sp) * 230);
    if (!ahead) return;
    // Parked across the carriageway.
    const heading = ahead.vertical ? Math.PI / 2 : 0;
    const car = this.vehicles.spawn('police', ahead.x, 0.15, ahead.z, heading);
    car.owner = 'police';
    this.units.push({ car: null, vehicle: car, kind: 'block', stuck: 0, reverse: 0, searchT: 0, sawPlayer: 0 });
  }

  /** Steering and throttle for an officer chasing a point. */
  private drive(u: Unit, v: Vehicle, tx: number, tz: number, dt: number, boxIn: boolean): VehicleControls {
    const h = v.heading();
    const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
    let ang = Math.atan2(dx, dz) - h;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    if (u.reverse > 0) { u.reverse -= dt; return { throttle: -1, steer: ang > 0 ? 1 : -1, handbrake: false }; }
    u.stuck = Math.abs(v.speed) < 0.6 && d > 9 ? u.stuck + dt : 0;
    if (u.stuck > 1.8) { u.stuck = 0; u.reverse = 1.3; }
    if (boxIn && d < 7) return { throttle: 0, steer: 0, handbrake: true };
    // Positive heading error means the target is to the left; positive steer input is right.
    const steer = Math.max(-1, Math.min(1, -ang * 2.2));
    const sharp = Math.abs(ang) > 0.9;
    const tooFast = v.speed > (sharp ? 9 : 16 + d * 0.25);
    return { throttle: tooFast ? -0.5 : sharp ? 0.55 : 1, steer, handbrake: false };
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const pl = this.player();
    const vis = this.env.visibility();

    // Ambient patrols: now and then a cruiser joins the traffic.
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0) {
      this.patrolTimer = 35;
      const have = this.traffic.cars.filter((c) => c.police).length;
      if (have < 1 + Math.min(2, Math.floor(this.notoriety / 6)) && this.traffic.cars.length > 4) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(200, 300);
        this.traffic.spawnAt(Math.round((pl.x + Math.sin(a) * r) / BLOCK), Math.round((pl.z + Math.cos(a) * r) / BLOCK), this.rng.int(0, 3), 40, 'police');
      }
    }

    // What the police can see right now.
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.2;
      const current = pl.vehicle ? pl.vehicle.id : 0;
      // A changed vehicle, unseen, has to be recognised up close.
      const range = vis * (this.knownVehicle === current || this.knownVehicle === -1 ? 1.25 : 0.5);
      this.seen = false;
      if (this.level > 0) {
        for (const p of this.policePositions()) if (this.los(p.x, p.z, pl.x, pl.z, range)) { this.seen = true; break; }
        if (this.seen) this.knownVehicle = current;
      } else if (this.recklessTimer <= 0 && pl.vehicle && Math.abs(pl.vehicle.speed) > 30) {
        // Tearing past a patrol car is itself an offence.
        for (const p of this.policePositions()) {
          if (this.los(p.x, p.z, pl.x, pl.z, vis * 0.6)) { this.recklessTimer = 25; this.bus.emit('crime.reported', { type: 'reckless', x: pl.x, z: pl.z, severity: 1, by: 'police' }); break; }
        }
      }
    }
    this.recklessTimer = Math.max(0, this.recklessTimer - dt);
    if (this.level === 0) return;

    if (this.seen) {
      this.state = 'pursuit'; this.unseen = 0; this.lastKnown = { x: pl.x, z: pl.z }; this.searchRadius = 60;
      // Running from a pursuit keeps the heat on.
      if (pl.speed > 12) {
        this.heat += dt * 0.035 * this.level;
        const lvl = THRESHOLDS.filter((t) => this.heat >= t).length;
        if (lvl > this.level) { this.bus.emit('wanted.changed', { level: lvl, previous: this.level }); this.notoriety += lvl - this.level; this.level = lvl; }
      }
    } else {
      this.unseen += dt;
      if (this.state === 'pursuit' && this.unseen > 5) { this.state = 'search'; this.searchRadius = 60; }
      if (this.state === 'search') this.searchRadius = Math.min(280, this.searchRadius + dt * 6);
      const switched = this.knownVehicle !== -1 && this.knownVehicle !== (pl.vehicle ? pl.vehicle.id : 0);
      const patience = (18 + 9 * this.level) * (switched ? 0.55 : 1);
      if (this.unseen > patience) { this.escapes++; this.clear('escaped'); return; }
    }

    // Units on the way.
    this.dispatchTimer -= dt;
    const want = Math.min(6, this.level + 1);
    if (this.units.filter((u) => u.kind === 'patrol').length < want && this.dispatchTimer <= 0) {
      this.dispatch();
      this.dispatchTimer = Math.max(1.5, 5 - this.notoriety * 0.1);
    }
    this.blockTimer -= dt;
    if (this.level >= 3 && this.state === 'pursuit' && this.blockTimer <= 0) { this.blockTimer = 26; this.roadblock(pl); }

    let close = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const goal = this.state === 'pursuit' && this.lastKnown ? this.lastKnown : null;
      if (u.car) {
        if (!this.traffic.cars.includes(u.car)) { this.units.splice(i, 1); continue; } // retired or wrecked
        if (goal) u.car.goal = { ...goal };
        else {
          // Search pattern: points inside the search circle.
          u.searchT -= dt;
          const g = u.car.goal;
          if (!g || u.searchT <= 0 || Math.hypot(u.car.x - g.x, u.car.z - g.z) < 30) {
            const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0, this.searchRadius);
            u.car.goal = { x: this.lastKnown!.x + Math.sin(a) * r, z: this.lastKnown!.z + Math.cos(a) * r };
            u.searchT = 12;
          }
        }
        const d = Math.hypot(u.car.x - pl.x, u.car.z - pl.z);
        if (d < 9) close = true;
        // Close and in sight: leave the lane and give chase for real.
        if (this.seen && d < 60 && this.level >= 1 && pl.vehicle) {
          const v = this.traffic.convert(u.car);
          this.vehicles.transient.delete(v);
          v.owner = 'police'; v.occupied = true;
          u.vehicle = v; u.car = null;
        }
      } else if (u.vehicle) {
        const v = u.vehicle;
        if (!this.vehicles.all.has(v.id)) { this.units.splice(i, 1); continue; }
        const d = Math.hypot(v.x - pl.x, v.z - pl.z);
        if (d < 9) close = true;
        if (u.kind === 'block') { if (d > 400) { this.vehicles.remove(v); this.units.splice(i, 1); } continue; }
        if (v.destroyed || (!this.seen && this.unseen > 9 && d > 120)) {
          // Lost them: the car is abandoned and a fresh unit is sent to search.
          this.vehicles.ai.delete(v); v.occupied = false; this.vehicles.transient.add(v);
          this.units.splice(i, 1);
          continue;
        }
        const target = this.state === 'pursuit' ? pl : this.lastKnown ?? pl;
        this.vehicles.ai.set(v, this.drive(u, v, target.x, target.z, dt, this.level <= 2));
      }
    }

    // Arrest: stopped, in sight, with an officer alongside.
    if (close && this.seen && pl.speed < 1.3) {
      this.bustTimer += dt;
      if (this.bustTimer > 2.5) this.bust();
    } else this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
  }

  private bust(): void {
    const fine = this.chargeFine(Math.max(150, Math.round(this.cashOnHand() * 0.12) + 100 * this.level));
    this.busts++;
    this.clear('busted');
    this.bus.emit('player.busted', { fine });
    this.bus.emit('notify', { text: `Busted. The city took $${fine.toLocaleString('en-US')}.`, kind: 'bad' });
    this.onBusted?.();
  }

  /** Where a busted player is released. */
  static station(): { x: number; z: number } {
    const a = districtAnchors('downtown');
    return { x: a[0].x + 12, z: a[0].z + 12 };
  }

  snapshot(): WantedSnapshot {
    return { notoriety: this.notoriety, busts: this.busts, escapes: this.escapes, crimesReported: this.crimesReported };
  }

  restore(s: WantedSnapshot): void {
    this.clear('paid');
    this.notoriety = s.notoriety; this.busts = s.busts; this.escapes = s.escapes; this.crimesReported = s.crimesReported;
  }
}
