import { STREAMING } from '../core/config';
import type { EventBus } from '../core/EventBus';
import { CELL, cellKey } from '../world/CityPlan';
import type { CellData } from './CellData';

/**
 * World streaming. Keeps the right cells resident at the right level of detail around a moving
 * focus, loading ahead of travel, instantiating under a frame budget and unloading behind.
 *
 * The manager owns policy and bookkeeping only. Generation is delegated to a CellExecutor
 * (Web Workers in the browser, inline in Node), scene objects to a ViewFactory and collision to
 * a ColliderSink, so the same code runs in the game and in the unit tests.
 */

export type Residency = 'unloaded' | 'queued' | 'generating' | 'ready' | 'instantiating' | 'active' | 'unloading';

export const LOD_NONE = 4;

export interface StreamFocus {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Camera facing on the ground plane (unit vector). */
  camX: number;
  camZ: number;
}

export interface CellExecutor {
  /** Free generation slots right now. */
  available(): number;
  request(cx: number, cz: number, lod: number, done: (data: CellData) => void): void;
  beginFrame?(): void;
  dispose?(): void;
}

export interface StreamView {
  /** One unit of instantiation work; true when complete. */
  buildStep(): boolean;
  setFade(f: number): void;
  attach(): void;
  dispose(): void;
  drawCalls: number;
  triangles: number;
}

export interface ViewFactory {
  create(data: CellData): StreamView;
}

export interface ColliderSink {
  addStaticBoxes(data: Float32Array): number[];
  removeColliders(handles: number[]): void;
}

export interface StreamingOptions {
  /** Radii in cells for LOD 0, 1, 2, 3. */
  lodRadius: [number, number, number, number];
  executor: CellExecutor;
  views?: ViewFactory;
  colliders?: ColliderSink;
  bus?: EventBus;
  seedImportance?: (cx: number, cz: number) => number;
  /** Called when a cell's full-detail gameplay data becomes available or goes away. */
  onDetail?: (data: CellData, present: boolean) => void;
}

export class CellRecord {
  /** LOD currently shown (LOD_NONE when nothing is). */
  lod = LOD_NONE;
  targetLod = LOD_NONE;
  /** A generation request is with the executor. */
  inFlight = false;
  priority = 0;
  distance = Infinity;
  view: StreamView | null = null;
  /** Generated data waiting to be instantiated, and the view being built from it. */
  pendingData: CellData | null = null;
  pendingView: StreamView | null = null;
  data: CellData | null = null;
  colliders: number[] | null = null;
  requestedAt = 0;
  touched = 0;
  fade = 0;
  readonly key: string;
  constructor(readonly cx: number, readonly cz: number) {
    this.key = cellKey(cx, cz);
  }
}

interface Fading { view: StreamView; fade: number }

export interface StreamingStats {
  currentCell: string;
  resident: number;
  byState: Record<Residency, number>;
  /** Active cells per LOD 0..3. */
  byLod: [number, number, number, number];
  queueLength: number;
  generating: number;
  cacheBytes: number;
  cacheEntries: number;
  residentBytes: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  lastLatencyMs: number;
  avgGenerationMs: number;
  frameWorkMs: number;
  maxFrameWorkMs: number;
  loadsCompleted: number;
  unloadsCompleted: number;
  cacheHits: number;
  drawCalls: number;
  triangles: number;
  staticColliders: number;
  lookahead: number;
}

const now = (): number => performance.now();

export class StreamingManager {
  readonly cells = new Map<string, CellRecord>();
  private cache = new Map<string, CellData>();
  private cacheBytes = 0;
  private ready: CellRecord[] = [];
  private fading: Fading[] = [];
  private disposeQueue: StreamView[] = [];
  private frame = 0;
  private generating = 0;
  private latencies: number[] = [];
  private genTimes: number[] = [];
  private stat = { loads: 0, unloads: 0, hits: 0, maxLatency: 0, lastLatency: 0, frameWork: 0, maxFrameWork: 0, lookahead: 0, queue: 0 };
  private focusCell = '';
  lodRadius: [number, number, number, number];
  frameBudgetMs = STREAMING.frameBudgetMs;
  cacheBudget = STREAMING.cacheBudgetBytes;

  constructor(private o: StreamingOptions) {
    this.lodRadius = [...o.lodRadius];
  }

  /** LOD a cell should have at an effective distance, with hysteresis against its current LOD. */
  private lodFor(dist: number, current: number): number {
    const r = this.lodRadius;
    for (let lod = 0; lod < 4; lod++) {
      const limit = r[lod] * CELL * (current <= lod ? STREAMING.lodHysteresis : 1);
      if (dist <= limit) return lod;
    }
    return dist <= r[3] * CELL * STREAMING.unloadMargin && current < LOD_NONE ? 3 : LOD_NONE;
  }

  /**
   * Distance used for LOD selection: the nearest of the focus, the predicted position and the
   * path between them, so cells ahead of a fast vehicle are promoted before it arrives.
   */
  static effectiveDistance(cxm: number, czm: number, f: StreamFocus, lookahead: number): number {
    const speed = Math.hypot(f.vx, f.vz);
    const dNow = Math.hypot(cxm - f.x, czm - f.z);
    if (speed < 0.5 || lookahead <= 0) return dNow;
    const ux = f.vx / speed, uz = f.vz / speed;
    const t = Math.max(0, Math.min(lookahead, (cxm - f.x) * ux + (czm - f.z) * uz));
    return Math.min(dNow, Math.hypot(cxm - (f.x + ux * t), czm - (f.z + uz * t)));
  }

  /** Streaming priority: higher loads first. See docs/GAME_ARCHITECTURE.md §4.4. */
  static priority(cxm: number, czm: number, f: StreamFocus, lookahead: number, targetLod: number, importance: number): number {
    const dx = cxm - f.x, dz = czm - f.z;
    const d = Math.hypot(dx, dz) || 1;
    const speed = Math.hypot(f.vx, f.vz);
    const dEff = StreamingManager.effectiveDistance(cxm, czm, f, lookahead);
    const facing = Math.max(0, (dx * f.camX + dz * f.camZ) / d);
    const moving = speed > 0.5 ? Math.max(0, (dx * f.vx + dz * f.vz) / (d * speed)) : 0;
    const eta = d / Math.max(speed, 4);
    const speedFactor = Math.min(1, speed / 25);
    return 10 / (1 + dEff / CELL) + 1.5 * facing + 3 * moving * speedFactor + 4 / (1 + eta) + 2 * importance + 0.75 * (4 - targetLod);
  }

  private record(cx: number, cz: number): CellRecord {
    const k = cellKey(cx, cz);
    let r = this.cells.get(k);
    if (!r) this.cells.set(k, (r = new CellRecord(cx, cz)));
    return r;
  }

  /**
   * Advance streaming. `dt` is real seconds (for fades). Returns after spending at most
   * `budgetMs` of main-thread time on instantiation and disposal.
   */
  update(dt: number, f: StreamFocus, budgetMs = this.frameBudgetMs): void {
    const t0 = now();
    this.frame++;
    this.o.executor.beginFrame?.();
    const speed = Math.hypot(f.vx, f.vz);
    const lookahead = Math.min(STREAMING.maxLookahead, speed * STREAMING.lookaheadSeconds);
    this.stat.lookahead = lookahead;
    const fcx = Math.floor(f.x / CELL), fcz = Math.floor(f.z / CELL);
    this.focusCell = cellKey(fcx, fcz);

    // 1. Decide the target LOD of every cell in range of the focus or its predicted path.
    const reach = this.lodRadius[3] * CELL * STREAMING.unloadMargin + lookahead;
    const rc = Math.ceil(reach / CELL);
    for (let cz = fcz - rc; cz <= fcz + rc; cz++) {
      for (let cx = fcx - rc; cx <= fcx + rc; cx++) {
        const cxm = (cx + 0.5) * CELL, czm = (cz + 0.5) * CELL;
        const dEff = StreamingManager.effectiveDistance(cxm, czm, f, lookahead);
        const existing = this.cells.get(cellKey(cx, cz));
        const target = this.lodFor(dEff, existing ? Math.min(existing.lod, existing.targetLod) : LOD_NONE);
        if (target === LOD_NONE && !existing) continue;
        const r = existing ?? this.record(cx, cz);
        r.targetLod = target;
        r.distance = dEff;
        r.touched = this.frame;
        if (target !== LOD_NONE) {
          r.priority = StreamingManager.priority(cxm, czm, f, lookahead, target, this.o.seedImportance?.(cx, cz) ?? 0);
        }
      }
    }
    // Anything that fell out of range entirely goes away.
    for (const r of this.cells.values()) if (r.touched !== this.frame) r.targetLod = LOD_NONE;

    // 2. Queue work for cells whose resident LOD is not the one wanted, best first.
    const wants: CellRecord[] = [];
    for (const r of this.cells.values()) {
      if (r.targetLod === LOD_NONE) continue;
      if (r.inFlight) continue; // let the worker finish; its result is cached either way
      if (r.pendingData) {
        if (r.pendingData.lod === r.targetLod) continue;
        this.dropPending(r); // prepared for a LOD that is no longer wanted
      }
      if (r.lod === r.targetLod) continue;
      if (!r.requestedAt) r.requestedAt = now();
      wants.push(r);
    }
    wants.sort((a, b) => b.priority - a.priority);
    this.stat.queue = wants.length;
    for (const r of wants) {
      const ck = r.key + ':' + r.targetLod;
      const cached = this.cache.get(ck);
      if (cached) {
        this.cache.delete(ck); this.cache.set(ck, cached); // refresh LRU position
        this.stat.hits++;
        this.toReady(r, cached);
        continue;
      }
      if (this.o.executor.available() <= 0) continue;
      r.inFlight = true;
      this.generating++;
      const lod = r.targetLod;
      this.o.executor.request(r.cx, r.cz, lod, (data) => this.onGenerated(r, lod, data));
    }

    // 3. Instantiate prepared cells within the frame budget, best first.
    this.ready.sort((a, b) => b.priority - a.priority);
    while (this.ready.length && now() - t0 < budgetMs) {
      const r = this.ready[0];
      const data = r.pendingData!;
      if (r.targetLod !== data.lod) { this.dropPending(r); continue; } // the player turned away
      if (this.o.views) {
        if (!r.pendingView) r.pendingView = this.o.views.create(data);
        if (!r.pendingView.buildStep()) continue;
      }
      this.ready.shift();
      this.activate(r, data);
    }

    // 4. Unload cells that are out of range.
    for (const r of this.cells.values()) {
      if (r.targetLod !== LOD_NONE) continue;
      if (r.pendingData) this.dropPending(r);
      this.unload(r);
    }

    // 5. Cross-fades and deferred disposal.
    const step = dt / STREAMING.fadeSeconds;
    for (const r of this.cells.values()) {
      if (r.view && r.fade < 1) { r.fade = Math.min(1, r.fade + step); r.view.setFade(r.fade); }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const fd = this.fading[i];
      fd.fade -= step;
      if (fd.fade <= 0) { this.disposeQueue.push(fd.view); this.fading.splice(i, 1); }
      else fd.view.setFade(fd.fade);
    }
    while (this.disposeQueue.length && (now() - t0 < budgetMs || this.disposeQueue.length > 64)) this.disposeQueue.pop()!.dispose();

    this.stat.frameWork = now() - t0;
    this.stat.maxFrameWork = Math.max(this.stat.maxFrameWork * 0.995, this.stat.frameWork);
  }

  private dropPending(r: CellRecord): void {
    const i = this.ready.indexOf(r);
    if (i >= 0) this.ready.splice(i, 1);
    r.pendingView?.dispose();
    r.pendingView = null;
    r.pendingData = null;
  }

  private onGenerated(r: CellRecord, lod: number, data: CellData): void {
    this.generating--;
    r.inFlight = false;
    this.genTimes.push(data.generationMs);
    if (this.genTimes.length > 120) this.genTimes.shift();
    this.cachePut(r.key + ':' + lod, data);
    // Unloaded or retargeted while the worker ran: the data stays cached for a return visit.
    if (this.cells.get(r.key) !== r || r.targetLod !== lod) return;
    this.toReady(r, data);
  }

  private toReady(r: CellRecord, data: CellData): void {
    r.pendingData = data;
    if (!this.ready.includes(r)) this.ready.push(r);
  }

  private activate(r: CellRecord, data: CellData): void {
    if (r.lod === 0 && data.lod !== 0) this.dropDetail(r);
    if (r.view) this.fading.push({ view: r.view, fade: Math.max(0.05, r.fade) });
    r.view = r.pendingView;
    r.pendingView = null;
    r.pendingData = null;
    r.data = data;
    r.lod = data.lod;
    r.fade = r.view ? 0 : 1;
    if (r.view) { r.view.setFade(0); r.view.attach(); }
    if (data.lod === 0) {
      if (this.o.colliders && data.colliders.length) r.colliders = this.o.colliders.addStaticBoxes(data.colliders);
      this.o.onDetail?.(data, true);
    }
    const latency = now() - r.requestedAt;
    r.requestedAt = 0;
    this.latencies.push(latency);
    if (this.latencies.length > 200) this.latencies.shift();
    this.stat.lastLatency = latency;
    this.stat.maxLatency = Math.max(this.stat.maxLatency, latency);
    this.stat.loads++;
    this.o.bus?.emit('cell.activated', { key: r.key, lod: r.lod, latencyMs: latency });
  }

  private dropDetail(r: CellRecord): void {
    if (r.colliders) { this.o.colliders?.removeColliders(r.colliders); r.colliders = null; }
    if (r.data && r.data.lod === 0) this.o.onDetail?.(r.data, false);
  }

  private unload(r: CellRecord): void {
    if (r.lod === 0) this.dropDetail(r);
    if (r.view) { this.fading.push({ view: r.view, fade: Math.max(0.05, r.fade) }); r.view = null; }
    const wasResident = r.lod !== LOD_NONE;
    r.lod = LOD_NONE;
    r.data = null;
    this.cells.delete(r.key);
    if (wasResident) { this.stat.unloads++; this.o.bus?.emit('cell.unloaded', { key: r.key }); }
  }

  /** Where a record is in the residency state machine. */
  static stateOf(r: CellRecord): Residency {
    if (r.lod !== LOD_NONE) return 'active';
    if (r.inFlight) return 'generating';
    if (r.pendingView) return 'instantiating';
    if (r.pendingData) return 'ready';
    return r.targetLod === LOD_NONE ? 'unloaded' : 'queued';
  }

  private cachePut(key: string, data: CellData): void {
    const old = this.cache.get(key);
    if (old) { this.cacheBytes -= old.bytes; this.cache.delete(key); }
    this.cache.set(key, data);
    this.cacheBytes += data.bytes;
    // Evict least recently used entries beyond the budget.
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= this.cacheBudget) break;
      if (k === key) continue;
      this.cache.delete(k);
      this.cacheBytes -= v.bytes;
    }
  }

  /** True when the cell under (x, z) has its colliders, so physics can run there. */
  isSolidAt(x: number, z: number): boolean {
    const r = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!r && r.lod === 0;
  }

  /** Detail data of the resident LOD0 cells (parking, sidewalks, points of interest). */
  detailCells(): CellData[] {
    const out: CellData[] = [];
    for (const r of this.cells.values()) if (r.lod === 0 && r.data) out.push(r.data);
    return out;
  }

  /**
   * Blocking load around a point, for the spawn area and teleports only (behind a fade).
   * Pumps the normal pipeline with an unlimited budget until the near cells are resident.
   */
  async loadAround(f: StreamFocus, maxLod = 1, timeoutMs = 20000): Promise<void> {
    const t0 = now();
    for (;;) {
      this.update(1, f, 1e9);
      let pending = 0;
      for (const r of this.cells.values()) if (r.targetLod <= maxLod && r.lod !== r.targetLod) pending++;
      if (!pending || now() - t0 > timeoutMs) break;
      await new Promise((res) => setTimeout(res, 2));
    }
  }

  stats(): StreamingStats {
    const byState: Record<Residency, number> = { unloaded: 0, queued: 0, generating: 0, ready: 0, instantiating: 0, active: 0, unloading: this.fading.length };
    const byLod: [number, number, number, number] = [0, 0, 0, 0];
    let residentBytes = 0, drawCalls = 0, triangles = 0, colliders = 0;
    for (const r of this.cells.values()) {
      byState[StreamingManager.stateOf(r)]++;
      if (r.lod < LOD_NONE) byLod[r.lod]++;
      if (r.data) residentBytes += r.data.bytes;
      if (r.view) { drawCalls += r.view.drawCalls; triangles += r.view.triangles; }
      if (r.colliders) colliders += r.colliders.length;
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    return {
      currentCell: this.focusCell,
      resident: byLod[0] + byLod[1] + byLod[2] + byLod[3],
      byState, byLod,
      queueLength: this.stat.queue,
      generating: this.generating,
      cacheBytes: this.cacheBytes,
      cacheEntries: this.cache.size,
      residentBytes,
      avgLatencyMs: avg(this.latencies),
      maxLatencyMs: this.stat.maxLatency,
      lastLatencyMs: this.stat.lastLatency,
      avgGenerationMs: avg(this.genTimes),
      frameWorkMs: this.stat.frameWork,
      maxFrameWorkMs: this.stat.maxFrameWork,
      loadsCompleted: this.stat.loads,
      unloadsCompleted: this.stat.unloads,
      cacheHits: this.stat.hits,
      drawCalls, triangles,
      staticColliders: colliders,
      lookahead: this.stat.lookahead,
    };
  }

  dispose(): void {
    for (const r of [...this.cells.values()]) { r.targetLod = LOD_NONE; r.pendingView?.dispose(); this.unload(r); }
    for (const f of this.fading) f.view.dispose();
    for (const v of this.disposeQueue) v.dispose();
    this.fading = []; this.disposeQueue = []; this.ready = [];
    this.o.executor.dispose?.();
  }
}
