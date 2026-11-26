import type { GameSim } from '../core/GameSim';
import { LOD_NONE, StreamingManager } from '../streaming/StreamingManager';
import { el } from './dom';

export interface DebugCounts { npcFull: number; npcSimple: number; npcStat: number; trafficPhysical: number; trafficKinematic: number; trafficStat: number }

const LOD_COLOR = ['#7CFC9A', '#3fb0ff', '#b48cff', '#5a6472'];

/**
 * Developer streaming overlay (F3): the state of the world partition at a glance.
 * The grid shows every resident cell coloured by LOD; yellow is loading, red is the focus.
 */
export class DebugOverlay {
  readonly root = el('div.debug.hidden');
  private text = el('div');
  private canvas = el('canvas', { width: 164, height: 136 });
  private fps = 60;
  private worst = 0;
  private t = 0;
  counts: () => DebugCounts = () => ({ npcFull: 0, npcSimple: 0, npcStat: 0, trafficPhysical: 0, trafficKinematic: 0, trafficStat: 0 });
  renderInfo: () => { drawCalls: number; triangles: number } = () => ({ drawCalls: 0, triangles: 0 });

  constructor(parent: HTMLElement) {
    this.root.append(this.text, this.canvas);
    parent.append(this.root);
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  frame(dt: number): void {
    if (dt > 0) { this.fps += (1 / dt - this.fps) * 0.08; this.worst = Math.max(this.worst * 0.99, dt * 1000); }
  }

  update(sim: GameSim, dt: number): void {
    this.t += dt;
    if (!this.visible || this.t < 0.2) return;
    this.t = 0;
    const s = sim.streaming.stats();
    const c = this.counts();
    const r = this.renderInfo();
    const mb = (b: number) => (b / 1048576).toFixed(1);
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const f = sim.focus();
    this.text.textContent = [
      `FPS ${this.fps.toFixed(0).padStart(3)}   worst frame ${this.worst.toFixed(1)} ms   sim ${sim.stepMs.toFixed(2)} ms`,
      `cell ${s.currentCell.padEnd(7)} speed ${(Math.hypot(f.vx, f.vz) * 3.6).toFixed(0)} km/h  look-ahead ${s.lookahead.toFixed(0)} m`,
      `loaded ${s.resident}  loading ${s.byState.generating + s.byState.ready + s.byState.instantiating + s.byState.queued}  unloading ${s.byState.unloading}`,
      `queue ${s.queueLength}  workers busy ${s.generating}  ready ${s.byState.ready}`,
      `LOD0 ${s.byLod[0]}  LOD1 ${s.byLod[1]}  LOD2 ${s.byLod[2]}  LOD3 ${s.byLod[3]}`,
      `memory  cells ${mb(s.residentBytes)} MB  cache ${mb(s.cacheBytes)} MB (${s.cacheEntries})${heap ? `  heap ${mb(heap)} MB` : ''}`,
      `load time  avg ${s.avgLatencyMs.toFixed(0)} ms  last ${s.lastLatencyMs.toFixed(0)}  max ${s.maxLatencyMs.toFixed(0)}  gen ${s.avgGenerationMs.toFixed(1)}`,
      `stream work ${s.frameWorkMs.toFixed(2)} ms/frame (peak ${s.maxFrameWorkMs.toFixed(1)})  cache hits ${s.cacheHits}`,
      `NPC  full ${c.npcFull}  simple ${c.npcSimple}  statistical ${c.npcStat}`,
      `traffic  physical ${c.trafficPhysical}  kinematic ${c.trafficKinematic}  statistical ${c.trafficStat}`,
      `draw calls ${r.drawCalls}  tris ${(r.triangles / 1000).toFixed(0)}k  colliders ${sim.physics.staticColliderCount}  vehicles ${sim.vehicles.all.size}`,
    ].join('\n');
    this.drawGrid(sim);
  }

  private drawGrid(sim: GameSim): void {
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height, S = 4;
    g.fillStyle = '#0b0f13';
    g.fillRect(0, 0, W, H);
    const [fcx, fcz] = sim.streaming.stats().currentCell.split(',').map(Number);
    const ox = W / 2 - fcx * S, oz = H / 2 - fcz * S;
    for (const r of sim.streaming.cells.values()) {
      const st = StreamingManager.stateOf(r);
      g.fillStyle = r.lod < LOD_NONE ? LOD_COLOR[r.lod] : '#ffd54a';
      if (r.lod < LOD_NONE && (r.inFlight || r.pendingData)) g.fillStyle = '#ffe98a';
      if (st === 'unloaded') continue;
      g.fillRect(ox + r.cx * S, oz + r.cz * S, S - 1, S - 1);
    }
    g.fillStyle = '#ff4a4a';
    g.fillRect(ox + fcx * S, oz + fcz * S, S - 1, S - 1);
  }
}
