import type { EventBus } from '../core/EventBus';
import { GROUP, groups, type Physics } from '../core/Physics';
import { Rng } from '../core/rng';
import type { Environment } from '../environment/Environment';
import type { Vehicle } from '../vehicles/Vehicle';
import type { VehicleManager } from '../vehicles/VehicleManager';
import { vehicleProfile, type VehicleProfile } from '../vehicles/VehicleProfile';
import {
  BLOCK, districtAt, DISTRICTS, edgeClass, lanesPerDirection, nodeInfo, RoadClass, roadWidth, signalState, speedLimit,
} from '../world/CityPlan';

/**
 * Ambient traffic on the road lattice.
 *
 * Every car is an agent on a lane: it follows the car ahead (an intelligent-driver model), obeys
 * signals, yields at junctions, picks a turn and steers through it on a curve. Three tiers:
 *   physical    near the player — has a collider, can be hit, stopped for, or taken
 *   kinematic   further out — lane following only
 *   statistical beyond the active radius — not simulated; density is kept up by spawning and
 *               retiring cars out of sight
 */

/** Travel directions: 0 north (−z), 1 east (+x), 2 south (+z), 3 west (−x). */
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];
const HEADING = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
/** Right-hand side offset direction for each travel direction. */
const RX = [1, 0, -1, 0];
const RZ = [0, 1, 0, -1];

const TRAFFIC_MIX = ['sedan', 'sedan', 'sedan', 'suv', 'suv', 'sports', 'truck', 'motorcycle'];
const PHYSICAL_RADIUS = 85;
const STOP_MARGIN = 7.2;

export interface TrafficCar {
  id: number;
  profile: VehicleProfile;
  color: string;
  /** Start node of the current segment. */
  kx: number; kz: number;
  dir: number;
  lane: number;
  /** Lateral position in lanes; eases toward `lane` during a lane change. */
  laneF: number;
  /** Metres from the start node's centre along the segment. */
  s: number;
  speed: number;
  /** Direction to take at the next junction (−1 until chosen). */
  nextDir: number;
  /** While crossing a junction: Bezier from p0 through c to p1. */
  turn: { x0: number; z0: number; cx: number; cz: number; x1: number; z1: number; t: number; len: number; h0: number; h1: number } | null;
  x: number; z: number; heading: number;
  steer: number;
  spin: number;
  temper: number;
  tier: 0 | 1;
  body: import('@dimforge/rapier3d-compat').RigidBody | null;
  stuck: number;
  honk: number;
  police: boolean;
  /** Set by the police system: drive toward this point instead of wandering. */
  goal: { x: number; z: number } | null;
  siren: boolean;
}

function edgeFrom(kx: number, kz: number, dir: number): RoadClass {
  switch (dir) {
    case 0: return edgeClass(true, kx, kz - 1);
    case 1: return edgeClass(false, kz, kx);
    case 2: return edgeClass(true, kx, kz);
    default: return edgeClass(false, kz, kx - 1);
  }
}

/** Lateral distance of a lane's centre from the road's centre line. */
export function laneOffset(cls: RoadClass, lane: number): number {
  const half = roadWidth(cls) / 2;
  const edge = half - 0.45;
  const off = cls === RoadClass.Highway ? 0.9 : 0.25;
  const lanes = lanesPerDirection(cls);
  const w = (edge - off) / lanes;
  return off + w * (lane + 0.5);
}

/** Half-extent of a junction box along a travel direction. */
function nodeHalf(kx: number, kz: number, dir: number): number {
  const n = nodeInfo(kx, kz);
  return dir % 2 === 0 ? n.halfZ : n.halfX;
}

export class TrafficSim {
  readonly cars: TrafficCar[] = [];
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private pvx = 0;
  private pvz = 0;
  maxCars: number;
  activeRadius = 340;
  enabled = true;
  /** Counters for the debug overlay and tests. */
  stats = { physical: 0, kinematic: 0, statistical: 0, spawned: 0, retired: 0, crashes: 0, redLightStops: 0 };
  /** Things traffic must not drive through, besides other traffic (pedestrians register here). */
  obstacles: (() => { x: number; z: number; r: number }[])[] = [];

  constructor(
    private physics: Physics, private env: Environment, private vehicles: VehicleManager, private bus: EventBus,
    private focus: () => { x: number; z: number; vx: number; vz: number }, private clock: () => number, maxCars: number, seed: number,
  ) {
    this.maxCars = maxCars;
    this.rng = new Rng(seed ^ 0x7ac1);
  }

  // ── geometry ────────────────────────────────────────────────────────────

  private lanePoint(c: { kx: number; kz: number; dir: number; lane: number; laneF?: number }, s: number, out: { x: number; z: number }): void {
    const cls = edgeFrom(c.kx, c.kz, c.dir);
    const o = laneOffset(cls, c.laneF ?? c.lane);
    out.x = c.kx * BLOCK + DX[c.dir] * s + RX[c.dir] * o;
    out.z = c.kz * BLOCK + DZ[c.dir] * s + RZ[c.dir] * o;
  }

  private chooseNext(car: TrafficCar): number {
    const tx = car.kx + DX[car.dir], tz = car.kz + DZ[car.dir];
    const opts: { dir: number; w: number }[] = [];
    for (let d = 0; d < 4; d++) {
      if (d === (car.dir + 2) % 4) continue;
      const cls = edgeFrom(tx, tz, d);
      if (!cls) continue;
      let w = d === car.dir ? 0.56 : 0.22;
      w *= 0.7 + 0.3 * cls;
      if (car.goal) {
        // Head for the goal: favour the arm that reduces the distance most.
        const nx = (tx + DX[d]) * BLOCK, nz = (tz + DZ[d]) * BLOCK;
        const now = Math.hypot(tx * BLOCK - car.goal.x, tz * BLOCK - car.goal.z);
        w = Math.max(0.01, now - Math.hypot(nx - car.goal.x, nz - car.goal.z) + 100) ** 3;
      }
      opts.push({ dir: d, w });
    }
    if (!opts.length) return (car.dir + 2) % 4; // dead end: turn around
    if (car.goal) return opts.reduce((a, b) => (b.w > a.w ? b : a)).dir;
    let r = this.rng.next() * opts.reduce((a, o) => a + o.w, 0);
    for (const o of opts) { if ((r -= o.w) <= 0) return o.dir; }
    return opts[0].dir;
  }

  // ── population ──────────────────────────────────────────────────────────

  /** How many cars the area around the player should hold right now. */
  targetCount(): number {
    const f = this.focus();
    const d = DISTRICTS[districtAt(f.x, f.z)];
    const h = this.env.hour;
    const byHour = h < 5 ? 0.25 : h < 7 ? 0.6 : h < 10 ? 1 : h < 16 ? 0.85 : h < 19 ? 1 : h < 23 ? 0.6 : 0.35;
    const weather = 1 - 0.25 * this.env.rain;
    return Math.round(this.maxCars * Math.min(1, 0.25 + d.trafficDensity) * byHour * weather);
  }

  spawnAt(kx: number, kz: number, dir: number, s: number, profileId?: string): TrafficCar | null {
    const cls = edgeFrom(kx, kz, dir);
    if (!cls) return null;
    const lane = this.rng.int(0, lanesPerDirection(cls) - 1);
    const profile = vehicleProfile(profileId ?? this.rng.pick(TRAFFIC_MIX));
    const car: TrafficCar = {
      id: this.nextId++, profile, color: this.rng.pick(profile.colors), kx, kz, dir, lane, laneF: lane, s, speed: speedLimit(cls) * 0.6,
      nextDir: -1, turn: null, x: 0, z: 0, heading: HEADING[dir], steer: 0, spin: 0, temper: this.rng.range(0.82, 1.12),
      tier: 1, body: null, stuck: 0, honk: 0, police: profile.id === 'police', goal: null, siren: false,
    };
    this.lanePoint(car, s, car);
    // Never spawn on top of another car.
    for (const o of this.cars) if (Math.hypot(o.x - car.x, o.z - car.z) < 12) return null;
    for (const v of this.vehicles.all.values()) if (Math.hypot(v.x - car.x, v.z - car.z) < 10) return null;
    this.cars.push(car);
    this.stats.spawned++;
    return car;
  }

  private trySpawn(): void {
    const f = this.focus();
    const speed = Math.hypot(f.vx, f.vz);
    // Spawn in a ring out of immediate view, biased toward where the player is heading.
    const a = speed > 4 && this.rng.chance(0.7) ? Math.atan2(f.vx, f.vz) + this.rng.range(-0.9, 0.9) : this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(this.activeRadius * 0.55, this.activeRadius * 0.92);
    const px = f.x + Math.sin(a) * r, pz = f.z + Math.cos(a) * r;
    const kx = Math.round(px / BLOCK), kz = Math.round(pz / BLOCK);
    const dir = this.rng.int(0, 3);
    if (!edgeFrom(kx, kz, dir)) return;
    this.spawnAt(kx, kz, dir, this.rng.range(25, 70));
  }

  remove(car: TrafficCar): void {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    if (car.body) { this.physics.world.removeRigidBody(car.body); car.body = null; }
  }

  /** Turn a traffic agent into a real, drivable, physical vehicle (after a crash or a theft). */
  convert(car: TrafficCar, keepSpeed = true): Vehicle {
    this.remove(car);
    const v = this.vehicles.spawn(car.profile.id, car.x, 0.02, car.z, car.heading, car.color);
    v.owner = car.police ? 'police' : 'npc';
    if (keepSpeed) v.body.setLinvel({ x: Math.sin(car.heading) * car.speed, y: 0, z: Math.cos(car.heading) * car.speed }, true);
    this.vehicles.transient.add(v);
    return v;
  }

  /** A slow or stopped car next to the player can be taken. */
  claimNear(x: number, z: number, maxDist: number): Vehicle | null {
    let best: TrafficCar | null = null, bd = maxDist;
    for (const c of this.cars) {
      if (c.speed > 4) continue;
      const d = Math.hypot(c.x - x, c.z - z) - c.profile.width / 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? this.convert(best, false) : null;
  }

  // ── simulation ──────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.enabled) return;
    const f = this.focus();
    const cars = this.cars;

    // Statistical tier: keep the population at its target by spawning and retiring at the edge.
    this.spawnTimer -= dt;
    const target = this.targetCount();
    if (cars.length < target && this.spawnTimer <= 0) {
      for (let i = 0; i < 4 && cars.length < target; i++) this.trySpawn();
      this.spawnTimer = 0.25;
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      if ((d > this.activeRadius * 1.15 && !c.goal) || d > this.activeRadius * 3 || c.stuck > 45) { this.remove(c); this.stats.retired++; }
    }
    this.stats.statistical = Math.max(0, Math.round(target * 3.2) - cars.length);

    // Index cars by segment so each one can find its leader.
    const bySeg = new Map<number, TrafficCar[]>();
    const segKey = (c: { kx: number; kz: number; dir: number }) => ((c.kx + 512) * 4096 + (c.kz + 512)) * 4 + c.dir;
    // Who holds each junction: cars crossing it, and cars past the stop line and committed to it.
    const inJunction = new Map<number, { car: TrafficCar; from: number; to: number; t: number }[]>();
    const hold = (k: number, car: TrafficCar, from: number, to: number, t: number) => { let a = inJunction.get(k); if (!a) inJunction.set(k, (a = [])); a.push({ car, from, to, t }); };
    const conflicts = (aFrom: number, aTo: number, bFrom: number, bTo: number) =>
      aFrom !== bFrom && !(aFrom === (bFrom + 2) % 4 && aTo !== (aFrom + 3) % 4 && bTo !== (bFrom + 3) % 4);
    const nodeKey = (kx: number, kz: number) => (kx + 512) * 4096 + (kz + 512);
    for (const c of cars) {
      if (c.turn) { hold(nodeKey(c.kx + DX[c.dir], c.kz + DZ[c.dir]), c, c.turn.h0, c.turn.h1, c.turn.t); continue; }
      if (c.nextDir >= 0 && c.s > BLOCK - nodeHalf(c.kx + DX[c.dir], c.kz + DZ[c.dir], c.dir) - STOP_MARGIN + 1) hold(nodeKey(c.kx + DX[c.dir], c.kz + DZ[c.dir]), c, c.dir, c.nextDir, 0);
      const k = segKey(c);
      let a = bySeg.get(k);
      if (!a) bySeg.set(k, (a = []));
      a.push(c);
    }

    const blockers: { x: number; z: number; r: number; speed: number }[] = [];
    for (const v of this.vehicles.all.values()) {
      if (Math.hypot(v.x - f.x, v.z - f.z) < this.activeRadius) blockers.push({ x: v.x, z: v.z, r: v.profile.length / 2, speed: Math.max(0, v.speed) });
    }
    for (const src of this.obstacles) for (const o of src()) blockers.push({ ...o, speed: 0 });

    const wet = 1 - 0.2 * this.env.wetness - 0.2 * this.env.fog;
    let physical = 0;
    for (const c of cars) {
      const cls = edgeFrom(c.kx, c.kz, c.dir);
      if (!cls) { c.stuck = 99; continue; }
      const tx = c.kx + DX[c.dir], tz = c.kz + DZ[c.dir];
      const v0 = speedLimit(cls) * c.temper * wet * (c.siren ? 1.7 : 1);
      const aMax = c.siren ? 4.5 : 2.4, bComf = 3.2;

      if (c.turn) {
        // Crossing a junction on a curve.
        const t = c.turn;
        const targetV = Math.min(v0, t.len > 14 && t.h0 !== t.h1 ? 7.5 : t.h0 !== t.h1 ? 5 : v0);
        c.speed += Math.max(-bComf * 1.5, Math.min(aMax, (targetV - c.speed) * 2)) * dt;
        c.speed = Math.max(1.2, c.speed);
        t.t = Math.min(1, t.t + (c.speed * dt) / t.len);
        const u = t.t, iu = 1 - u;
        const px = iu * iu * t.x0 + 2 * iu * u * t.cx + u * u * t.x1;
        const pz = iu * iu * t.z0 + 2 * iu * u * t.cz + u * u * t.z1;
        const tx2 = 2 * iu * (t.cx - t.x0) + 2 * u * (t.x1 - t.cx), tz2 = 2 * iu * (t.cz - t.z0) + 2 * u * (t.z1 - t.cz);
        const want = Math.atan2(tx2, tz2);
        c.steer = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading)) * 3;
        c.x = px; c.z = pz; c.heading = want;
        if (t.t >= 1) {
          c.kx = tx; c.kz = tz; c.dir = c.nextDir; c.nextDir = -1;
          c.s = nodeHalf(c.kx, c.kz, c.dir);
          c.turn = null;
          c.lane = Math.min(c.lane, lanesPerDirection(edgeFrom(c.kx, c.kz, c.dir)) - 1);
          c.laneF = c.lane;
        }
      } else {
        if (c.nextDir < 0) c.nextDir = this.chooseNext(c);
        const stopAt = BLOCK - nodeHalf(tx, tz, c.dir) - STOP_MARGIN;
        // Lane discipline: left turns from the inside lane, right turns from the kerb lane.
        const lanesHere = lanesPerDirection(cls);
        const wantLane = c.nextDir === (c.dir + 3) % 4 ? 0 : c.nextDir === (c.dir + 1) % 4 ? lanesHere - 1 : c.lane;
        if (wantLane !== c.lane) {
          const step = wantLane > c.lane ? 1 : -1;
          const segCars = bySeg.get(segKey(c));
          const clear = !segCars || !segCars.some((o) => o !== c && o.lane === c.lane + step && Math.abs(o.s - c.s) < 9 + c.speed * 0.6);
          if (clear && c.s < stopAt - 6) c.lane += step;
          else if (c.s > stopAt - 22) {
            // Could not get across in time: go straight on instead (or take what the lane allows).
            c.nextDir = edgeFrom(tx, tz, c.dir) ? c.dir : c.lane === 0 ? (c.dir + 3) % 4 : (c.dir + 1) % 4;
            if (!edgeFrom(tx, tz, c.nextDir)) c.nextDir = this.chooseNext(c);
          }
        }
        c.laneF += (c.lane - c.laneF) * Math.min(1, dt * 1.6);
        // Gap to whatever is ahead: a leader in the lane, a red light, a busy junction, an obstacle.
        let gap = 200, leadV = v0;
        const seg = bySeg.get(segKey(c));
        if (seg) for (const o of seg) {
          if (o === c || o.lane !== c.lane || o.s <= c.s) continue;
          const g = o.s - c.s - (o.profile.length + c.profile.length) / 2;
          if (g < gap) { gap = g; leadV = o.speed; }
        }
        const node = nodeInfo(tx, tz);
        let mustStop = false;
        if (node.signal && !c.siren) {
          const sg = signalState(tx, tz, this.clock());
          const green = c.dir % 2 === 0 ? sg.nsGreen : sg.ewGreen;
          const dist = stopAt - c.s;
          if (!green && dist > -1) mustStop = true;
          else if (sg.yellow && dist > c.speed * 1.6) mustStop = true;
        } else if (node.degree >= 3 && !c.siren) {
          // Unsignalled: the bigger road goes first; otherwise wait for the junction to clear.
          const mine = cls, cross = Math.max(...node.arms.filter((_, i) => i % 2 !== c.dir % 2));
          const busy = (inJunction.get(nodeKey(tx, tz)) ?? []).some((o) => o.car !== c && conflicts(c.dir, c.nextDir, o.from, o.to));
          if (busy && stopAt - c.s > -1) mustStop = true;
          else if (cross > mine && stopAt - c.s > 0 && stopAt - c.s < 14 && c.speed > 2.5) { gap = Math.min(gap, stopAt - c.s + 6); leadV = 2; }
        }
        // Never share a junction with a car that came in from another direction, and give way
        // to oncoming traffic before turning left across it.
        const inside = inJunction.get(nodeKey(tx, tz));
        if (inside && stopAt - c.s > -1 && inside.some((o) => o.car !== c && (conflicts(c.dir, c.nextDir, o.from, o.to) || (o.from === c.dir && o.to === c.nextDir && o.car.turn !== null && o.t < 0.6 && (c.nextDir !== c.dir || o.car.lane === c.lane))))) mustStop = true;
        if (!mustStop && c.nextDir === (c.dir + 3) % 4 && stopAt - c.s > -1 && !c.siren) {
          const onc = bySeg.get(segKey({ kx: tx + DX[c.dir], kz: tz + DZ[c.dir], dir: (c.dir + 2) % 4 }));
          if (onc && onc.some((o) => o.s > BLOCK - nodeHalf(tx, tz, c.dir) - 32 && o.speed > 1 && o.nextDir !== (o.dir + 3) % 4)) mustStop = true;
        }
        // Do not enter a junction whose exit is blocked.
        const out = bySeg.get(segKey({ kx: tx, kz: tz, dir: c.nextDir }));
        if (out && out.some((o) => o.s < nodeHalf(tx, tz, c.nextDir) + o.profile.length + 5 && o.speed < 1.5) && stopAt - c.s > -1) mustStop = true;
        if (mustStop) {
          const g = stopAt - c.s - c.profile.length / 2 + 1.5;
          if (g < gap) { gap = g; leadV = 0; if (c.speed < 0.3 && node.signal) this.stats.redLightStops += dt; }
        }
        // Anything physical in the lane ahead: the player's car, a wreck, a pedestrian.
        const fx = DX[c.dir], fz = DZ[c.dir];
        for (const b of blockers) {
          const lx = b.x - c.x, lz = b.z - c.z;
          const ahead = lx * fx + lz * fz;
          if (ahead < 0.5 || ahead > 45) continue;
          const side = Math.abs(lx * fz - lz * fx);
          if (side > 1.5 + b.r * 0.4) continue;
          const g = ahead - b.r - c.profile.length / 2 - 1;
          if (g < gap) { gap = g; leadV = Math.max(0, b.speed * Math.max(0, fx * 0 + 1) * 0.5); }
        }
        // Intelligent-driver model.
        const sStar = 2.2 + Math.max(0, c.speed * 1.3 + (c.speed * (c.speed - leadV)) / (2 * Math.sqrt(aMax * bComf)));
        let acc = aMax * (1 - Math.pow(c.speed / Math.max(1, v0), 4) - Math.pow(sStar / Math.max(0.3, gap), 2));
        acc = Math.max(-9, Math.min(aMax, acc));
        c.speed = Math.max(0, c.speed + acc * dt);
        if (gap < 0.4) c.speed = 0;
        const wasBefore = c.s <= stopAt + 1;
        c.s += c.speed * dt;
        if (wasBefore && c.s > stopAt + 1) hold(nodeKey(tx, tz), c, c.dir, c.nextDir, 0);
        c.stuck = c.speed < 0.2 ? c.stuck + dt : 0;
        if (c.stuck > 6 && c.honk <= 0 && gap < 6 && !mustStop) c.honk = 1.2;
        c.honk = Math.max(0, c.honk - dt);
        this.lanePoint(c, c.s, c);
        c.heading = HEADING[c.dir];
        c.steer *= 0.8;

        const enter = BLOCK - nodeHalf(tx, tz, c.dir);
        if (c.s >= enter) {
          // Build the curve through the junction to the chosen exit lane.
          const nd = c.nextDir;
          const exitCls = edgeFrom(tx, tz, nd);
          if (!exitCls) { c.nextDir = this.chooseNext(c); c.s = enter - 0.1; continue; }
          const lanesOut = lanesPerDirection(exitCls);
          const right = nd === (c.dir + 1) % 4, left = nd === (c.dir + 3) % 4;
          const laneOut = right ? lanesOut - 1 : left ? 0 : Math.min(c.lane, lanesOut - 1);
          const p0 = { x: 0, z: 0 }, p1 = { x: 0, z: 0 };
          this.lanePoint(c, enter, p0);
          this.lanePoint({ kx: tx, kz: tz, dir: nd, lane: laneOut }, nodeHalf(tx, tz, nd), p1);
          // Control point: where the two lane lines meet (or the midpoint when going straight).
          let cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
          if (nd !== c.dir && nd !== (c.dir + 2) % 4) { cx = c.dir % 2 === 0 ? p0.x : p1.x; cz = c.dir % 2 === 0 ? p1.z : p0.z; }
          else if (nd === (c.dir + 2) % 4) { cx = p0.x + DX[c.dir] * 9; cz = p0.z + DZ[c.dir] * 9; }
          const len = Math.max(2, Math.hypot(cx - p0.x, cz - p0.z) + Math.hypot(p1.x - cx, p1.z - cz)) * 0.92;
          c.turn = { x0: p0.x, z0: p0.z, cx, cz, x1: p1.x, z1: p1.z, t: 0, len, h0: c.dir, h1: nd };
          c.lane = laneOut;

        }
      }
      c.spin += (c.speed * dt) / Math.max(0.2, c.profile.wheelRadius);

      // Tier: near the player a car gets a collider and can be hit.
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      const tier: 0 | 1 = d < PHYSICAL_RADIUS ? 0 : 1;
      if (tier === 0) {
        physical++;
        if (!c.body) {
          const R = this.physics.R;
          c.body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.profile.rideHeight, c.z));
          this.physics.world.createCollider(
            R.ColliderDesc.cuboid(c.profile.width / 2, (c.profile.height - 0.26) / 2, c.profile.length / 2)
              .setTranslation(0, 0.26 + (c.profile.height - 0.26) / 2 - c.profile.rideHeight, 0)
              .setCollisionGroups(groups(GROUP.VEHICLE, GROUP.VEHICLE | GROUP.PLAYER | GROUP.NPC)),
            c.body,
          );
        }
        c.body.setNextKinematicTranslation({ x: c.x, y: c.profile.rideHeight, z: c.z });
        c.body.setNextKinematicRotation({ x: 0, y: Math.sin(c.heading / 2), z: 0, w: Math.cos(c.heading / 2) });
      } else if (c.body) {
        this.physics.world.removeRigidBody(c.body);
        c.body = null;
      }
      c.tier = tier;
    }
    this.stats.physical = physical;
    this.stats.kinematic = cars.length - physical;

    // A hard hit from the player's vehicle knocks a traffic car out of its lane for good:
    // it becomes an ordinary physical vehicle and the collision is a crime someone may report.
    const pv = this.vehicles.playerVehicle;
    if (pv) {
      const lv = pv.body.linvel();
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (c.tier !== 0) continue;
        const dx = pv.x - c.x, dz = pv.z - c.z;
        if (Math.abs(dx) + Math.abs(dz) > 9) continue;
        const sh = Math.sin(c.heading), ch = Math.cos(c.heading);
        const lz = dx * sh + dz * ch, lx = dx * ch - dz * sh;
        // The player's footprint projected on this car's axes.
        const dh = pv.heading() - c.heading;
        const ca = Math.abs(Math.cos(dh)), sa = Math.abs(Math.sin(dh));
        const ez = ca * pv.profile.length / 2 + sa * pv.profile.width / 2;
        const ex = sa * pv.profile.length / 2 + ca * pv.profile.width / 2;
        if (Math.abs(lx) > c.profile.width / 2 + ex + 0.5 || Math.abs(lz) > c.profile.length / 2 + ez + 0.5) continue;
        // Closing speed, from the velocity just before the solver absorbed the impact.
        const rel = Math.max(Math.hypot(lv.x - sh * c.speed, lv.z - ch * c.speed), Math.hypot(this.pvx - sh * c.speed, this.pvz - ch * c.speed));
        if (rel < 3.5) continue;
        const wreck = this.convert(c);
        wreck.applyDamage(rel * 2.2);
        this.stats.crashes++;
        this.bus.emit('crime.committed', { type: 'collision', x: c.x, z: c.z, severity: rel > 14 ? 2 : 1 });
      }
      this.pvx = lv.x; this.pvz = lv.z;
    }
  }
}
