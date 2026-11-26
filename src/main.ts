import { AudioEngine } from './audio/AudioEngine';
import { QUALITY, SIM_DT, WORLD_SEED } from './core/config';
import { GameSim } from './core/GameSim';
import { BrowserInput, ScriptedInput, type InputSource } from './core/Input';
import { installConsole } from './dev/Console';
import { installDebugApi, type DebugApi } from './dev/DebugApi';
import { installSelfTest } from './dev/SelfTestSteps';
import { useItem } from './economy/Interactions';
import type { Weather } from './environment/Environment';
import { anchorFor, REGISTRY } from './missions/MissionSystem';
import type { EndingDef } from './narrative/types';
import { GameRenderer } from './render/GameRenderer';
import { MarkerRenderer } from './render/MarkerRenderer';
import { applyState, captureState, saveMeta, validateSave, type GameSave } from './save/GameState';
import { SaveSystem, type SlotId } from './save/SaveSystem';
import { InlineExecutor, WorkerExecutor } from './streaming/executors';
import type { CellExecutor, StreamFocus } from './streaming/StreamingManager';
import { DebugOverlay } from './ui/DebugOverlay';
import { el } from './ui/dom';
import { Hud } from './ui/Hud';
import { drawMap } from './ui/MapView';
import { Menu } from './ui/Menu';
import { characterPanel, decisionPanel, endingScreen, mapPanel, poiPanel, savePanel } from './ui/Panels';
import './ui/style.css';
import { allPois } from './world/Pois';

const SETTINGS_KEY = 'undertow.settings';
const ENDINGS_KEY = 'undertow.endings';

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
  audio = new AudioEngine();
  saves!: SaveSystem<GameSave>;
  api!: DebugApi;
  settings = loadSettings();
  /** In self-test mode the simulation only advances when the test steps it. */
  manual = false;
  inGame = false;
  ready = false;
  private acc = 0;
  private last = 0;
  private menuT = 0;
  private autosave = 0;
  private markers = new MarkerRenderer();
  private minimap = el('canvas.minimap', { width: 176, height: 176 });
  private dialogue = el('div.hud-objective.hidden');
  private panelOpen = false;
  private pressed = new Set<string>();
  private endingShown: EndingDef | null = null;
  private endingT = 0;
  readonly ui = document.getElementById('ui')!;

  async boot(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const boot = el('div.boot', el('b', 'UNDERTOW'), 'LOADING PORT MERIDIAN');
    this.ui.append(boot);
    const selftest = params.has('selftest');
    this.manual = selftest;
    const quality = QUALITY[params.get('quality') ?? this.settings.quality] ?? QUALITY.medium;
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
    else {
      const bi = new BrowserInput(canvas);
      bi.onKey = (code) => { this.pressed.add(code); this.audio.start(this.sim); };
      canvas.addEventListener('pointerdown', () => this.audio.start(this.sim));
      this.input = bi;
    }

    this.sim = await GameSim.create({ executor, views: this.renderer, quality, input: this.input });
    const sim = this.sim;
    this.saves = new SaveSystem<GameSave>(localStorage, validateSave);
    sim.onSaveRequest = (slot) => this.saveGame(slot);
    this.applySettings();

    this.hud = new Hud(this.ui, sim);
    this.hud.mapSlot.append(this.minimap);
    this.dialogue.style.cssText = 'top:auto;bottom:16%;max-width:70vw;font-size:18px';
    this.hud.root.append(this.dialogue);
    this.overlay = new DebugOverlay(this.ui);
    this.overlay.renderInfo = () => this.renderer.info();
    this.overlay.counts = () => {
      const cells = [...sim.streaming.cells.values()];
      return {
        npcFull: sim.peds.stats.full, npcSimple: sim.peds.stats.simple, npcStat: sim.peds.estimateStatistical(cells),
        trafficPhysical: sim.traffic.stats.physical, trafficKinematic: sim.traffic.stats.kinematic, trafficStat: sim.traffic.stats.statistical,
      };
    };
    this.renderer.scene.add(this.markers.mesh);
    this.renderer.characterSources.push((add) => {
      sim.characters.poses(add, sim.player.x, sim.player.z, 140, sim.time);
      for (const a of sim.missions.actors()) add({ x: a.x, y: 0.15, z: a.z, heading: a.heading, stride: sim.time * 2, speed: 0, anim: sim.missions.dialogue ? 'talk' : 'stand', shirt: 0x6b2f2f, pants: 0x23262b, skin: 0xb98a66, scale: 1.02 });
    });

    this.menu = new Menu(this.ui, {
      newGame: () => void this.startGame(),
      continueGame: () => this.openLoad('main'),
      hasSave: () => this.saves.latest() !== null,
      resume: () => this.resume(),
      quitToMenu: () => this.toMenu(),
      settings: this.settings,
      applySettings: () => this.applySettings(),
      pauseItems: [
        { label: 'Map', hint: 'M', run: () => this.openPanel(mapPanel(sim, () => this.menu.pause())) },
        { label: 'Cass Navarro', hint: 'Money, inventory, standing, people', run: () => this.openPanel(characterPanel(sim, () => this.menu.pause(), (t) => this.hud.toast(t))) },
        { label: 'Load Game', run: () => this.openLoad('pause') },
        { label: 'Abandon Mission', hint: 'Give up the current job', run: () => { sim.missions.abandon(); this.resume(); } },
      ],
    });
    this.menu.footer = () => `Endings found: ${this.endingsFound().length} of ${REGISTRY.endings.length}`;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.overlay.toggle(); }
      if (e.code === 'Escape' && this.inGame && !this.endingShown) (this.menu.open ? this.resume() : this.pause());
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.inGame && !this.menu.open && !this.manual && !this.panelOpen) this.pause();
    });

    this.api = installDebugApi(this);
    installConsole(this, this.api.commands);
    installSelfTest(this, this.api.commands);
    this.hud.setVisible(false);
    this.toMenu();
    await sim.streaming.loadAround(MENU_FOCUS, 2, 15000);
    boot.remove();
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (params.has('autostart')) await this.startGame();
  }

  // ── settings, saves ─────────────────────────────────────────────────────

  applySettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    if (this.sim) this.sim.camera.sensitivity = 0.0026 * this.settings.sensitivity;
    if (this.sim) this.sim.camera.invertY = this.settings.invertY;
    this.audio.volume = this.settings.volume;
  }

  saveGame(slot: SlotId): boolean {
    const ok = this.saves.write(slot, captureState(this.sim), saveMeta(this.sim));
    if (ok) this.sim.bus.emit('save.written', { slot });
    if (slot !== 'auto') this.hud.toast(ok ? 'Game saved.' : 'Could not save.', ok ? 'good' : 'bad');
    return ok;
  }

  async loadGame(slot: SlotId): Promise<string> {
    const r = this.saves.load(slot);
    if (!r.ok) { this.hud.toast(`Cannot load: ${r.reason}.`, 'bad'); return r.reason; }
    await this.menu.fadeThrough(async () => {
      this.menu.close();
      this.sim.camera.cinematic = null;
      await applyState(this.sim, r.data);
      this.enterPlay();
    });
    if (r.recovered) this.hud.toast('The save was damaged; the previous copy was loaded instead.', 'bad');
    return r.recovered ? 'recovered' : 'ok';
  }

  private openLoad(back: 'main' | 'pause'): void {
    const closeTo = () => (back === 'main' ? this.menu.main() : this.menu.pause());
    this.menu.custom(savePanel(this.saves.list(), 'load', (slot) => void this.loadGame(slot), closeTo));
  }

  endingsFound(): string[] {
    try { return JSON.parse(localStorage.getItem(ENDINGS_KEY) ?? '[]'); } catch { return []; }
  }

  // ── flow ────────────────────────────────────────────────────────────────

  toMenu(): void {
    this.inGame = false;
    this.endingShown = null;
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
      this.enterPlay();
    });
    if (!this.manual) this.hud.toast('Find the gold marker to begin. F enters vehicles, E interacts, M opens the map.');
  }

  enterPlay(): void {
    this.sim.camera.cinematic = null;
    this.menu.close();
    this.panelOpen = false;
    this.endingShown = null;
    this.inGame = true;
    this.sim.paused = false;
    this.hud.setVisible(true);
    this.acc = 0;
    this.autosave = 0;
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
    this.panelOpen = false;
    this.sim.paused = false;
    if (this.input instanceof BrowserInput) this.input.enabled = true;
  }

  /** A modal panel over the paused game. */
  openPanel(panel: HTMLElement): void {
    this.panelOpen = true;
    this.sim.paused = true;
    if (this.input instanceof BrowserInput) { this.input.enabled = false; this.input.releasePointer(); }
    this.menu.custom(panel);
  }

  // ── per-frame ───────────────────────────────────────────────────────────

  private frame(t: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.overlay.frame(dt);
    const sim = this.sim;
    if (!this.inGame) {
      this.menuT += dt;
      const a = this.menuT * 0.02;
      sim.camera.cinematic = { x: 3330 + Math.sin(a) * 120, y: 46 + Math.sin(a * 1.7) * 6, z: 2560 + Math.cos(a) * 90, tx: 2500, ty: 70, tz: 1720, fov: 52 };
      sim.camera.update(dt, sim.lastInput, sim.player, null);
      sim.streaming.update(dt, MENU_FOCUS);
      sim.env.update(dt * 6);
    } else {
      if (!this.manual && !sim.paused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= SIM_DT && n < 5) { sim.step(); this.acc -= SIM_DT; n++; }
        if (n === 5) this.acc = 0;
        this.autosave += dt;
        if (this.autosave > 180 && sim.wanted.level === 0 && !sim.missions.active && !sim.playerVehicle?.inWater) { this.autosave = 0; this.saveGame('auto'); }
      }
      if (this.endingShown) this.endingCamera(dt);
      sim.streamTick(dt);
      this.handleKeys();
      this.updateStory();
      this.updateHud();
      this.audio.update(sim, dt);
    }
    this.pressed.clear();
    this.renderer.playerLook.shirt = sim.economy.outfit.shirt;
    this.renderer.playerLook.pants = sim.economy.outfit.pants;
    this.markers.update(sim, dt);
    this.markers.mesh.visible = this.inGame && !this.endingShown;
    this.overlay.update(sim, dt);
    this.renderer.render(sim, dt);
  }

  /** What pressing E would do here, most specific first. */
  private interaction(): { key: string; text: string; run: () => void } | null {
    const sim = this.sim, p = sim.player;
    if (sim.playerVehicle && Math.abs(sim.playerVehicle.speed) > 3) return null;
    const x = sim.playerVehicle ? sim.playerVehicle.x : p.x, z = sim.playerVehicle ? sim.playerVehicle.z : p.z;
    const offer = sim.missions.nearestOffer(x, z, 7);
    if (offer) return { key: 'E', text: `${offer.story ? 'Story' : 'Job'}: ${offer.title}`, run: () => { sim.missions.start(offer.id); } };
    if (sim.missions.step()?.type === 'talk') return null;
    const who = sim.characters.nearby(x, z, 3.5)[0];
    if (who && !sim.playerVehicle) {
      return { key: 'E', text: `Talk to ${who.def.name}`, run: () => { const g = sim.characters.greet(who.def.id); if (g) this.hud.toast(`${g.name} (${g.activity}): ${g.line}`); } };
    }
    let best = null, bd = 4.5;
    for (const poi of allPois()) { const d = Math.hypot(poi.x - x, poi.z - z); if (d < bd) { bd = d; best = poi; } }
    if (best) { const poi = best; return { key: 'E', text: poi.name, run: () => this.openPanel(poiPanel(sim, poi, () => this.resume())) }; }
    return null;
  }

  private handleKeys(): void {
    const sim = this.sim;
    if (sim.paused || this.endingShown) return;
    const k = this.pressed;
    if (k.has('KeyM')) this.openPanel(mapPanel(sim, () => this.resume()));
    else if (k.has('Tab')) this.openPanel(characterPanel(sim, () => this.resume(), (t) => this.hud.toast(t)));
    if (k.has('Digit1')) this.hud.toast(useItem(sim, 'repairKit') || 'No repair kit, or nothing to repair.');
    if (k.has('Digit2')) this.hud.toast(useItem(sim, 'fuelCan') || 'No fuel can, or the tank is full.');
    if (k.has('Digit3')) this.hud.toast(useItem(sim, 'burnerPhone') || 'No burner phone, or nobody is searching for you.');
    const i = this.interaction();
    // Mission givers are started by the simulation's own interact handling; everything else here.
    if (k.has('KeyE') && i && !sim.missions.nearestOffer(sim.player.x, sim.player.z, 7)) i.run();
    this.hud.extras.prompt = this.vehiclePrompt() ?? (i ? { key: i.key, text: i.text } : null);
  }

  private vehiclePrompt(): { key: string; text: string } | null {
    const s = this.sim;
    if (s.playerVehicle) return null;
    const v = s.vehicles.nearest(s.player.x, s.player.z, 3.0);
    if (v && !v.destroyed) return { key: 'F', text: `${v.owner === 'player' ? 'Enter' : 'Take'} the ${v.profile.name}` };
    const c = s.traffic.cars.find((t) => t.speed < 4 && Math.hypot(t.x - s.player.x, t.z - s.player.z) < 3.4);
    return c ? { key: 'F', text: `Take the ${c.profile.name} from its driver` } : null;
  }

  private updateStory(): void {
    const sim = this.sim, m = sim.missions;
    if (this.manual) return; // the self-test takes decisions through the API
    if (m.endingReached && !this.endingShown) { this.playEnding(m.endingReached); return; }
    if (m.pendingDecision && !this.panelOpen && !sim.paused && !m.endingReached) {
      const node = m.pendingDecision;
      this.openPanel(decisionPanel(sim, node, (id) => { m.decide(id); this.resume(); this.saveGame('auto'); }));
    }
  }

  private updateHud(): void {
    const sim = this.sim, m = sim.missions;
    const x = this.hud.extras;
    x.cash = sim.economy.cash;
    x.wanted = sim.wanted.level;
    x.objective = m.objective();
    const d = m.dialogue;
    this.dialogue.classList.toggle('hidden', !d);
    if (d) this.dialogue.innerHTML = `<b style="color:var(--accent)">${d.speaker}</b>&nbsp; ${d.text}`;
    this.hud.wantedSearching = sim.wanted.state === 'search';
    this.hud.update(sim);
    if (this.renderer.frames % 6 === 0) drawMap(this.minimap, sim, { cx: sim.player.x, cz: sim.player.z, scale: 0.26, pois: true, labels: false });
  }

  // ── endings ─────────────────────────────────────────────────────────────

  playEnding(e: EndingDef): void {
    this.endingShown = e;
    this.endingT = 0;
    const found = new Set(this.endingsFound());
    found.add(e.id);
    localStorage.setItem(ENDINGS_KEY, JSON.stringify([...found]));
    const sim = this.sim;
    sim.leaveVehicle();
    const a = anchorFor(e.cinematic.district, 'ending:' + e.id);
    sim.env.hour = e.cinematic.timeOfDay % 24;
    sim.env.setWeather(e.cinematic.weather as Weather, true);
    void sim.teleport(a.x + 8, a.z + 8, 0);
    this.hud.setVisible(false);
    if (this.input instanceof BrowserInput) { this.input.enabled = false; this.input.releasePointer(); }
    this.panelOpen = true;
    this.menu.raw(endingScreen(e, found.size, () => this.toMenu()));
  }

  /** Each ending is staged with its own camera move at its own place, hour and weather. */
  private endingCamera(dt: number): void {
    const e = this.endingShown!;
    this.endingT += dt;
    const t = this.endingT;
    const a = anchorFor(e.cinematic.district, 'ending:' + e.id);
    const cx = a.x + 8, cz = a.z + 8;
    let c = { x: cx, y: 30, z: cz + 60, tx: cx, ty: 8, tz: cz, fov: 50 };
    switch (e.cinematic.camera) {
      case 'orbit': c = { x: cx + Math.sin(t * 0.08) * 70, y: 26, z: cz + Math.cos(t * 0.08) * 70, tx: cx, ty: 6, tz: cz, fov: 48 }; break;
      case 'crane': c = { x: cx + 26, y: 3 + Math.min(110, t * 3.2), z: cz + 30, tx: cx, ty: 2 + Math.min(60, t * 1.4), tz: cz, fov: 55 }; break;
      case 'dolly': c = { x: cx + 5, y: 2.4, z: cz + 70 - Math.min(64, t * 2.2), tx: cx, ty: 2.2, tz: cz - 30, fov: 42 }; break;
      case 'static': c = { x: cx + 18, y: 9, z: cz + 22, tx: cx, ty: 3, tz: cz, fov: 38 }; break;
      case 'chase': c = { x: cx + Math.sin(t * 0.35) * 22, y: 3.2, z: cz + Math.cos(t * 0.35) * 22, tx: cx, ty: 1.6, tz: cz, fov: 62 }; break;
      case 'flyover': c = { x: cx - 320 + t * 9, y: 190, z: cz + 140, tx: cx - 200 + t * 9, ty: 0, tz: cz, fov: 46 }; break;
    }
    this.sim.camera.cinematic = c;
    this.sim.camera.update(dt, this.sim.lastInput, this.sim.player, null);
    this.sim.env.update(dt);
  }
}

const app = new GameApp();
app.boot().catch((e) => {
  console.error(e);
  document.getElementById('ui')!.append(el('div.boot', el('b', 'UNDERTOW'), 'FAILED TO START — ' + String(e?.message ?? e)));
});
