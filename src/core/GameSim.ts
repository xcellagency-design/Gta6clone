import { Environment } from '../environment/Environment';
import { CameraRig } from '../player/CameraRig';
import { PlayerController } from '../player/PlayerController';
import type { CellData } from '../streaming/CellData';
import { StreamingManager, type CellExecutor, type StreamFocus, type ViewFactory } from '../streaming/StreamingManager';
import type { Vehicle } from '../vehicles/Vehicle';
import { VehicleManager } from '../vehicles/VehicleManager';
import { SPAWN } from '../world/CityPlan';
import { QUALITY, SIM_DT, WORLD_SEED, type QualitySettings } from './config';
import { EventBus } from './EventBus';
import { emptyInput, type InputSource, type InputState } from './Input';
import { Physics } from './Physics';

export interface SimOptions {
  seed?: number;
  executor: CellExecutor;
  views?: ViewFactory;
  quality?: QualitySettings;
  input: InputSource;
}

/** A system that advances with the simulation. Added in dependency order. */
export interface SimSystem {
  update(dt: number): void;
}

/**
 * The whole game without a screen: physics, streaming, the player, vehicles and every gameplay
 * system, advanced in fixed 1/60 s steps. The browser app draws it; the unit tests and the
 * self-test drive it directly.
 */
export class GameSim {
  readonly bus = new EventBus();
  readonly seed: number;
  readonly quality: QualitySettings;
  readonly physics: Physics;
  readonly env: Environment;
  readonly streaming: StreamingManager;
  readonly player: PlayerController;
  readonly vehicles: VehicleManager;
  readonly camera: CameraRig;
  readonly systems: SimSystem[] = [];
  /** Listeners for cells gaining or losing full detail (parking, pedestrians, points of interest). */
  readonly detailListeners: ((data: CellData, present: boolean) => void)[] = [];
  input: InputSource;
  lastInput: InputState = emptyInput();
  time = 0;
  ticks = 0;
  paused = false;
  /** The player is held still because the ground under them has not streamed in yet. */
  waitingForWorld = false;
  stepMs = 0;

  private constructor(physics: Physics, o: SimOptions) {
    this.physics = physics;
    this.seed = o.seed ?? WORLD_SEED;
    this.quality = o.quality ?? QUALITY.medium;
    this.input = o.input;
    this.env = new Environment(this.seed, this.bus);
    this.streaming = new StreamingManager({
      lodRadius: this.quality.lodRadius,
      executor: o.executor,
      views: o.views,
      colliders: physics,
      bus: this.bus,
      onDetail: (data, present) => { for (const fn of this.detailListeners) fn(data, present); },
    });
    this.player = new PlayerController(physics, SPAWN.x, SPAWN.z, SPAWN.heading);
    this.vehicles = new VehicleManager(physics, this.bus, (x, z) => this.streaming.isSolidAt(x, z));
    this.detailListeners.push((d, p) => this.vehicles.onDetail(d, p));
    this.camera = new CameraRig(physics);
    this.camera.snapBehind(SPAWN.heading);
  }

  static async create(o: SimOptions): Promise<GameSim> {
    return new GameSim(await Physics.create(), o);
  }

  /** Loads the area around the player and places them on the ground. */
  async enterWorld(): Promise<void> {
    await this.streaming.loadAround(this.focus(), 1);
    this.player.teleport(this.player.x, 0.3, this.player.z);
    this.bus.emit('player.spawned', { x: this.player.x, z: this.player.z });
  }

  /** A new game starts at Navarro Salvage with the yard's old sedan parked beside you. */
  async newGame(): Promise<void> {
    this.player.teleport(SPAWN.x, 0.3, SPAWN.z, SPAWN.heading);
    this.camera.snapBehind(SPAWN.heading);
    await this.enterWorld();
    // Parked facing the west gate, clear of where the player stands.
    const v = this.vehicles.spawn('sedan', SPAWN.x + 10, 0.15, SPAWN.z + 5, -Math.PI / 2, '#8a8f6a');
    v.owner = 'player';
    this.vehicles.persistent.add(v);
  }

  focus(): StreamFocus {
    const v = this.vehicles.playerVehicle;
    const fs = Math.sin(this.camera.yaw), fc = Math.cos(this.camera.yaw);
    if (v) {
      const lv = v.body.linvel();
      return { x: v.x, z: v.z, vx: lv.x, vz: lv.z, camX: fs, camZ: fc };
    }
    return { x: this.player.x, z: this.player.z, vx: this.player.vx, vz: this.player.vz, camX: fs, camZ: fc };
  }

  /** Streaming runs once per rendered frame with real elapsed time. */
  streamTick(dt: number, budgetMs?: number): void {
    this.streaming.update(dt, this.focus(), budgetMs);
  }

  get playerVehicle(): Vehicle | null {
    return this.vehicles.playerVehicle;
  }

  private tryEnterExit(): void {
    const p = this.player;
    const cur = this.vehicles.playerVehicle;
    if (cur) {
      if (Math.abs(cur.speed) > 7) { this.bus.emit('notify', { text: 'Slow down to get out.' }); return; }
      let e = cur.exitPoint();
      // Driver's side blocked by a wall? Use the other door.
      const h = cur.heading();
      const side = cur.profile.width / 2 + 0.9;
      if (this.physics.raycastWorld(cur.x, cur.y + 0.3, cur.z, Math.cos(h), 0, -Math.sin(h), side) !== null) {
        e = { x: cur.x - Math.cos(h) * (side - 0.15), z: cur.z + Math.sin(h) * (side - 0.15) };
      }
      cur.occupied = false;
      this.vehicles.playerVehicle = null;
      p.exitVehicle(e.x, Math.max(cur.isBoat ? 0.2 : 0.05, cur.y - cur.profile.rideHeight + 0.1), e.z, h);
      this.bus.emit('vehicle.exited', { vehicleId: cur.id });
      return;
    }
    const v = this.vehicles.nearest(p.x, p.z, 3.0);
    if (!v || v.destroyed) return;
    const stolen = v.owner === 'npc';
    v.occupied = true;
    this.vehicles.playerVehicle = v;
    this.vehicles.claim(v);
    p.enterVehicle(v.id);
    this.camera.snapBehind(v.heading());
    this.bus.emit('vehicle.entered', { vehicleId: v.id, stolen, profile: v.profile.id });
  }

  /** One fixed simulation step. */
  step(): void {
    if (this.paused) return;
    const t0 = performance.now();
    const dt = SIM_DT;
    const input = this.input.sample();
    this.lastInput = input;
    this.bus.now = this.time;
    this.env.update(dt);

    const focus = this.vehicles.playerVehicle ?? this.player;
    this.waitingForWorld = !this.streaming.isSolidAt(focus.x, focus.z) && !(this.vehicles.playerVehicle?.isBoat);

    if (input.enterExit) this.tryEnterExit();
    const v = this.vehicles.playerVehicle;
    if (!this.waitingForWorld) {
      this.player.update(dt, input, this.camera.yaw);
      this.vehicles.update(dt, { throttle: input.moveY, steer: input.moveX, handbrake: input.handbrake }, { grip: this.env.grip() });
      for (const s of this.systems) s.update(dt);
      this.physics.step();
    }
    if (v) {
      const h = v.heading();
      this.player.followVehicle(v.x, v.y - v.profile.rideHeight + (v.isBike ? 0.2 : 0.02), v.z, h);
    }
    this.camera.update(dt, input, this.player, this.vehicles.playerVehicle);
    this.time += dt;
    this.ticks++;
    this.stepMs += (performance.now() - t0 - this.stepMs) * 0.05;
  }

  /** Teleport (dev command, fast travel, respawn). Loads the destination before arriving. */
  async teleport(x: number, z: number, heading = this.player.heading): Promise<void> {
    const v = this.vehicles.playerVehicle;
    if (v) v.reset(x, v.isBoat ? -0.3 : v.profile.rideHeight + 0.3, z, heading);
    else this.player.teleport(x, 0.4, z, heading);
    this.camera.snapBehind(heading);
    await this.streaming.loadAround({ x, z, vx: 0, vz: 0, camX: Math.sin(heading), camZ: Math.cos(heading) }, 1);
    if (v) v.reset(x, v.isBoat ? -0.3 : v.profile.rideHeight + 0.3, z, heading);
    else this.player.teleport(x, 0.4, z, heading);
  }
}
