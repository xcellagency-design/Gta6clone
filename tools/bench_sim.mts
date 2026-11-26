/**
 * Simulation-side benchmark (Node, no rendering): world generation, the fixed simulation step,
 * and streaming work during a fast drive. Writes out/bench-sim.json.
 *
 *   npx tsx tools/bench_sim.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { QUALITY } from '../src/core/config';
import { GameSim } from '../src/core/GameSim';
import { ScriptedInput } from '../src/core/Input';
import { generateCell } from '../src/streaming/CellGenerator';
import { InlineExecutor } from '../src/streaming/executors';
import { CELLS_X, CELLS_Z } from '../src/world/CityPlan';

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (n: number) => Math.round(n * 100) / 100;

// 1. Cell generation, every cell of the map at every LOD.
const gen: Record<string, { meanMs: number; p99Ms: number; maxMs: number; meanKB: number }> = {};
for (let lod = 0; lod < 4; lod++) {
  const t: number[] = [], bytes: number[] = [];
  for (let cz = 0; cz < CELLS_Z; cz++) for (let cx = 0; cx < CELLS_X; cx++) {
    const c = generateCell(cx, cz, lod, 7);
    t.push(c.generationMs); bytes.push(c.bytes);
  }
  gen['lod' + lod] = { meanMs: r2(mean(t)), p99Ms: r2(pct(t, 0.99)), maxMs: r2(Math.max(...t)), meanKB: r2(mean(bytes) / 1024) };
}

// 2. Simulation step with a full population, standing downtown.
async function stepCost(quality: keyof typeof QUALITY) {
  const input = new ScriptedInput();
  const sim = await GameSim.create({ executor: new InlineExecutor(7), input, quality: QUALITY[quality], seed: 7 });
  await sim.newGame();
  sim.env.hour = 13;
  await sim.teleport(2493, 1905);
  for (let i = 0; i < 1500; i++) { sim.streamTick(1 / 60, 1e9); sim.step(); }
  const times: number[] = [], phys: number[] = [];
  for (let i = 0; i < 1800; i++) {
    sim.streamTick(1 / 60, 4);
    const t0 = performance.now();
    sim.step();
    times.push(performance.now() - t0);
    phys.push(sim.physics.lastStepMs);
  }
  return {
    quality, pedestrians: sim.peds.peds.length, traffic: sim.traffic.cars.length, vehicles: sim.vehicles.all.size, staticColliders: sim.physics.staticColliderCount,
    stepMeanMs: r2(mean(times)), stepP99Ms: r2(pct(times, 0.99)), stepMaxMs: r2(Math.max(...times)), physicsMeanMs: r2(mean(phys)),
    npcAndTrafficMeanMs: r2(mean(times) - mean(phys)),
  };
}

// 3. Streaming while driving flat out along the I-9, generation limited to two cells per frame.
async function streamDrive() {
  const input = new ScriptedInput();
  const sim = await GameSim.create({ executor: new InlineExecutor(7, 2), input, quality: QUALITY.medium, seed: 7 });
  await sim.newGame();
  await sim.teleport(805, 500, 0);
  const car = sim.vehicles.spawn('sports', 805, 0.2, 505, 0);
  car.owner = 'player';
  sim.putInVehicle(car);
  input.set({ moveY: 1 });
  const work: number[] = [];
  let held = 0, top = 0, frames = 0;
  const before = sim.streaming.stats();
  while (car.z < 3200 && frames < 60 * 90) {
    sim.streamTick(1 / 60, 4);
    sim.step();
    const s = sim.streaming.stats();
    work.push(s.frameWorkMs);
    if (sim.waitingForWorld) held++;
    top = Math.max(top, car.speed);
    frames++;
  }
  const s = sim.streaming.stats();
  return {
    distanceM: Math.round(car.z - 505), seconds: r2(frames / 60), topSpeedKmh: Math.round(top * 3.6), framesHeldForWorld: held,
    cellsLoaded: s.loadsCompleted - before.loadsCompleted, cellsUnloaded: s.unloadsCompleted - before.unloadsCompleted,
    streamWorkMeanMs: r2(mean(work)), streamWorkP99Ms: r2(pct(work, 0.99)), streamWorkMaxMs: r2(Math.max(...work)),
    residentCells: s.resident, residentMB: r2(s.residentBytes / 1048576), cacheMB: r2(s.cacheBytes / 1048576), cacheEntries: s.cacheEntries,
    note: 'streamWork includes inline generation of up to two cells per frame; in the browser that part runs in workers',
  };
}

const result = {
  machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
  generation: gen,
  simStep: [await stepCost('low'), await stepCost('medium'), await stepCost('high')],
  streamingDrive: await streamDrive(),
  heapMB: r2(process.memoryUsage().heapUsed / 1048576),
  rssMB: r2(process.memoryUsage().rss / 1048576),
};
mkdirSync('out', { recursive: true });
writeFileSync('out/bench-sim.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
