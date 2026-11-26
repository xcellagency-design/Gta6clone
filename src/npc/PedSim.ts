import type { EventBus } from '../core/EventBus';
import type { Physics } from '../core/Physics';
import { Rng } from '../core/rng';
import type { Environment } from '../environment/Environment';
import type { CharacterAnim, CharacterPose } from '../render/CharacterRenderer';
import { RING_STRIDE, type CellData } from '../streaming/CellData';
import type { VehicleManager } from '../vehicles/VehicleManager';
import { BLOCK, cellKey, districtAt, DISTRICTS, nodeInfo, signalState } from '../world/CityPlan';

/**
 * Ambient pedestrians. Each one walks the sidewalk ring of a city block, crosses at corners
 * when the signal allows, stops to idle, talk, phone or step into a building, hurries in rain,
 * gets out of the way of danger — and, when a crime happens in front of them, may call it in.
 *
 * Simulation tiers: "full" close to the player (perception and reactions every step), "simple"
 * for the rest of the loaded area (movement at a reduced rate), "statistical" beyond it (not
 * instantiated; only a density estimate).
 */

export type PedActivity = 'walk' | 'idle' | 'talk' | 'phone' | 'enter' | 'cross' | 'flee' | 'cower' | 'report' | 'down' | 'wait';

interface Ring { x0: number; z0: number; x1: number; z1: number; cell: string }

export interface Ped {
  id: number;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  stride: number;
  ring: Ring;
  /** Distance along the ring's perimeter, and which way round. */
  t: number;
  sign: 1 | -1;
  activity: PedActivity;
  timer: number;
  pace: number;
  /** 0 timid … 1 bold: decides between fleeing, freezing and reporting. */
  nerve: number;
  /** 0 … 1: how likely they are to call the police about what they saw. */
  civic: number;
  shirt: number; pants: number; skin: number; scale: number;
  tier: 0 | 1;
  partner: number;
  /** Free-movement target while crossing, fleeing or entering. */
  tx: number; tz: number;
  nextRing: Ring | null;
  nextT: number;
  crime: { type: string; x: number; z: number; severity: number } | null;
  /** Remembers the last thing the player did to them. */
  memory: string;
  accum: number;
}

const SKIN = [0xf1c9a5, 0xd9a47c, 0xb98a66, 0x8d5a3b, 0x6a4530, 0xe6b98f];
const WARM = [0xe9e2d0, 0xf2c14e, 0x7fb7be, 0xd96c4a, 0x9bc27a, 0xf0f0f0, 0xe79fb3, 0x5fa8d3];
const COOL = [0x2f3b48, 0x4a4a52, 0x3e5c4b, 0x6b2f2f, 0x23262b, 0x3b4a66];
const RAIN = [0xe2c12b, 0x2f3b48, 0x1f4f5f, 0x4a4a52, 0x6b2f2f];
const PANTS = [0x2b2d33, 0x3a4658, 0x5a4a3a, 0x1f2328, 0x6f6a5c, 0x34404a];
const FULL_RADIUS = 48;

function perimeter(r: Ring): number {
  return 2 * (r.x1 - r.x0 + r.z1 - r.z0);
}

/** Position and direction of travel at distance t along a ring, clockwise from its NW corner. */
function ringPoint(r: Ring, t: number, out: { x: number; z: number; hx: number; hz: number }): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0, P = 2 * (w + d);
  t = ((t % P) + P) % P;
  if (t < w) { out.x = r.x0 + t; out.z = r.z0; out.hx = 1; out.hz = 0; }
  else if (t < w + d) { out.x = r.x1; out.z = r.z0 + (t - w); out.hx = 0; out.hz = 1; }
  else if (t < 2 * w + d) { out.x = r.x1 - (t - w - d); out.z = r.z1; out.hx = -1; out.hz = 0; }
  else { out.x = r.x0; out.z = r.z1 - (t - 2 * w - d); out.hx = 0; out.hz = -1; }
}

/** Perimeter distance of the point on a ring nearest to (x, z). */
function nearestT(r: Ring, x: number, z: number): number {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = Math.max(r.x0, Math.min(r.x1, x)), cz = Math.max(r.z0, Math.min(r.z1, z));
  const dn = Math.abs(cz - r.z0), ds = Math.abs(cz - r.z1), dw = Math.abs(cx - r.x0), de = Math.abs(cx - r.x1);
  const m = Math.min(dn, ds, dw, de);
  if (m === dn) return cx - r.x0;
  if (m === de) return w + (cz - r.z0);
  if (m === ds) return w + d + (r.x1 - cx);
  return 2 * w + d + (r.z1 - cz);
}

const tmp = { x: 0, z: 0, hx: 0, hz: 0 };

export class PedSim {
  readonly peds: Ped[] = [];
  private rings = new Map<string, Ring[]>();
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private pendingReports: { crime: { type: string; x: number; z: number; severity: number }; timer: number }[] = [];
  maxPeds: number;
  enabled = true;
  stats = { full: 0, simple: 0, statistical: 0, reports: 0, witnesses: 0, fled: 0, talks: 0, entered: 0, crossings: 0, bumped: 0, run_over: 0 };

  constructor(
    private physics: Physics, private env: Environment, private vehicles: VehicleManager, private bus: EventBus,
    private player: () => { x: number; z: number; speed: number; onFoot: boolean }, private clock: () => number, maxPeds: number, seed: number,
  ) {
    this.maxPeds = maxPeds;
    this.rng = new Rng(seed ^ 0x9ed5);
    bus.on('crime.committed', (c) => this.onCrime(c));
  }

  // ── population ──────────────────────────────────────────────────────────

  /** Streaming callback: a cell's sidewalks became available or went away. */
  onDetail(data: CellData, present: boolean): void {
    const key = cellKey(data.cx, data.cz);
    if (!present) {
      this.rings.delete(key);
      for (let i = this.peds.length - 1; i >= 0; i--) {
        const p = this.peds[i];
        if (p.ring.cell !== key) continue;
        // The caller leaves the loaded area, but the call still goes through.
        if (p.activity === 'report' && p.crime) this.pendingReports.push({ crime: p.crime, timer: Math.max(0, p.timer) });
        this.peds.splice(i, 1);
      }
      return;
    }
    const list: Ring[] = [];
    for (let o = 0; o < data.sidewalks.length; o += RING_STRIDE) {
      list.push({ x0: data.sidewalks[o], z0: data.sidewalks[o + 1], x1: data.sidewalks[o + 2], z1: data.sidewalks[o + 3], cell: key });
    }
    this.rings.set(key, list);
    const want = this.cellTarget(data.cx, data.cz, list.length);
    for (let i = 0; i < want; i++) this.spawnOn(this.rng.pick(list));
  }

  private cellTarget(cx: number, cz: number, rings: number): number {
    if (!rings) return 0;
    const d = DISTRICTS[districtAt(cx * 200 + 100, cz * 200 + 100)];
    let life = this.env.streetLife();
    if (d.id === 'neonmile' && (this.env.hour > 20 || this.env.hour < 3)) life = Math.max(life, 1.1);
    if (d.id === 'downtown' && (this.env.hour > 21 || this.env.hour < 6)) life *= 0.5;
    return Math.round(d.pedDensity * life * (this.maxPeds / 40));
  }

  /** Estimated people in the loaded-but-distant world, for the overlay's statistical tier. */
  estimateStatistical(cells: { cx: number; cz: number; lod: number }[]): number {
    let n = 0;
    for (const c of cells) if (c.lod >= 1 && c.lod <= 2) n += DISTRICTS[districtAt(c.cx * 200 + 100, c.cz * 200 + 100)].pedDensity * this.env.streetLife();
    return Math.round(n);
  }

  spawnOn(ring: Ring, t?: number): Ped | null {
    if (this.peds.length >= this.maxPeds) return null;
    const rain = this.env.rain > 0.2, night = this.env.night() > 0.6;
    const palette = rain ? RAIN : night ? COOL : this.rng.chance(0.75) ? WARM : COOL;
    const p: Ped = {
      id: this.nextId++, x: 0, y: 0.15, z: 0, heading: 0, speed: 0, stride: this.rng.range(0, 6), ring,
      t: t ?? this.rng.range(0, perimeter(ring)), sign: this.rng.chance(0.5) ? 1 : -1, activity: 'walk', timer: this.rng.range(4, 20),
      pace: this.rng.range(1.15, 1.65), nerve: this.rng.next(), civic: this.rng.next(),
      shirt: this.rng.pick(palette), pants: this.rng.pick(PANTS), skin: this.rng.pick(SKIN), scale: this.rng.range(0.92, 1.06),
      tier: 1, partner: 0, tx: 0, tz: 0, nextRing: null, nextT: 0, crime: null, memory: '', accum: 0,
    };
    ringPoint(ring, p.t, tmp);
    p.x = tmp.x; p.z = tmp.z;
    this.peds.push(p);
    return p;
  }

  /** The ring on the other side of the street from a corner, if there is one loaded. */
  private ringAcross(p: Ped, hx: number, hz: number): Ring | null {
    const px = p.x + hx * 16, pz = p.z + hz * 16;
    let best: Ring | null = null, bd = 24;
    for (const list of this.rings.values()) {
      for (const r of list) {
        if (r === p.ring) continue;
        const cx = Math.max(r.x0, Math.min(r.x1, px)), cz = Math.max(r.z0, Math.min(r.z1, pz));
        const d = Math.hypot(cx - px, cz - pz);
        if (d < bd) { bd = d; best = r; }
      }
    }
    return best;
  }

  // ── perception ──────────────────────────────────────────────────────────

  private canSee(p: Ped, x: number, z: number, range: number): boolean {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d < 2) return true;
    const hit = this.physics.raycastWorld(p.x, 1.6, p.z, dx / d, 0, dz / d, d - 1);
    return hit === null;
  }

  private onCrime(c: { type: string; x: number; z: number; severity: number }): void {
    const range = this.env.visibility();
    for (const p of this.peds) {
      if (p.activity === 'down' || !this.canSee(p, c.x, c.z, range)) continue;
      this.stats.witnesses++;
      const near = Math.hypot(c.x - p.x, c.z - p.z) < 14;
      // Bold, civic-minded people phone it in; timid people run; some just stare.
      if (p.civic > 0.42 && !(near && p.nerve < 0.35)) {
        p.activity = 'report'; p.timer = 3.5 + (1 - p.civic) * 5; p.crime = { ...c }; p.partner = 0;
      } else if (p.nerve < 0.6 || near) this.startFlee(p, c.x, c.z, 9);
      else { p.activity = 'idle'; p.timer = 4; p.heading = Math.atan2(c.x - p.x, c.z - p.z); }
      p.memory = `saw ${c.type}`;
    }
  }

  private startFlee(p: Ped, fromX: number, fromZ: number, seconds: number): void {
    if (p.activity === 'down') return;
    const d = Math.hypot(p.x - fromX, p.z - fromZ) || 1;
    // Timid people freeze when the danger is right on top of them.
    if (p.nerve < 0.18 && d < 6) { p.activity = 'cower'; p.timer = seconds * 0.7; p.partner = 0; return; }
    p.activity = 'flee'; p.timer = seconds; p.partner = 0;
    p.tx = p.x + ((p.x - fromX) / d) * 40; p.tz = p.z + ((p.z - fromZ) / d) * 40;
    this.stats.fled++;
    this.bus.emit('npc.reaction', { npcId: p.id, reaction: 'flee' });
  }

  /** Pedestrians in the roadway, so traffic stops for them. */
  roadObstacles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const p of this.peds) if (p.activity === 'cross' || p.activity === 'down') out.push({ x: p.x, z: p.z, r: 0.8 });
    return out;
  }

  // ── simulation ──────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.enabled) return;
    const pl = this.player();
    const rain = this.env.rain > 0.2;
    const now = this.clock();

    for (let i = this.pendingReports.length - 1; i >= 0; i--) {
      const r = this.pendingReports[i];
      if ((r.timer -= dt) > 0) continue;
      this.pendingReports.splice(i, 1);
      this.stats.reports++;
      this.bus.emit('crime.reported', { ...r.crime, by: 'witness' });
    }

    // Top up: people step out of doorways in cells that are below their target.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      const counts = new Map<string, number>();
      for (const p of this.peds) counts.set(p.ring.cell, (counts.get(p.ring.cell) ?? 0) + 1);
      for (const [key, list] of this.rings) {
        const [cx, cz] = key.split(',').map(Number);
        const want = this.cellTarget(cx, cz, list.length), have = counts.get(key) ?? 0;
        if (have < want) {
          const ring = this.rng.pick(list), t = this.rng.range(0, perimeter(ring));
          ringPoint(ring, t, tmp);
          if (Math.hypot(tmp.x - pl.x, tmp.z - pl.z) > 30) this.spawnOn(ring, t);
        } else if (have > want + 2) {
          // The street empties when it rains or gets late: someone goes indoors.
          const leaving = this.peds.find((p) => p.ring.cell === key && p.activity === 'walk' && Math.hypot(p.x - pl.x, p.z - pl.z) > 20);
          if (leaving) this.goIndoors(leaving);
        }
      }
    }

    const vehicles = [...this.vehicles.all.values()].filter((v) => Math.abs(v.speed) > 2.5 || v === this.vehicles.playerVehicle);
    let full = 0;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const dPlayer = Math.hypot(p.x - pl.x, p.z - pl.z);
      p.tier = dPlayer < FULL_RADIUS ? 0 : 1;
      let step = dt;
      if (p.tier === 1) {
        // Simple tier: advance in coarse steps, staggered across frames.
        p.accum += dt;
        if ((p.id + Math.floor(now * 60)) % 10 !== 0) continue;
        step = p.accum; p.accum = 0;
      } else full++;

      // Full tier: perception and reactions.
      if (p.tier === 0 && p.activity !== 'down') {
        for (const v of vehicles) {
          const dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz);
          if (d > 22) continue;
          const sp = Math.abs(v.speed);
          const hit = d < v.profile.width / 2 + 0.55 || (d < v.profile.length / 2 + 0.3 && Math.abs(dx * Math.cos(v.heading()) - dz * Math.sin(v.heading())) < v.profile.width / 2 + 0.3);
          if (hit && sp > 3) {
            p.activity = 'down'; p.timer = 25; p.speed = 0; p.partner = 0;
            this.stats.run_over++;
            this.bus.emit('npc.reaction', { npcId: p.id, reaction: 'struck' });
            if (v === this.vehicles.playerVehicle) this.bus.emit('crime.committed', { type: 'hit_pedestrian', x: p.x, z: p.z, severity: 3 });
            break;
          }
          // A fast vehicle bearing down on them: get clear.
          const lv = v.body.linvel();
          const closing = -(dx * lv.x + dz * lv.z) / (d || 1);
          const lateral = Math.abs(dx * lv.z - dz * lv.x) / (Math.hypot(lv.x, lv.z) || 1);
          if (sp > 7 && closing > sp * 0.7 && lateral < 3.2 && d < sp * 1.4 && p.activity !== 'flee' && p.activity !== 'cower') {
            this.startFlee(p, v.x, v.z, 4);
          }
        }
        if (p.activity === 'down') continue;
        // Two people passing on the sidewalk sometimes stop to talk.
        if (p.activity === 'walk' && (p.id + Math.floor(now * 2)) % 6 === 0) {
          for (const o of this.peds) {
            if (o.id <= p.id || o.activity !== 'walk' || Math.abs(o.x - p.x) > 2.4 || Math.abs(o.z - p.z) > 2.4 || !this.rng.chance(0.2)) continue;
            const t = this.rng.range(5, 13);
            p.activity = o.activity = 'talk'; p.timer = o.timer = t; p.partner = o.id; o.partner = p.id;
            p.heading = Math.atan2(o.x - p.x, o.z - p.z); o.heading = p.heading + Math.PI;
            this.stats.talks++;
            break;
          }
        }
        if (pl.onFoot && dPlayer < 0.75 && p.activity !== 'flee') {
          // Bumped into by the player.
          if (pl.speed > 5.5) { this.startFlee(p, pl.x, pl.z, 3); p.memory = 'shoved by the player'; }
          else if (p.activity === 'walk') { p.activity = 'idle'; p.timer = 1.2; p.heading = Math.atan2(pl.x - p.x, pl.z - p.z); p.memory = 'bumped by the player'; }
          this.stats.bumped++;
          this.bus.emit('npc.reaction', { npcId: p.id, reaction: 'bumped' });
        }
      }

      p.timer -= step;
      switch (p.activity) {
        case 'walk': {
          const v = p.pace * (rain ? 1.4 : 1);
          ringPoint(p.ring, p.t, tmp);
          const ohx = tmp.hx, ohz = tmp.hz;
          p.t += p.sign * v * step;
          ringPoint(p.ring, p.t, tmp);
          p.x = tmp.x; p.z = tmp.z; p.speed = v;
          p.heading = Math.atan2(tmp.hx * p.sign, tmp.hz * p.sign);
          // Reaching a corner: sometimes carry straight on across the street to the next block.
          if ((ohx !== tmp.hx || ohz !== tmp.hz) && this.rng.chance(0.4)) this.tryCross(p, ohx * p.sign, ohz * p.sign);
          else if (p.timer <= 0) this.pickActivity(p, rain);
          break;
        }
        case 'cross': case 'enter': case 'flee': {
          const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
          const v = p.activity === 'flee' ? 5.4 : p.pace * 1.15;
          p.speed = v;
          if (d > 0.3) { p.x += (dx / d) * Math.min(d, v * step); p.z += (dz / d) * Math.min(d, v * step); p.heading = Math.atan2(dx, dz); }
          if (p.activity === 'cross' && d <= 0.3 && p.nextRing) { p.ring = p.nextRing; p.t = p.nextT; p.nextRing = null; p.activity = 'walk'; p.timer = this.rng.range(8, 25); this.stats.crossings++; }
          else if (p.activity === 'enter' && d <= 0.3) { this.stats.entered++; this.peds.splice(i, 1); continue; }
          else if (p.activity === 'flee' && (p.timer <= 0 || d <= 0.3)) this.rejoin(p);
          break;
        }
        case 'wait': {
          // At the kerb, waiting for the signal.
          p.speed = 0;
          if (p.timer <= 0) { p.timer = 1; if (p.nextRing && this.mayCross(p)) { p.activity = 'cross'; } else if (this.rng.chance(0.08)) { p.nextRing = null; p.activity = 'walk'; p.sign = -p.sign as 1 | -1; p.timer = 10; } }
          break;
        }
        case 'report': {
          p.speed = 0;
          if (p.timer <= 0 && p.crime) {
            this.stats.reports++;
            this.bus.emit('crime.reported', { ...p.crime, by: 'witness' });
            this.bus.emit('npc.reaction', { npcId: p.id, reaction: 'report' });
            p.crime = null;
            this.startFlee(p, pl.x, pl.z, 5);
          }
          break;
        }
        case 'down':
          if (p.timer <= 0) { this.peds.splice(i, 1); continue; }
          break;
        default: // idle, talk, phone, cower
          p.speed = 0;
          if (p.timer <= 0) { p.partner = 0; p.activity = 'walk'; p.timer = this.rng.range(8, 30); }
      }
      p.stride += p.speed * step * 1.9;
    }
    this.stats.full = full;
    this.stats.simple = this.peds.length - full;
  }

  private pickActivity(p: Ped, rain: boolean): void {
    const r = this.rng.next();
    p.timer = this.rng.range(6, 22);
    if (rain && r < 0.75) return; // head down, keep walking
    if (r < 0.2) { p.activity = 'idle'; p.timer = this.rng.range(2, 8); }
    else if (r < 0.3) { p.activity = 'phone'; p.timer = this.rng.range(5, 14); }
    else if (r < 0.45) {
      // Stop and talk with someone nearby who is also just walking.
      const other = this.peds.find((o) => o !== p && o.activity === 'walk' && o.tier === p.tier && Math.hypot(o.x - p.x, o.z - p.z) < 5);
      if (other) {
        const t = this.rng.range(5, 13);
        p.activity = other.activity = 'talk'; p.timer = other.timer = t; p.partner = other.id; other.partner = p.id;
        p.heading = Math.atan2(other.x - p.x, other.z - p.z); other.heading = p.heading + Math.PI;
        this.stats.talks++;
      }
    } else if (r < 0.6) this.goIndoors(p);
    else if (r > 0.9) p.sign = -p.sign as 1 | -1;
  }

  private tryCross(p: Ped, dx: number, dz: number): void {
    const next = this.ringAcross(p, dx, dz);
    if (!next) return;
    p.nextRing = next; p.nextT = nearestT(next, p.x + dx * 30, p.z + dz * 30);
    ringPoint(next, p.nextT, tmp);
    p.tx = tmp.x; p.tz = tmp.z;
    if (Math.hypot(p.tx - p.x, p.tz - p.z) < 34) { p.activity = this.mayCross(p) ? 'cross' : 'wait'; p.timer = 1; }
    else p.nextRing = null;
  }

  /** Walk-signal logic: cross a street only when the traffic on it has a red light. */
  private mayCross(p: Ped): boolean {
    const mx = (p.x + p.tx) / 2, mz = (p.z + p.tz) / 2;
    const kx = Math.round(mx / BLOCK), kz = Math.round(mz / BLOCK);
    if (!nodeInfo(kx, kz).signal) return true;
    const s = signalState(kx, kz, this.clock());
    const crossingNS = Math.abs(p.tx - p.x) > Math.abs(p.tz - p.z); // walking east-west crosses the north-south road
    return crossingNS ? s.ewGreen : s.nsGreen;
  }

  /** Walk off the sidewalk toward the middle of the block: through a door. */
  private goIndoors(p: Ped): void {
    const r = p.ring;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const d = Math.hypot(cx - p.x, cz - p.z) || 1;
    p.activity = 'enter'; p.timer = 20;
    p.tx = p.x + ((cx - p.x) / d) * 3.2; p.tz = p.z + ((cz - p.z) / d) * 3.2;
  }

  /** After running, find the nearest sidewalk and carry on. */
  private rejoin(p: Ped): void {
    let best: Ring = p.ring, bd = Infinity;
    for (const list of this.rings.values()) {
      for (const r of list) {
        const cx = Math.max(r.x0, Math.min(r.x1, p.x)), cz = Math.max(r.z0, Math.min(r.z1, p.z));
        // Distance to the ring's edge, not its interior.
        const t = nearestT(r, cx, cz);
        ringPoint(r, t, tmp);
        const d = Math.hypot(tmp.x - p.x, tmp.z - p.z);
        if (d < bd) { bd = d; best = r; }
      }
    }
    p.nextRing = best; p.nextT = nearestT(best, p.x, p.z);
    ringPoint(best, p.nextT, tmp);
    p.tx = tmp.x; p.tz = tmp.z;
    p.activity = 'cross'; p.timer = 20;
  }

  /** Poses for rendering, nearest first up to the renderer's budget. */
  poses(add: (pose: CharacterPose) => void, camX: number, camZ: number, maxDist: number): void {
    for (const p of this.peds) {
      if (Math.hypot(p.x - camX, p.z - camZ) > maxDist) continue;
      let anim: CharacterAnim = 'stand';
      if (p.activity === 'phone' || p.activity === 'report') anim = 'phone';
      else if (p.activity === 'talk') anim = 'talk';
      else if (p.activity === 'cower') anim = 'cower';
      else if (p.activity === 'down') anim = 'swim';
      add({ x: p.x, y: p.activity === 'down' ? p.y - 0.35 : p.y, z: p.z, heading: p.heading, stride: p.stride, speed: p.speed, anim, shirt: p.shirt, pants: p.pants, skin: p.skin, scale: p.scale });
    }
  }
}
