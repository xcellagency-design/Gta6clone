import type { EventBus } from '../core/EventBus';
import type { Physics } from '../core/Physics';
import { hash2 } from '../core/rng';
import { PARKING_STRIDE, type CellData } from '../streaming/CellData';
import { cellKey } from '../world/CityPlan';
import { Vehicle, type VehicleControls, type VehicleEnv } from './Vehicle';
import { PARKING_PROFILES, vehicleProfile } from './VehicleProfile';

const IDLE: VehicleControls = { throttle: 0, steer: 0, handbrake: true };

export interface SavedVehicle { profile: string; x: number; y: number; z: number; heading: number; color: string; health: number; fuel: number; owner: string; stored: boolean }

/**
 * Owns every vehicle in the world: parked cars that stream in and out with their cell, and
 * persistent ones (anything the player owns or has driven) that survive unloading and saving.
 */
export class VehicleManager {
  readonly all = new Map<number, Vehicle>();
  /** Parked vehicles by slot key, so a cell's cars leave with the cell. */
  private parked = new Map<string, Vehicle>();
  /** Slots whose car was driven away; they stay empty for the rest of the session. */
  private takenSlots = new Set<string>();
  /** Vehicles kept regardless of streaming. */
  readonly persistent = new Set<Vehicle>();
  /** Owned vehicles put away in a garage. */
  stored: SavedVehicle[] = [];
  playerVehicle: Vehicle | null = null;
  maxParked = 60;
  hibernating = 0;

  constructor(private physics: Physics, private bus: EventBus, private isSolidAt: (x: number, z: number) => boolean) {}

  spawn(profileId: string, x: number, y: number, z: number, heading: number, color?: string): Vehicle {
    const v = new Vehicle(this.physics, vehicleProfile(profileId), x, y, z, heading, color);
    this.all.set(v.id, v);
    return v;
  }

  remove(v: Vehicle): void {
    if (v === this.playerVehicle) return;
    this.all.delete(v.id);
    this.persistent.delete(v);
    v.dispose();
  }

  /** Streaming callback: a cell's full-detail data arrived or left. */
  onDetail(data: CellData, present: boolean): void {
    const prefix = cellKey(data.cx, data.cz) + ':';
    if (present) {
      const n = data.parking.length / PARKING_STRIDE;
      for (let i = 0; i < n; i++) {
        const slot = prefix + i;
        if (this.takenSlots.has(slot) || this.parked.has(slot) || this.parked.size >= this.maxParked) continue;
        const o = i * PARKING_STRIDE;
        const id = PARKING_PROFILES[data.parking[o + 3]] ?? 'sedan';
        const p = vehicleProfile(id);
        const color = p.colors[Math.floor(hash2(data.cx * 131 + i, data.cz * 71, 9) * p.colors.length)];
        const v = this.spawn(id, data.parking[o], id === 'boat' ? -0.8 : 0.15, data.parking[o + 1], data.parking[o + 2], color);
        (v as { slot?: string }).slot = slot;
        this.parked.set(slot, v);
      }
    } else {
      for (const [slot, v] of this.parked) {
        if (!slot.startsWith(prefix)) continue;
        this.parked.delete(slot);
        if (!this.persistent.has(v)) this.remove(v);
      }
    }
  }

  /** The player took this vehicle: it is no longer part of the street scenery. */
  claim(v: Vehicle): void {
    const slot = (v as { slot?: string }).slot;
    if (slot) { this.parked.delete(slot); this.takenSlots.add(slot); (v as { slot?: string }).slot = undefined; }
    this.persistent.add(v);
    // Keep the list of abandoned vehicles short: drop the oldest that is not owned.
    if (this.persistent.size > 8) {
      for (const old of this.persistent) {
        if (old !== v && old !== this.playerVehicle && old.owner !== 'player') { this.remove(old); break; }
      }
    }
  }

  nearest(x: number, z: number, maxDist: number): Vehicle | null {
    let best: Vehicle | null = null, bd = maxDist;
    for (const v of this.all.values()) {
      const d = Math.hypot(v.x - x, v.z - z) - v.profile.width / 2;
      if (d < bd && !v.occupied) { bd = d; best = v; }
    }
    return best;
  }

  update(dt: number, controls: VehicleControls, env: VehicleEnv): void {
    this.hibernating = 0;
    for (const v of this.all.values()) {
      // A vehicle whose ground is not loaded sleeps exactly where it is.
      const solid = v.isBoat || this.isSolidAt(v.x, v.z);
      if (!solid) {
        if (v.body.isEnabled()) v.body.setEnabled(false);
        this.hibernating++;
        continue;
      }
      if (!v.body.isEnabled()) v.body.setEnabled(true);
      const hpBefore = v.health;
      v.update(dt, v === this.playerVehicle ? controls : IDLE, env);
      if (v.health < hpBefore && v.lastImpact > 0) {
        this.bus.emit('vehicle.damaged', { vehicleId: v.id, amount: hpBefore - v.health, health: v.health });
        if (v.destroyed) this.bus.emit('vehicle.destroyed', { vehicleId: v.id });
      }
    }
  }

  snapshot(): { vehicles: SavedVehicle[]; stored: SavedVehicle[]; player: number } {
    const list = [...this.persistent];
    return {
      vehicles: list.map((v) => ({ profile: v.profile.id, x: v.x, y: v.y, z: v.z, heading: v.heading(), color: v.color, health: v.health, fuel: v.fuel, owner: v.owner, stored: false })),
      stored: this.stored.map((s) => ({ ...s })),
      player: this.playerVehicle ? list.indexOf(this.playerVehicle) : -1,
    };
  }

  restore(s: { vehicles: SavedVehicle[]; stored: SavedVehicle[]; player: number }): Vehicle | null {
    for (const v of [...this.persistent]) { if (v === this.playerVehicle) this.playerVehicle = null; this.remove(v); }
    let player: Vehicle | null = null;
    s.vehicles.forEach((sv, i) => {
      const v = this.spawn(sv.profile, sv.x, sv.y - vehicleProfile(sv.profile).rideHeight - 0.1, sv.z, sv.heading, sv.color);
      v.health = sv.health; v.fuel = sv.fuel; v.owner = sv.owner as Vehicle['owner']; v.destroyed = sv.health <= 0;
      this.persistent.add(v);
      if (i === s.player) player = v;
    });
    this.stored = s.stored.map((x) => ({ ...x }));
    return player;
  }
}
