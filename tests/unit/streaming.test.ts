import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { CellData } from '../../src/streaming/CellData';
import { DeferredExecutor, InlineExecutor } from '../../src/streaming/executors';
import { LOD_NONE, StreamingManager, type StreamFocus, type StreamView } from '../../src/streaming/StreamingManager';
import { CELL } from '../../src/world/CityPlan';

const SEED = 99;
const RADII: [number, number, number, number] = [1.6, 3, 6.5, 12];
const still = (x: number, z: number): StreamFocus => ({ x, z, vx: 0, vz: 0, camX: 0, camZ: 1 });

class FakeColliders {
  live = new Set<number>();
  next = 1;
  addStaticBoxes(data: Float32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < data.length / 7; i++) { this.live.add(this.next); out.push(this.next++); }
    return out;
  }
  removeColliders(h: number[]): void {
    for (const x of h) this.live.delete(x);
  }
}

class FakeView implements StreamView {
  static live = 0;
  static disposed = 0;
  static builtSteps = 0;
  drawCalls = 2;
  triangles = 100;
  steps = 0;
  fade = -1;
  attached = false;
  constructor(readonly data: CellData, private cost = 0) { FakeView.live++; }
  buildStep(): boolean {
    FakeView.builtSteps++;
    if (this.cost) { const t = performance.now(); while (performance.now() - t < this.cost) { /* burn */ } }
    return ++this.steps >= 3;
  }
  setFade(f: number): void { this.fade = f; }
  attach(): void { this.attached = true; }
  dispose(): void { FakeView.live--; FakeView.disposed++; }
}

describe('streaming manager', () => {
  it('loads finer detail nearer the focus and nothing beyond the last radius', () => {
    const sm = new StreamingManager({ lodRadius: RADII, executor: new InlineExecutor(SEED) });
    const f = still(2500, 1700);
    sm.update(1, f, 1e9);
    const lodAt = (dx: number, dz: number) => sm.cells.get(`${12 + dx},${8 + dz}`)?.lod ?? LOD_NONE;
    expect(lodAt(0, 0)).toBe(0);
    expect(lodAt(1, 0)).toBe(0);
    expect(lodAt(3, 0)).toBe(1);
    expect(lodAt(5, 0)).toBe(2);
    expect(lodAt(10, 0)).toBe(3);
    expect(lodAt(16, 0)).toBe(LOD_NONE);
    const s = sm.stats();
    expect(s.byLod[0]).toBeGreaterThan(4);
    expect(s.byLod[3]).toBeGreaterThan(s.byLod[2]);
    expect(sm.isSolidAt(f.x, f.z)).toBe(true);
  });

  it('prioritises cells ahead of a moving vehicle over cells behind it', () => {
    const f: StreamFocus = { x: 2000, z: 2000, vx: 40, vz: 0, camX: 1, camZ: 0 };
    const ahead = StreamingManager.priority(2000 + 3 * CELL, 2000, f, 140, 0, 0);
    const behind = StreamingManager.priority(2000 - 3 * CELL, 2000, f, 140, 0, 0);
    const side = StreamingManager.priority(2000, 2000 + 3 * CELL, f, 140, 0, 0);
    expect(ahead).toBeGreaterThan(side);
    expect(side).toBeGreaterThanOrEqual(behind);
    // Look-ahead shrinks the effective distance of what lies on the path.
    expect(StreamingManager.effectiveDistance(2600, 2000, f, 140)).toBeLessThan(StreamingManager.effectiveDistance(1400, 2000, f, 140));
    // Mission-critical cells jump the queue.
    expect(StreamingManager.priority(2600, 2000, f, 140, 1, 1)).toBeGreaterThan(StreamingManager.priority(2600, 2000, f, 140, 1, 0));
  });

  it('keeps full-detail ground under a vehicle crossing the city at speed', () => {
    const exec = new DeferredExecutor(SEED, 3, 2);
    const colliders = new FakeColliders();
    const bus = new EventBus();
    FakeView.live = 0;
    const sm = new StreamingManager({ lodRadius: RADII, executor: exec, colliders, bus, views: { create: (d) => new FakeView(d) } });
    const speed = 45; // 162 km/h
    let x = 300;
    const z = 1650;
    // Initial load at rest.
    for (let i = 0; i < 400; i++) { exec.pump(); sm.update(1 / 60, still(x, z), 1e9); }
    expect(sm.isSolidAt(x, z)).toBe(true);
    const before = sm.stats();
    let missing = 0, maxResident = 0, frames = 0, maxBytes = 0;
    while (x < 4400) {
      x += speed / 60;
      exec.pump();
      sm.update(1 / 60, { x, z, vx: speed, vz: 0, camX: 1, camZ: 0 }, 4);
      if (!sm.isSolidAt(x, z)) missing++;
      const s = sm.stats();
      maxResident = Math.max(maxResident, s.resident);
      maxBytes = Math.max(maxBytes, s.residentBytes);
      frames++;
    }
    const after = sm.stats();
    expect(missing).toBe(0);
    expect(after.loadsCompleted - before.loadsCompleted).toBeGreaterThan(200);
    expect(after.unloadsCompleted).toBeGreaterThan(100);
    expect(bus.count('cell.unloaded')).toBeGreaterThan(0);
    // Residency stays bounded: nothing accumulates along the route.
    expect(maxResident).toBeLessThan(before.resident * 1.6 + 60);
    expect(maxBytes).toBeLessThan(96 * 1024 * 1024);
    // Colliders exist only for the cells near the vehicle.
    expect(colliders.live.size).toBeLessThan(6000);
    expect(colliders.live.size).toBe(after.staticColliders);
    // Views are disposed as cells unload.
    for (let i = 0; i < 120; i++) sm.update(1 / 60, { x, z, vx: 0, vz: 0, camX: 1, camZ: 0 }, 4);
    expect(FakeView.live).toBeLessThan(sm.stats().resident + 8);
    expect(frames).toBeGreaterThan(1000);
  });

  it('does not thrash when the focus hovers on a LOD boundary', () => {
    const exec = new InlineExecutor(SEED);
    const sm = new StreamingManager({ lodRadius: RADII, executor: exec });
    const wobble = (n: number) => { for (let i = 0; i < n; i++) sm.update(1 / 60, still(2000 + (i % 2 ? 6 : -6), 2000), 1e9); };
    sm.update(1, still(2000, 2000), 1e9);
    wobble(10);
    const loads = sm.stats().loadsCompleted, unloads = sm.stats().unloadsCompleted;
    wobble(300);
    expect(sm.stats().loadsCompleted).toBe(loads);
    expect(sm.stats().unloadsCompleted).toBe(unloads);
  });

  it('serves a return visit from the cache and evicts beyond the budget', () => {
    const exec = new InlineExecutor(SEED);
    const sm = new StreamingManager({ lodRadius: [1.2, 2, 3, 4], executor: exec });
    sm.update(1, still(1000, 1000), 1e9);
    sm.update(1, still(3800, 1000), 1e9);
    const generated = exec.generated;
    sm.update(1, still(1000, 1000), 1e9);
    expect(sm.stats().cacheHits).toBeGreaterThan(20);
    expect(exec.generated).toBe(generated);
    sm.cacheBudget = 200_000;
    sm.update(1, still(2400, 2600), 1e9);
    expect(sm.stats().cacheBytes).toBeLessThan(200_000 + 400_000);
  });

  it('respects the per-frame instantiation budget', () => {
    const sm = new StreamingManager({ lodRadius: [1.2, 2, 3, 4], executor: new InlineExecutor(SEED), views: { create: (d) => new FakeView(d, 0.6) } });
    const t0 = performance.now();
    sm.update(1 / 60, still(2500, 1700), 3);
    const spent = performance.now() - t0;
    const pending = [...sm.cells.values()].filter((r) => r.lod !== r.targetLod).length;
    expect(pending).toBeGreaterThan(5); // work was deferred to later frames…
    expect(sm.stats().frameWorkMs).toBeLessThan(40); // …instead of stalling this one (generation is inline in this test)
    expect(spent).toBeLessThan(400);
    for (let i = 0; i < 2000 && [...sm.cells.values()].some((r) => r.lod !== r.targetLod); i++) sm.update(1 / 60, still(2500, 1700), 3);
    expect([...sm.cells.values()].every((r) => r.lod === r.targetLod)).toBe(true);
  });

  it('cross-fades: a new view starts transparent and the old one is disposed after fading', () => {
    FakeView.live = 0;
    const views: FakeView[] = [];
    const sm = new StreamingManager({ lodRadius: [1.2, 2, 3, 4], executor: new InlineExecutor(SEED), views: { create: (d) => { const v = new FakeView(d); views.push(v); return v; } } });
    sm.update(0, still(2500, 1700), 1e9);
    const rec = sm.cells.get('12,8')!;
    expect(rec.lod).toBe(0);
    expect((rec.view as FakeView).fade).toBe(0);
    sm.update(0.2, still(2500, 1700), 1e9);
    expect((rec.view as FakeView).fade).toBeGreaterThan(0.2);
    expect((rec.view as FakeView).fade).toBeLessThan(1);
    sm.update(1, still(2500, 1700), 1e9);
    expect((rec.view as FakeView).fade).toBe(1);
    FakeView.disposed = 0;
    sm.update(0.1, still(9000, 9000), 1e9); // leave
    expect(FakeView.disposed).toBe(0); // old views are still fading out
    sm.update(1, still(9000, 9000), 1e9);
    sm.update(1, still(9000, 9000), 1e9);
    expect(FakeView.disposed).toBeGreaterThan(20);
  });
});
