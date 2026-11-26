import type { InputState } from '../core/Input';
import type { Weather } from '../environment/Environment';
import type { GameApp } from '../main';

/**
 * window.__undertow: the handle the self-test, the screenshot tool and the developer console
 * use to drive and inspect the running game.
 */
export interface DebugApi {
  app: GameApp;
  ready(): boolean;
  state(): Record<string, unknown>;
  input(patch: Partial<InputState>): void;
  pulse(action: 'interact' | 'enterExit' | 'jump' | 'horn'): void;
  /** Advance the simulation n fixed steps (self-test mode). */
  step(n: number): void;
  startGame(): Promise<void>;
  teleport(x: number, z: number, heading?: number): Promise<void>;
  setTime(hour: number): void;
  setWeather(w: Weather): void;
  overlay(on: boolean): void;
  /** Extra commands registered by later systems. */
  commands: Record<string, (...args: string[]) => unknown>;
  errors: string[];
}

export function installDebugApi(app: GameApp): DebugApi {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const api: DebugApi = {
    app,
    errors,
    commands: {},
    ready: () => app.ready,
    state() {
      const s = app.sim, p = s.player, v = s.playerVehicle;
      const info = app.renderer.info();
      return {
        inGame: app.inGame, menu: app.menu.screen, time: s.time, ticks: s.ticks,
        player: { x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, mode: p.mode, grounded: p.grounded, walked: p.distanceWalked },
        vehicle: v ? { id: v.id, profile: v.profile.id, x: v.x, y: v.y, z: v.z, speed: v.speed, gear: v.gear, health: v.health, fuel: v.fuel, distance: v.distance } : null,
        camera: { x: s.camera.x, y: s.camera.y, z: s.camera.z, yaw: s.camera.yaw, fov: s.camera.fov },
        streaming: s.streaming.stats(),
        env: { hour: s.env.hour, weather: s.env.weather, wetness: s.env.wetness, night: s.env.night() },
        render: { ...info, frames: app.renderer.frames, characters: app.renderer.characters.count },
        hud: {
          visible: !app.hud.root.classList.contains('hidden'),
          text: app.hud.root.innerText,
          district: app.hud.root.querySelector('.hud-district')?.textContent ?? '',
          vehiclePanel: !app.hud.root.querySelector('.hud-br')?.classList.contains('hidden'),
          prompt: app.hud.extras.prompt?.text ?? null,
        },
        vehicles: s.vehicles.all.size, waitingForWorld: s.waitingForWorld, stepMs: s.stepMs,
        events: s.bus.log.slice(-30).map((e) => e.type),
        errors,
      };
    },
    input: (patch) => app.scripted?.set(patch),
    pulse: (a) => app.scripted?.pulse(a),
    step(n) {
      for (let i = 0; i < n; i++) { app.sim.streamTick(1 / 60, 8); app.sim.step(); }
    },
    startGame: () => app.startGame(),
    teleport: (x, z, h) => app.sim.teleport(x, z, h),
    setTime: (h) => { app.sim.env.hour = h; },
    setWeather: (w) => app.sim.env.setWeather(w, true),
    overlay: (on) => { if (app.overlay.visible !== on) app.overlay.toggle(); },
  };
  (window as unknown as { __undertow: DebugApi }).__undertow = api;
  return api;
}
