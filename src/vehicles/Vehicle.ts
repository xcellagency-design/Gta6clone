import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/Physics';
import { WATER_LEVEL } from '../player/PlayerController';
import type { VehicleProfile } from './VehicleProfile';

export interface VehicleControls {
  /** −1 … 1. Negative brakes, then reverses. */
  throttle: number;
  /** −1 (left) … 1 (right). */
  steer: number;
  handbrake: boolean;
}

export interface VehicleEnv {
  /** Tyre grip multiplier from weather (1 dry, about 0.7 in rain). */
  grip: number;
}

const G = 9.81;
const CLEARANCE = 0.26;
/** How quickly drive force falls away in higher gears. */
const GEAR_FALLOFF = 0.62;
let nextId = 1;

/**
 * A drivable vehicle. Wheeled classes use Rapier's raycast vehicle controller for suspension and
 * tyre forces; this class adds the engine and gearbox, speed-sensitive steering, handbrake, drag,
 * fuel and damage. Boats float on buoyancy forces instead of wheels.
 */
export class Vehicle {
  readonly id = nextId++;
  readonly body: RAPIER.RigidBody;
  readonly ctrl: RAPIER.DynamicRayCastVehicleController | null = null;
  readonly isBoat: boolean;
  readonly isBike: boolean;
  /** Local position of each wheel's suspension mount. */
  readonly wheelMounts: [number, number, number][] = [];

  health = 100;
  fuel = 1;
  gear = 1;
  /** 0 … 1 of the current gear's range; drives the tachometer and engine sound. */
  rpm = 0.1;
  /** Signed speed along the vehicle's forward axis, m/s. */
  speed = 0;
  steerAngle = 0;
  throttle = 0;
  braking = false;
  shiftTimer = 0;
  gearChanges = 0;
  /** Visual lean for motorcycles, radians. */
  lean = 0;
  color: string;
  /** Who it belongs to: the player owns purchased vehicles; everything else is someone else's. */
  owner: 'player' | 'npc' | 'police' = 'npc';
  occupied = false;
  /** Reported stolen: taking it again is not a new crime. */
  hot = false;
  destroyed = false;
  lastImpact = 0;
  distance = 0;
  inWater = false;

  private lvx = 0; private lvy = 0; private lvz = 0;
  private flipTimer = 0;
  private gearTop: number[] = [];
  private dragK: number;
  private spawnGrace = 30;

  constructor(private physics: Physics, readonly profile: VehicleProfile, x: number, y: number, z: number, heading: number, color?: string) {
    const R = physics.R;
    const p = profile;
    this.isBoat = p.class === 'boat';
    this.isBike = p.class === 'motorcycle';
    this.color = color ?? p.colors[0];
    const hx = p.width / 2, hz = p.length / 2;
    const hy = (p.height - CLEARANCE) / 2;
    const m = p.mass;
    const inertia = {
      x: (m / 12) * (p.height * p.height + p.length * p.length),
      y: (m / 12) * (p.width * p.width + p.length * p.length),
      z: (m / 12) * (p.width * p.width + p.height * p.height) * 1.6,
    };
    const startY = y + (this.isBoat ? 0.4 : p.rideHeight + 0.15);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, startY, z)
      .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) })
      .setAdditionalMassProperties(m, { x: 0, y: this.isBoat ? -0.3 : -0.28, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.02)
      .setAngularDamping(this.isBoat ? 1.6 : 0.6)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(desc);
    if (this.isBike) this.body.setEnabledRotations(false, true, false, true);
    // Body box sits above the ground clearance.
    const boxY = this.isBoat ? 0 : CLEARANCE + hy - p.rideHeight;
    physics.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, boxY, 0)
        .setDensity(0.0001)
        .setFriction(0.35)
        .setRestitution(0.05)
        .setCollisionGroups(groups(GROUP.VEHICLE, GROUP.WORLD | GROUP.VEHICLE | GROUP.PLAYER | GROUP.NPC)),
      this.body,
    );

    for (let g = 1; g <= p.gears; g++) this.gearTop.push(p.topSpeed * Math.pow(g / p.gears, 0.9));
    const topForce = p.engineForce * Math.pow(this.gearTop[0] / p.topSpeed, GEAR_FALLOFF);
    this.dragK = (topForce * 0.8) / (p.topSpeed * p.topSpeed);

    if (!this.isBoat) {
      this.ctrl = physics.world.createVehicleController(this.body);
      const sag = G / (4 * p.suspStiffness);
      const mountY = p.wheelRadius + (p.suspRest - sag) - p.rideHeight;
      const hw = p.track / 2, hb = p.wheelBase / 2;
      this.wheelMounts = [[hw, mountY, hb], [-hw, mountY, hb], [hw, mountY, -hb], [-hw, mountY, -hb]];
      for (const w of this.wheelMounts) {
        this.ctrl.addWheel({ x: w[0], y: w[1], z: w[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, p.suspRest, p.wheelRadius);
      }
      for (let i = 0; i < 4; i++) {
        this.ctrl.setWheelSuspensionStiffness(i, p.suspStiffness);
        this.ctrl.setWheelSuspensionCompression(i, p.suspDamping * 0.8);
        this.ctrl.setWheelSuspensionRelaxation(i, p.suspDamping);
        this.ctrl.setWheelMaxSuspensionTravel(i, p.suspRest * 0.95);
        this.ctrl.setWheelMaxSuspensionForce(i, m * G * 3);
        this.ctrl.setWheelFrictionSlip(i, p.grip);
        this.ctrl.setWheelSideFrictionStiffness(i, 1);
      }
    }
  }

  private isDriven(i: number): boolean {
    const d = this.profile.drive;
    return d === 'awd' || (d === 'fwd' ? i < 2 : i >= 2);
  }

  get x(): number { return this.body.translation().x; }
  get y(): number { return this.body.translation().y; }
  get z(): number { return this.body.translation().z; }

  heading(): number {
    const q = this.body.rotation();
    // Forward (+z) rotated by q, projected on the ground plane.
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, fz);
  }

  private upY(): number {
    const q = this.body.rotation();
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  }

  /** One simulation step. Call before the physics world steps. */
  update(dt: number, c: VehicleControls, env: VehicleEnv): void {
    const p = this.profile;
    const v = this.body.linvel();
    const h = this.heading();
    const fx = Math.sin(h), fz = Math.cos(h);
    this.speed = v.x * fx + v.z * fz;
    const lateral = v.x * fz - v.z * fx;
    const abs = Math.abs(this.speed);
    this.distance += abs * dt;

    // Impacts show up as a large change of velocity within a single step.
    const dv = Math.hypot(v.x - this.lvx, v.y - this.lvy, v.z - this.lvz);
    this.lvx = v.x; this.lvy = v.y; this.lvz = v.z;
    this.lastImpact = 0;
    if (this.spawnGrace > 0) this.spawnGrace--;
    else if (dv > 3.0) {
      this.lastImpact = dv;
      this.applyDamage((dv - 3.0) * (this.isBike ? 9 : 5.5));
    }

    const alive = !this.destroyed && this.fuel > 0;
    let throttle = alive && this.occupied ? Math.max(-1, Math.min(1, c.throttle)) : 0;
    const steerIn = this.occupied ? Math.max(-1, Math.min(1, c.steer)) : 0;
    const handbrake = this.occupied ? c.handbrake : true;
    this.throttle = throttle;
    const power = this.health > 50 ? 1 : this.health > 25 ? 0.78 : 0.5;

    if (this.isBoat) { this.updateBoat(dt, throttle, steerIn, fx, fz, lateral, power); return; }
    const ctrl = this.ctrl!;

    // Gearbox.
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const top = this.gearTop[this.gear - 1];
    if (this.speed > top * 0.93 && this.gear < p.gears && this.shiftTimer <= 0) { this.gear++; this.shiftTimer = 0.22; this.gearChanges++; }
    else if (this.gear > 1 && this.speed < this.gearTop[this.gear - 2] * 0.62 && this.shiftTimer <= 0) { this.gear--; this.shiftTimer = 0.16; this.gearChanges++; }
    const r = Math.min(1, abs / this.gearTop[this.gear - 1]);
    const targetRpm = 0.12 + 0.88 * r * (0.55 + 0.45 * Math.abs(throttle)) + (abs < 1 ? Math.abs(throttle) * 0.3 : 0);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 9);

    let drive = 0;
    let brake = 0;
    if (throttle > 0.02) {
      if (this.speed < -1) brake = throttle;
      else if (this.speed < p.topSpeed) {
        const curve = 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.15 + r * 0.85));
        const gearMult = Math.pow(this.gearTop[0] / this.gearTop[this.gear - 1], GEAR_FALLOFF);
        drive = p.engineForce * gearMult * curve * throttle * power * (this.shiftTimer > 0 ? 0.15 : 1);
      }
    } else if (throttle < -0.02) {
      if (this.speed > 1) brake = -throttle;
      else if (this.speed > -9) drive = p.engineForce * 0.55 * throttle * power;
    } else if (abs > 0.3) {
      brake = 0.04;
    }
    this.braking = brake > 0.1;
    if (drive !== 0) this.fuel = Math.max(0, this.fuel - (Math.abs(throttle) * dt) / 1100);

    const driven = p.drive === 'awd' ? 4 : 2;
    const steerLimit = p.maxSteer / (1 + Math.pow(abs / 21, 1.7));
    const pull = this.health < 25 ? 0.05 : 0;
    const target = -steerIn * steerLimit + pull;
    const rate = (Math.abs(target) < Math.abs(this.steerAngle) ? 5.5 : 3.2) * dt;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));

    const grip = p.grip * env.grip;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      ctrl.setWheelEngineForce(i, this.isDriven(i) ? drive / driven : 0);
      ctrl.setWheelSteering(i, front ? this.steerAngle : 0);
      let b = p.brake * brake * (front ? 1.15 : 0.85);
      let g = grip;
      if (handbrake && !front) { b = Math.max(b, p.brake * 1.4); g = grip * (abs > 4 && this.occupied ? 0.42 : 1); }
      ctrl.setWheelBrake(i, b);
      ctrl.setWheelFrictionSlip(i, g);
    }
    ctrl.updateVehicle(dt, undefined, groups(GROUP.VEHICLE, GROUP.WORLD));

    // Aerodynamic drag and a little downforce.
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.5) {
      const k = this.dragK * sp * dt;
      this.body.applyImpulse({ x: -v.x * k, y: -sp * sp * 0.0004 * p.mass * dt, z: -v.z * k }, true);
    }

    if (this.isBike) {
      const latAcc = Math.abs(this.speed) * this.body.angvel().y;
      this.lean += (Math.max(-0.7, Math.min(0.7, latAcc / G)) - this.lean) * Math.min(1, dt * 6);
    }

    // Deep water kills the engine.
    const t = this.body.translation();
    this.inWater = t.y < WATER_LEVEL - 0.2;
    if (this.inWater && !this.destroyed) this.applyDamage(40 * dt);

    // A car left on its roof rights itself after a moment.
    if (this.upY() < 0.25 && sp < 1.5) {
      this.flipTimer += dt;
      if (this.flipTimer > 2.5) this.reset(t.x, Math.max(t.y, 0) + 0.6, t.z, h);
    } else this.flipTimer = 0;
  }

  private updateBoat(dt: number, throttle: number, steer: number, fx: number, fz: number, lateral: number, power: number): void {
    const p = this.profile;
    const body = this.body;
    const t = body.translation();
    const q = body.rotation();
    const hw = p.width * 0.4, hl = p.length * 0.4;
    let wet = 0;
    for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl]]) {
      // Rotate the local hull corner into world space.
      const ly = -0.35;
      const ix = q.w * lx + q.y * lz - q.z * ly, iy = q.w * ly + q.z * lx - q.x * lz, iz = q.w * lz + q.x * ly - q.y * lx, iw = -q.x * lx - q.y * ly - q.z * lz;
      const wx = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
      const wy = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
      const wz = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
      const depth = WATER_LEVEL - (t.y + wy);
      if (depth > 0) {
        wet++;
        const f = Math.min(depth, 1.3) * ((p.mass * G) / 4 / 0.32);
        body.applyImpulseAtPoint({ x: 0, y: f * dt, z: 0 }, { x: t.x + wx, y: t.y + wy, z: t.z + wz }, true);
      }
    }
    this.inWater = wet > 0;
    const v = body.linvel();
    if (wet) {
      const k = wet / 4;
      // Water resists vertical and sideways motion much more than forward motion.
      body.applyImpulse({ x: 0, y: -v.y * p.mass * 3.2 * k * dt, z: 0 }, true);
      const side = lateral * p.mass * 2.6 * k * dt;
      body.applyImpulse({ x: -fz * side, y: 0, z: fx * side }, true);
      const fwdDrag = this.dragK * this.speed * Math.abs(this.speed) * dt + this.speed * p.mass * 0.12 * dt;
      body.applyImpulse({ x: -fx * fwdDrag, y: 0, z: -fz * fwdDrag }, true);
      const thrust = p.engineForce * throttle * power * (throttle < 0 ? 0.45 : 1) * k;
      body.applyImpulse({ x: fx * thrust * dt, y: 0, z: fz * thrust * dt }, true);
      const turn = -steer * p.maxSteer * Math.min(1.15, 0.2 + Math.abs(this.speed) * 0.07 + Math.abs(throttle) * 0.25) * (this.speed < -0.5 ? -1 : 1);
      const av = body.angvel();
      body.applyTorqueImpulse({ x: 0, y: (turn - av.y) * p.mass * 5.2 * dt, z: 0 }, true);
      if (throttle !== 0) this.fuel = Math.max(0, this.fuel - (Math.abs(throttle) * dt) / 900);
    }
    this.steerAngle = -steer * p.maxSteer;
    this.rpm += (0.15 + 0.85 * Math.abs(throttle) - this.rpm) * Math.min(1, dt * 4);
  }

  applyDamage(amount: number): void {
    if (this.destroyed || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.destroyed = true;
  }

  repair(): void {
    this.health = 100;
    this.destroyed = false;
  }

  reset(x: number, y: number, z: number, heading: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lvx = this.lvy = this.lvz = 0;
    this.spawnGrace = 30;
    this.flipTimer = 0;
  }

  wheelsOnGround(): number {
    if (!this.ctrl) return 0;
    let n = 0;
    for (let i = 0; i < 4; i++) if (this.ctrl.wheelIsInContact(i)) n++;
    return n;
  }

  /** Local wheel centre, steering angle and spin angle, for rendering. */
  wheelPose(i: number): { x: number; y: number; z: number; steer: number; spin: number } {
    const m = this.wheelMounts[i];
    const len = this.ctrl!.wheelSuspensionLength(i) ?? this.profile.suspRest;
    return { x: m[0], y: m[1] - len, z: m[2], steer: i < 2 ? this.steerAngle : 0, spin: this.ctrl!.wheelRotation(i) ?? 0 };
  }

  /** Where a driver ends up when getting out: beside the driver's door, clear of the body. */
  exitPoint(): { x: number; z: number } {
    const h = this.heading();
    const side = this.profile.width / 2 + 0.75;
    // Left of the vehicle (+x local).
    return { x: this.x + Math.cos(h) * side, z: this.z - Math.sin(h) * side };
  }

  dispose(): void {
    if (this.ctrl) this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
  }
}
