import { describe, expect, it } from 'vitest';
import { BLOCK, edgeClass, nodeInfo, roadWidth } from '../../src/world/CityPlan';
import { makeSim, run } from './helpers';

/** True when (x, z) lies on a road surface or inside a junction. */
function onRoad(x: number, z: number): boolean {
  const kx = Math.round(x / BLOCK), kz = Math.round(z / BLOCK);
  const n = nodeInfo(kx, kz);
  if (Math.abs(x - kx * BLOCK) <= n.halfX + 1.5 && Math.abs(z - kz * BLOCK) <= n.halfZ + 1.5) return true;
  const v = edgeClass(true, kx, Math.floor(z / BLOCK));
  if (v && Math.abs(x - kx * BLOCK) <= roadWidth(v) / 2 + 0.6) return true;
  const h = edgeClass(false, kz, Math.floor(x / BLOCK));
  return !!h && Math.abs(z - kz * BLOCK) <= roadWidth(h) / 2 + 0.6;
}

describe('traffic', () => {
  it('fills the streets, keeps moving, stays on the road and does not collide', async () => {
    const { sim } = await makeSim();
    await sim.teleport(2450, 1750); // Meridian Center
    sim.traffic.maxCars = 30;
    run(sim, 20);
    expect(sim.traffic.cars.length).toBeGreaterThan(12);
    let overlaps = 0, offRoad = 0, samples = 0, speedSum = 0, turns = 0;
    const dirs = new Map<number, number>();
    for (const c of sim.traffic.cars) dirs.set(c.id, c.dir);
    const stuckAtStart = sim.traffic.stats.retired;
    for (let t = 0; t < 120; t++) {
      run(sim, 1);
      const cars = sim.traffic.cars;
      for (let i = 0; i < cars.length; i++) {
        const a = cars[i];
        samples++; speedSum += a.speed;
        if (!onRoad(a.x, a.z)) offRoad++;
        if (dirs.has(a.id) && dirs.get(a.id) !== a.dir) turns++;
        dirs.set(a.id, a.dir);
        for (let j = i + 1; j < cars.length; j++) {
          if (Math.hypot(a.x - cars[j].x, a.z - cars[j].z) < 1.6) overlaps++;
        }
      }
    }
    expect(offRoad / samples).toBeLessThan(0.002);
    expect(overlaps).toBe(0);
    expect(speedSum / samples).toBeGreaterThan(3.5); // not gridlocked
    expect(turns).toBeGreaterThan(15);
    expect(sim.traffic.stats.redLightStops).toBeGreaterThan(2);
    expect(Math.max(...sim.traffic.cars.map((c) => c.stuck))).toBeLessThan(40);
    expect(sim.traffic.stats.retired - stuckAtStart).toBeLessThan(sim.traffic.stats.spawned);
    // Tiers: only cars near the player carry colliders.
    const st = sim.traffic.stats;
    expect(st.physical + st.kinematic).toBe(sim.traffic.cars.length);
    for (const c of sim.traffic.cars) expect(!!c.body).toBe(Math.hypot(c.x - sim.player.x, c.z - sim.player.z) < 85);
  }, 120000);

  it('follows the player: cars left behind are retired and new ones appear ahead', async () => {
    const { sim } = await makeSim();
    await sim.teleport(2450, 1750);
    run(sim, 15);
    const before = new Set(sim.traffic.cars.map((c) => c.id));
    await sim.teleport(1500, 1300); // The Flats, about a kilometre away
    run(sim, 15);
    const now = sim.traffic.cars;
    expect(now.length).toBeGreaterThan(5);
    expect(now.filter((c) => before.has(c.id)).length).toBeLessThan(3);
    for (const c of now) expect(Math.hypot(c.x - 1500, c.z - 1300)).toBeLessThan(sim.traffic.activeRadius * 1.3);
  }, 60000);

  it('is denser in the city than in the country and thinner at night', async () => {
    const { sim } = await makeSim();
    sim.env.hour = 12;
    await sim.teleport(2450, 1750);
    const city = sim.traffic.targetCount();
    sim.env.hour = 3;
    const night = sim.traffic.targetCount();
    sim.env.hour = 12;
    await sim.teleport(300, 300);
    const country = sim.traffic.targetCount();
    expect(city).toBeGreaterThan(country * 1.5);
    expect(city).toBeGreaterThan(night * 1.5);
  });

  it('slows down in rain', async () => {
    const mean = async (storm: boolean) => {
      const { sim } = await makeSim();
      if (storm) sim.env.setWeather('storm', true);
      await sim.teleport(800, 1500); // beside the I-9
      sim.traffic.maxCars = 24;
      run(sim, 25);
      let sum = 0, n = 0;
      for (let t = 0; t < 30; t++) { run(sim, 1); for (const c of sim.traffic.cars) if (!c.turn && c.stuck === 0) { sum += c.speed; n++; } }
      return sum / n;
    };
    const dry = await mean(false), wet = await mean(true);
    expect(wet).toBeLessThan(dry * 0.95);
  }, 120000);

  it('stops behind a vehicle blocking the lane instead of driving through it', async () => {
    const { sim } = await makeSim();
    await sim.teleport(2450, 1750);
    sim.traffic.maxCars = 0;
    run(sim, 1);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    // Southbound on line 24 (an arterial). Park a truck in the lane 40 m ahead.
    const car = sim.traffic.spawnAt(24, 14, 2, 20, 'sedan')!;
    expect(car).toBeTruthy();
    car.lane = 0;
    run(sim, 0.1);
    const block = sim.vehicles.spawn('truck', car.x, 0.2, car.z + 40, 0);
    run(sim, 12);
    expect(car.speed).toBeLessThan(0.5);
    const gap = block.z - car.z;
    expect(gap).toBeGreaterThan(block.profile.length / 2 + car.profile.length / 2);
    expect(gap).toBeLessThan(16);
    expect(block.health).toBe(100);
  }, 60000);

  it('a hard hit from the player turns a traffic car into a wreck and counts as a crime', async () => {
    const { sim, input } = await makeSim();
    await sim.teleport(2450, 1750);
    sim.traffic.maxCars = 0;
    run(sim, 0.5);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    const car = sim.traffic.spawnAt(24, 14, 2, 60, 'sedan')!;
    car.speed = 0; car.temper = 0.01;
    run(sim, 0.1);
    const mine = sim.vehicles.spawn('suv', car.x, 0.2, car.z - 45, 0);
    mine.owner = 'player';
    sim.player.teleport(mine.x + 2.2, 0.3, mine.z);
    run(sim, 0.5);
    input.pulse('enterExit');
    run(sim, 0.2);
    expect(sim.playerVehicle).toBe(mine);
    input.set({ moveY: 1 });
    run(sim, 5);
    expect(sim.traffic.stats.crashes).toBe(1);
    expect(sim.traffic.cars.includes(car)).toBe(false);
    expect(sim.bus.log.some((e) => e.type === 'crime.committed' && (e.payload as { type: string }).type === 'collision')).toBe(true);
    expect(sim.vehicles.transient.size).toBe(1);
  }, 60000);

  it('lets the player take a stopped car, which is a carjacking', async () => {
    const { sim, input } = await makeSim();
    await sim.teleport(2450, 1750);
    sim.traffic.maxCars = 0;
    run(sim, 0.5);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    const car = sim.traffic.spawnAt(24, 14, 2, 50, 'sports')!;
    car.speed = 0; car.temper = 0.001;
    run(sim, 0.1);
    sim.player.teleport(car.x + 2.2, 0.3, car.z);
    run(sim, 0.3);
    input.pulse('enterExit');
    run(sim, 0.3);
    expect(sim.playerVehicle?.profile.id).toBe('sports');
    const ev = sim.bus.log.find((e) => e.type === 'vehicle.entered')!.payload as { stolen: boolean; carjack: boolean };
    expect(ev.stolen && ev.carjack).toBe(true);
    expect(sim.traffic.cars.length).toBe(0);
  }, 60000);
});
