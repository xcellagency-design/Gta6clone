import type { InputState } from '../core/Input';
import { GROUP, groups, type Physics } from '../core/Physics';
import { isLandAt } from '../world/CityPlan';

export type PlayerMode = 'foot' | 'vehicle' | 'swim';

const CAPSULE_HALF = 0.52;
const CAPSULE_R = 0.3;
const STAND_CENTRE = CAPSULE_HALF + CAPSULE_R;
export const WATER_LEVEL = -0.6;

export const PLAYER_TUNING = {
  walk: 1.7, run: 4.3, sprint: 7.2, crouch: 1.5, swim: 2.0,
  accel: 22, airAccel: 5, turnRate: 11, jumpSpeed: 5.2, gravity: 16,
};

/**
 * Third-person character: a kinematic capsule moved by Rapier's character controller
 * (slides along walls, steps over kerbs, snaps to ground).
 */
export class PlayerController {
  x = 0; y = 0; z = 0;
  /** Facing, radians. 0 looks along +z; forward = (sin, cos). */
  heading = 0;
  vx = 0; vy = 0; vz = 0;
  speed = 0;
  grounded = true;
  crouching = false;
  sprinting = false;
  mode: PlayerMode = 'foot';
  /** Walk-cycle phase, advanced by distance travelled. */
  stride = 0;
  distanceWalked = 0;
  jumps = 0;
  vehicleId: number | null = null;

  private body;
  private collider;
  private controller;

  constructor(private physics: Physics, x: number, z: number, heading: number) {
    const R = physics.R;
    this.x = x; this.z = z; this.y = 0.2; this.heading = heading;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, this.y + STAND_CENTRE, z));
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R).setCollisionGroups(groups(GROUP.PLAYER, GROUP.WORLD | GROUP.VEHICLE | GROUP.NPC)),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.4, 0.2, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
  }

  /** One simulation step on foot. `camYaw` is the camera's facing so movement is view-relative. */
  update(dt: number, input: InputState, camYaw: number): void {
    if (this.mode === 'vehicle') return;
    const T = PLAYER_TUNING;
    const overWater = !isLandAt(this.x, this.z) && this.y < WATER_LEVEL + 0.2;
    this.mode = overWater && this.y <= WATER_LEVEL - 0.5 ? 'swim' : 'foot';
    const swimming = this.mode === 'swim';

    this.crouching = input.crouch && this.grounded && !swimming;
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    this.sprinting = input.sprint && mag > 0.1 && !this.crouching && !swimming;
    const top = swimming ? T.swim : this.crouching ? T.crouch : this.sprinting ? T.sprint : input.walk ? T.walk : T.run;

    // Camera-relative wish direction.
    const fs = Math.sin(camYaw), fc = Math.cos(camYaw);
    let wx = fs * input.moveY + -fc * input.moveX;
    let wz = fc * input.moveY + fs * input.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    const tvx = wx * top * mag, tvz = wz * top * mag;
    const a = (this.grounded || swimming ? T.accel : T.airAccel) * dt;
    const dvx = tvx - this.vx, dvz = tvz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= a || dl < 1e-6) { this.vx = tvx; this.vz = tvz; }
    else { this.vx += (dvx / dl) * a; this.vz += (dvz / dl) * a; }

    if (mag > 0.1) {
      const want = Math.atan2(wx, wz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, T.turnRate * dt);
    }

    if (swimming) {
      // Buoyancy holds the swimmer just under the surface.
      const targetY = WATER_LEVEL - 1.15;
      this.vy += ((targetY - this.y) * 6 - this.vy * 3) * dt;
    } else {
      if (this.grounded && input.jump && !this.crouching) { this.vy = T.jumpSpeed; this.grounded = false; this.jumps++; }
      this.vy -= T.gravity * dt;
      if (this.grounded && this.vy < 0) this.vy = -2;
    }

    const move = { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt };
    this.controller.computeColliderMovement(this.collider, move, undefined, groups(GROUP.PLAYER, GROUP.WORLD | GROUP.VEHICLE));
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    const t = this.body.translation();
    const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    const moved = Math.hypot(m.x, m.z);
    this.speed = moved / dt;
    this.distanceWalked += moved;
    this.stride += moved * (this.sprinting ? 1.5 : 1.9);
    this.x = nx; this.y = ny - STAND_CENTRE; this.z = nz;
    // Safety net: never fall through the world.
    if (this.y < -30) this.teleport(this.x, 2, this.z);
  }

  teleport(x: number, y: number, z: number, heading = this.heading): void {
    this.x = x; this.y = y; this.z = z; this.heading = heading;
    this.vx = this.vy = this.vz = 0;
    this.body.setTranslation({ x, y: y + STAND_CENTRE, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + STAND_CENTRE, z });
  }

  enterVehicle(id: number): void {
    this.mode = 'vehicle';
    this.vehicleId = id;
    this.collider.setEnabled(false);
    this.vx = this.vy = this.vz = 0;
    this.speed = 0;
  }

  exitVehicle(x: number, y: number, z: number, heading: number): void {
    this.mode = 'foot';
    this.vehicleId = null;
    this.collider.setEnabled(true);
    this.teleport(x, y, z, heading);
    this.grounded = false;
  }

  /** While seated, follow the vehicle. */
  followVehicle(x: number, y: number, z: number, heading: number): void {
    this.x = x; this.y = y; this.z = z; this.heading = heading;
    this.body.setTranslation({ x, y: y + STAND_CENTRE, z }, false);
  }
}
