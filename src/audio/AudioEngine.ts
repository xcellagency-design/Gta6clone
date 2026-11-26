import type { GameSim } from '../core/GameSim';
import { districtAt, DISTRICTS } from '../world/CityPlan';

/**
 * Procedural audio: every sound is synthesised with Web Audio from the simulation's state.
 * There are no recorded samples. Starts on the first user gesture, as browsers require.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private road!: { filter: BiquadFilterNode; gain: GainNode };
  private rain!: { filter: BiquadFilterNode; gain: GainNode };
  private city!: { filter: BiquadFilterNode; gain: GainNode };
  private siren!: { osc: OscillatorNode; gain: GainNode };
  private lastGear = 1;
  private stepPhase = 0;
  volume = 0.7;
  /** Counters so tests can see that events produced sounds. */
  played = { shift: 0, impact: 0, step: 0, ui: 0, horn: 0 };

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Call from a click or key press. Safe to call repeatedly. */
  start(sim: GameSim): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = (freq: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type; filter.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return { filter, gain };
    };
    this.road = noise(500, 'lowpass');
    this.rain = noise(5200, 'highpass');
    this.city = noise(240, 'lowpass');

    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const sub = ctx.createOscillator(); sub.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); sub.connect(filter); filter.connect(gain).connect(this.master);
    osc.start(); sub.start();
    this.engine = { osc, sub, filter, gain };

    const so = ctx.createOscillator(); so.type = 'triangle';
    const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sg).connect(this.master); so.start();
    this.siren = { osc: so, gain: sg };

    sim.bus.on('vehicle.damaged', (e) => this.thump(Math.min(1, e.amount / 30)));
    sim.bus.on('mission.completed', () => this.chime([523, 659, 784]));
    sim.bus.on('mission.failed', () => this.chime([330, 247]));
    sim.bus.on('wanted.changed', (e) => { if (e.level > e.previous) this.chime([880, 880]); });
    sim.bus.on('economy.purchase', () => this.chime([988]));
  }

  private blip(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  chime(notes: number[]): void {
    this.played.ui++;
    notes.forEach((f, i) => this.blip(f, 0.22, 0.12, 'sine', i * 0.12));
  }

  thump(strength: number): void {
    this.played.impact++;
    this.blip(70, 0.25, 0.5 * strength + 0.1, 'triangle');
    this.blip(190, 0.08, 0.25 * strength, 'square');
  }

  update(sim: GameSim, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.06) => p.setTargetAtTime(v, t, tc);
    this.master.gain.value = sim.paused ? this.volume * 0.25 : this.volume;
    const v = sim.playerVehicle;
    if (v && !v.destroyed) {
      const base = v.isBike ? 85 : v.profile.class === 'truck' ? 42 : v.profile.class === 'sports' ? 70 : 55;
      const f = base * (0.8 + v.rpm * 2.6);
      set(this.engine.osc.frequency, f);
      set(this.engine.sub.frequency, f / 2);
      set(this.engine.filter.frequency, 300 + v.rpm * 2400 + Math.abs(v.throttle) * 900);
      set(this.engine.gain.gain, 0.05 + 0.07 * Math.abs(v.throttle) + 0.03 * v.rpm);
      if (v.gear !== this.lastGear) { this.lastGear = v.gear; this.played.shift++; this.blip(140, 0.06, 0.12, 'square'); }
      const sp = Math.abs(v.speed);
      set(this.road.gain.gain, Math.min(0.2, sp * 0.004) * (1 + sim.env.wetness));
      set(this.road.filter.frequency, 300 + sp * 45);
      if (sim.lastInput.horn) { this.played.horn++; this.blip(v.profile.class === 'truck' ? 220 : 410, 0.2, 0.2, 'square'); }
    } else {
      set(this.engine.gain.gain, 0);
      set(this.road.gain.gain, 0);
      // Footsteps: one tick per stride.
      const p = sim.player;
      if (p.mode === 'foot' && p.grounded && p.speed > 0.6) {
        const phase = Math.floor(p.stride / Math.PI);
        if (phase !== this.stepPhase) { this.stepPhase = phase; this.played.step++; this.blip(90 + Math.random() * 40, 0.05, 0.06 + p.speed * 0.008, 'triangle'); }
      }
    }
    set(this.rain.gain.gain, sim.env.rain * 0.16, 0.5);
    const d = DISTRICTS[districtAt(sim.player.x, sim.player.z)];
    set(this.city.gain.gain, (0.01 + 0.035 * Math.min(1, d.trafficDensity)) * (0.5 + 0.5 * sim.env.streetLife()), 1);
    // Sirens when units are close.
    const w = sim.wanted;
    const near = w.level > 0 && w.units.some((u) => { const x = u.car?.x ?? u.vehicle?.x ?? 1e9, z = u.car?.z ?? u.vehicle?.z ?? 1e9; return Math.hypot(x - sim.player.x, z - sim.player.z) < 220; });
    set(this.siren.gain.gain, near ? 0.05 : 0, 0.2);
    this.siren.osc.frequency.value = 660 + 240 * Math.sign(Math.sin(t * 5));
    void dt;
  }
}
