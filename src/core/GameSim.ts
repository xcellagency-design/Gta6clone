import { Economy } from '../economy/Economy';
import { Environment } from '../environment/Environment';
import { MissionSystem } from '../missions/MissionSystem';
import { Characters } from '../npc/Characters';
import { allPois } from '../world/Pois';
import type { SlotId } from '../save/SaveSystem';
import { CameraRig } from '../player/CameraRig';
import { PlayerController } from '../player/PlayerController';
import type { CellData } from '../streaming/CellData';
import { PedSim } from '../npc/PedSim';
import { WantedSystem } from '../police/WantedSystem';
import { TrafficSim } from '../traffic/TrafficSim';
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
  readonly traffic: TrafficSim;
  readonly peds: PedSim;
  readonly wanted: WantedSystem;
  readonly economy: Economy;
  readonly missions: MissionSystem;
  readonly characters: Characters;
  /** The vehicle the player most recently got out of. */
  lastVehicle: Vehicle | null = null;
  /** Set by the app: writes a save slot. Null in contexts with nowhere to save. */
  onSaveRequest: ((slot: SlotId) => boolean) | null = null;
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
    this.traffic = new TrafficSim(physics, this.env, this.vehicles, this.bus, () => this.focus(), () => this.time, this.quality.maxTraffic, this.seed);
    this.peds = new PedSim(
      physics, this.env, this.vehicles, this.bus,
      () => ({ x: this.player.x, z: this.player.z, speed: this.player.speed, onFoot: this.player.mode !== 'vehicle' }),
      () => this.time, this.quality.maxPedestrians, this.seed,
    );
    this.detailListeners.push((d, p) => this.peds.onDetail(d, p));
    this.traffic.obstacles.push(() => this.peds.roadObstacles());
    // Drivers stop for the player on foot as they would for anyone else.
    this.traffic.obstacles.push(() => (this.player.mode === 'vehicle' ? [] : [{ x: this.player.x, z: this.player.z, r: 0.9 }]));
    this.wanted = new WantedSystem(
      physics, this.env, this.traffic, this.vehicles, this.bus,
      () => {
        const v = this.vehicles.playerVehicle;
        return { x: v ? v.x : this.player.x, z: v ? v.z : this.player.z, speed: v ? Math.abs(v.speed) : this.player.speed, vehicle: v };
      },
      this.seed,
    );
    this.wanted.onBusted = () => this.afterBust();
    this.economy = new Economy(this.bus, this.env);
    const pois = new Map(allPois().map((p) => [p.id, p]));
    this.economy.poiLookup = (id) => pois.get(id);
    this.wanted.chargeFine = (n) => this.economy.fine(n);
    this.wanted.cashOnHand = () => this.economy.cash;
    this.missions = new MissionSystem(this.bus, this.economy, this.wanted, {
      player: () => {
        const v = this.vehicles.playerVehicle;
        return { x: v ? v.x : this.player.x, z: v ? v.z : this.player.z, vehicle: v, speed: v ? Math.abs(v.speed) : this.player.speed, interact: this.lastInput.interact };
      },
      isAlive: (id) => this.isAlive(id),
    });
    this.characters = new Characters(this.env, (id) => this.isAlive(id));
    // The cast remembers the decisions that touched them.
    this.bus.on('narrative.choice', (e) => {
      const node = this.missions.story.graph.nodes.find((n) => n.id === e.node);
      const choice = node?.choices.find((c) => c.id === e.choice);
      if (!choice) return;
      for (const c of ['jun', 'toby', 'brandt', 'sal']) {
        if (choice.effects.some((f) => 'var' in f && f.var.endsWith('_' + c))) this.characters.remember(c, 'choice:' + choice.label);
      }
      if (node?.mission) this.characters.remember(node.mission.giver, 'choice:' + choice.label);
    });
    this.systems.push(this.traffic, this.peds, this.wanted, this.missions, { update: () => this.economy.update() });
  }

  /** Story flags decide who is still around. */
  isAlive(character: string): boolean {
    const f = this.missions.story.flags[character + '_alive'];
    if (character === 'mama_tide') return !this.missions.story.flags.mama_tide_dead;
    if (character === 'whitlock') return !this.missions.story.flags.whitlock_dead;
    return f !== false;
  }

  /** Released outside the Meridian Center station, on foot, a few hours later. */
  private afterBust(): void {
    const v = this.vehicles.playerVehicle;
    if (v) { v.occupied = false; this.vehicles.playerVehicle = null; this.player.exitVehicle(v.x, 0.3, v.z, 0); }
    const st = WantedSystem.station();
    this.env.hour = (this.env.hour + 3) % 24;
    void this.teleport(st.x, st.z, 0);
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
    // A fresh playthrough: nothing carries over from whatever was running before.
    this.leaveVehicle();
    for (const old of [...this.vehicles.persistent]) this.vehicles.remove(old);
    this.vehicles.stored = [];
    this.lastVehicle = null;
    this.time = 0;
    this.env.restore({ hour: 9.5, day: 1, weather: 'clear', wetness: 0, minutesLeft: 300 });
    this.economy.restore({ cash: 400, inventory: { repairKits: 0, fuelCans: 0, burnerPhones: 0 }, properties: [], lastIncomeDay: 1, earned: 0, spent: 0, outfit: { shirt: 0x3d5a73, pants: 0x2b2d33 } });
    this.wanted.restore({ notoriety: 0, busts: 0, escapes: 0, crimesReported: 0 });
    this.characters.restore({});
    this.missions.sideDone.clear();
    this.missions.storyDone = 0;
    this.missions.failures = 0;
    this.missions.replay([]);
    this.player.stamina = 1;
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

  /** Seat the player in a vehicle directly (story set-ups, loading, tests). */
  putInVehicle(v: Vehicle): void {
    this.leaveVehicle();
    v.occupied = true;
    this.vehicles.playerVehicle = v;
    this.vehicles.claim(v);
    this.player.enterVehicle(v.id);
    this.camera.snapBehind(v.heading());
  }

  leaveVehicle(): void {
    const cur = this.vehicles.playerVehicle;
    if (!cur) return;
    const e = cur.exitPoint();
    cur.occupied = false;
    this.lastVehicle = cur;
    this.vehicles.playerVehicle = null;
    this.player.exitVehicle(e.x, Math.max(0.05, cur.y - cur.profile.rideHeight + 0.1), e.z, cur.heading());
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
      this.lastVehicle = cur;
      this.vehicles.playerVehicle = null;
      p.exitVehicle(e.x, Math.max(cur.isBoat ? 0.2 : 0.05, cur.y - cur.profile.rideHeight + 0.1), e.z, h);
      this.bus.emit('vehicle.exited', { vehicleId: cur.id });
      return;
    }
    let v = this.vehicles.nearest(p.x, p.z, 3.0);
    let carjack = false;
    if (!v) { v = this.traffic.claimNear(p.x, p.z, 3.0); carjack = !!v; }
    if (!v || v.destroyed) return;
    const stolen = v.owner !== 'player';
    v.occupied = true;
    this.vehicles.playerVehicle = v;
    this.vehicles.claim(v);
    p.enterVehicle(v.id);
    this.camera.snapBehind(v.heading());
    this.bus.emit('vehicle.entered', { vehicleId: v.id, stolen, profile: v.profile.id, carjack });
    if (stolen && !v.hot) {
      v.hot = true;
      this.bus.emit('crime.committed', { type: carjack ? 'carjack' : 'vehicle_theft', x: v.x, z: v.z, severity: carjack ? 3 : 2 });
    }
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
      if (this.ticks % 60 === 0) this.vehicles.cullTransient(focus.x, focus.z);
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
