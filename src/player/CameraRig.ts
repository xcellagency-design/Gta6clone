import type { InputState } from '../core/Input';
import type { Physics } from '../core/Physics';
import type { Vehicle } from '../vehicles/Vehicle';
import type { PlayerController } from './PlayerController';

/**
 * Third-person camera: orbits the player on foot, chases the vehicle when driving. A ray from
 * the target keeps it out of walls, and every change — mode, distance, field of view — eases.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.1;
  x = 0; y = 3; z = 0;
  tx = 0; ty = 1.5; tz = 0;
  fov = 60;
  private dist = 4.4;
  private idle = 0;
  sensitivity = 0.0026;
  cinematic: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number } | null = null;

  constructor(private physics: Physics) {}

  snapBehind(heading: number): void {
    this.yaw = heading;
    this.idle = 10;
  }

  update(dt: number, input: InputState, player: PlayerController, vehicle: Vehicle | null): void {
    if (this.cinematic) {
      const c = this.cinematic;
      this.x = c.x; this.y = c.y; this.z = c.z; this.tx = c.tx; this.ty = c.ty; this.tz = c.tz; this.fov = c.fov;
      return;
    }
    const looked = Math.abs(input.lookX) + Math.abs(input.lookY) > 0.01;
    this.yaw -= input.lookX * this.sensitivity;
    this.pitch = Math.max(-0.45, Math.min(1.25, this.pitch + input.lookY * this.sensitivity));
    this.idle = looked ? 0 : this.idle + dt;

    let wantDist: number, wantFov: number, tx: number, ty: number, tz: number, shoulder = 0;
    if (vehicle) {
      const sp = Math.abs(vehicle.speed);
      tx = vehicle.x; tz = vehicle.z; ty = vehicle.y + vehicle.profile.height * 0.55 + 0.5;
      wantDist = 4.6 + vehicle.profile.length * 0.62 + Math.min(3.5, sp * 0.06);
      wantFov = 58 + Math.min(20, sp * 0.42);
      // Swing back behind the vehicle when the player is not steering the camera.
      if (this.idle > 0.9 && sp > 1.5) {
        const want = vehicle.heading() + (vehicle.speed < -1 ? Math.PI : 0);
        const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += d * Math.min(1, dt * 2.6);
        this.pitch += (0.13 - this.pitch) * Math.min(1, dt * 1.5);
      }
    } else {
      tx = player.x; tz = player.z;
      ty = player.y + (player.crouching ? 1.15 : player.mode === 'swim' ? 1.9 : 1.58);
      wantDist = player.sprinting ? 4.9 : 4.2;
      wantFov = player.sprinting ? 66 : 60;
      shoulder = 0.4;
    }
    const k = Math.min(1, dt * 9);
    this.tx += (tx - this.tx) * Math.min(1, dt * 14);
    this.ty += (ty - this.ty) * Math.min(1, dt * 10);
    this.tz += (tz - this.tz) * Math.min(1, dt * 14);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3.5);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 3);

    const fs = Math.sin(this.yaw), fc = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // Look target sits over the right shoulder on foot.
    const ox = this.tx + -fc * shoulder, oz = this.tz + fs * shoulder;
    const dx = -fs * cp, dy = sp, dz = -fc * cp;
    let d = this.dist;
    const hit = this.physics.raycastWorld(ox, this.ty, oz, dx, dy, dz, this.dist + 0.3);
    if (hit !== null) d = Math.max(0.5, Math.min(d, hit - 0.25));
    const px = ox + dx * d, py = Math.max(0.25, this.ty + dy * d), pz = oz + dz * d;
    // Pull in instantly when blocked, ease back out.
    const near = Math.hypot(px - ox, py - this.ty, pz - oz) < Math.hypot(this.x - ox, this.y - this.ty, this.z - oz);
    const kk = near ? 1 : k;
    this.x += (px - this.x) * kk; this.y += (py - this.y) * kk; this.z += (pz - this.z) * kk;
    if (Math.hypot(px - this.x, pz - this.z) > 60) { this.x = px; this.y = py; this.z = pz; }
  }
}
