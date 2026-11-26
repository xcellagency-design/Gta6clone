import { QUALITY, SIM_DT, WORLD_SEED } from './core/config';
import { GameSim } from './core/GameSim';
import { BrowserInput, ScriptedInput, type InputSource } from './core/Input';
import { installDebugApi } from './dev/DebugApi';
import { GameRenderer } from './render/GameRenderer';
import { InlineExecutor, WorkerExecutor } from './streaming/executors';
import type { CellExecutor, StreamFocus } from './streaming/StreamingManager';
import { DebugOverlay } from './ui/DebugOverlay';
import { el } from './ui/dom';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import './ui/style.css';

const SETTINGS_KEY = 'undertow.settings';

export interface Settings { quality: string; sensitivity: number; volume: number; invertY: boolean }

function loadSettings(): Settings {
  const d: Settings = { quality: 'medium', sensitivity: 1, volume: 0.7, invertY: false };
  try { Object.assign(d, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); } catch { /* defaults */ }
  return d;
}

/** Vantage for the main-menu backdrop: over the bay, looking at the Meridian Center skyline. */
const MENU_FOCUS: StreamFocus = { x: 2850, z: 2050, vx: 0, vz: 0, camX: -0.6, camZ: -0.8 };

export class GameApp {
  sim!: GameSim;
  renderer!: GameRenderer;
  hud!: Hud;
  menu!: Menu;
  overlay!: DebugOverlay;
  input!: InputSource;
  scripted: ScriptedInput | null = null;
  settings = loadSettings();
  /** In self-test mode the simulation only advances when the test steps it. */
  manual = false;
  inGame = false;
  ready = false;
  private acc = 0;
  private last = 0;
  private menuT = 0;
  readonly ui = document.getElementById('ui')!;
  /** Called every rendered frame while in game; later systems hook in here. */
  readonly frameHooks: ((dt: number) => void)[] = [];
  /** Systems contribute their part of a new game / quit here. */
  readonly onNewGame: (() => void | Promise<void>)[] = [];

  async boot(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const boot = el('div.boot', el('b', 'UNDERTOW'), 'LOADING PORT MERIDIAN');
    this.ui.append(boot);
    const selftest = params.has('selftest');
    this.manual = selftest;
    const qName = params.get('quality') ?? this.settings.quality;
    const quality = QUALITY[qName] ?? QUALITY.medium;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new GameRenderer(canvas, quality);

    let executor: CellExecutor;
    try {
      if (params.has('noworkers')) throw new Error('workers disabled');
      executor = new WorkerExecutor(WORLD_SEED, Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)));
    } catch (e) {
      console.warn('Web Workers unavailable; generating cells on the main thread.', e);
      executor = new InlineExecutor(WORLD_SEED, 1);
    }
    if (selftest) { this.scripted = new ScriptedInput(); this.input = this.scripted; }
    else this.input = new BrowserInput(canvas);

    this.sim = await GameSim.create({ executor, views: this.renderer, quality, input: this.input });
    this.sim.camera.sensitivity = 0.0026 * this.settings.sensitivity;
    this.hud = new Hud(this.ui, this.sim);
    this.overlay = new DebugOverlay(this.ui);
    this.overlay.renderInfo = () => this.renderer.info();
    this.menu = new Menu(this.ui, {
      newGame: () => void this.startGame(),
      continueGame: () => void this.continueGame(),
      hasSave: () => this.hasSave(),
      resume: () => this.resume(),
      quitToMenu: () => this.toMenu(),
      settings: this.settings,
      applySettings: () => this.applySettings(),
      pauseItems: [],
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.overlay.toggle(); }
      if (e.code === 'Escape' && this.inGame) (this.menu.open ? this.resume() : this.pause());
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.inGame && !this.menu.open && !this.manual) this.pause();
    });

    installDebugApi(this);
    this.hud.setVisible(false);
    this.toMenu();
    // Bring the backdrop in before the first frame is shown.
    await this.sim.streaming.loadAround(MENU_FOCUS, 2, 15000);
    boot.remove();
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (params.has('autostart')) await this.startGame();
  }

  /** Overridden once the save system is installed. */
  hasSave: () => boolean = () => false;
  continueGame: () => Promise<void> = async () => {};

  applySettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    this.sim.camera.sensitivity = 0.0026 * this.settings.sensitivity * (this.settings.invertY ? -1 : 1);
    this.onSettings.forEach((f) => f());
  }
  readonly onSettings: (() => void)[] = [];

  toMenu(): void {
    this.inGame = false;
    this.sim.paused = true;
    this.hud.setVisible(false);
    if (this.input instanceof BrowserInput) { this.input.enabled = false; this.input.releasePointer(); }
    this.menu.main();
  }

  async startGame(): Promise<void> {
    await this.menu.fadeThrough(async () => {
      this.menu.close();
      this.sim.camera.cinematic = null;
      await this.sim.newGame();
      for (const f of this.onNewGame) await f();
      this.enterPlay();
    });
  }

  enterPlay(): void {
    this.sim.camera.cinematic = null;
    this.menu.close();
    this.inGame = true;
    this.sim.paused = false;
    this.hud.setVisible(true);
    this.acc = 0;
    if (this.input instanceof BrowserInput) this.input.enabled = true;
  }

  pause(): void {
    if (!this.inGame) return;
    this.sim.paused = true;
    if (this.input instanceof BrowserInput) { this.input.enabled = false; this.input.releasePointer(); }
    this.menu.pause();
  }

  resume(): void {
    this.menu.close();
    this.sim.paused = false;
    if (this.input instanceof BrowserInput) this.input.enabled = true;
  }

  private frame(t: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.overlay.frame(dt);
    if (!this.inGame) {
      // Slow drift across the bay behind the menu.
      this.menuT += dt;
      const a = this.menuT * 0.02;
      this.sim.camera.cinematic = { x: 3330 + Math.sin(a) * 120, y: 46 + Math.sin(a * 1.7) * 6, z: 2560 + Math.cos(a) * 90, tx: 2500, ty: 70, tz: 1720, fov: 52 };
      this.sim.camera.update(dt, this.sim.lastInput, this.sim.player, null);
      this.sim.streaming.update(dt, MENU_FOCUS);
      this.sim.env.update(dt * 6);
    } else {
      if (!this.manual && !this.sim.paused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= SIM_DT && n < 5) { this.sim.step(); this.acc -= SIM_DT; n++; }
        if (n === 5) this.acc = 0;
      }
      this.sim.streamTick(dt);
      for (const f of this.frameHooks) f(dt);
      this.updatePrompt();
      this.hud.update(this.sim);
    }
    this.overlay.update(this.sim, dt);
    this.renderer.render(this.sim, dt);
  }

  /** Lower-priority prompt providers (shops, missions) are consulted when no vehicle is near. */
  readonly promptProviders: (() => { key: string; text: string } | null)[] = [];

  private updatePrompt(): void {
    const s = this.sim;
    let prompt: { key: string; text: string } | null = null;
    if (!s.playerVehicle) {
      const v = s.vehicles.nearest(s.player.x, s.player.z, 3.0);
      if (v && !v.destroyed) prompt = { key: 'F', text: `${v.owner === 'npc' ? 'Take' : 'Enter'} the ${v.profile.name}` };
    } else if (Math.abs(s.playerVehicle.speed) < 0.6 && s.time % 60 < 6) prompt = { key: 'F', text: 'Get out' };
    for (const p of this.promptProviders) { if (prompt) break; prompt = p(); }
    this.hud.extras.prompt = prompt;
  }
}

const app = new GameApp();
app.boot().catch((e) => {
  console.error(e);
  document.getElementById('ui')!.append(el('div.boot', el('b', 'UNDERTOW'), 'FAILED TO START — ' + String(e?.message ?? e)));
});
