import { describe, expect, it } from 'vitest';
import { makeSim, run } from './helpers';

const FLATS = { x: 1603, z: 1250 }; // on an avenue through The Flats

describe('pedestrians', () => {
  it('populate the sidewalks, move, and stay on them', async () => {
    const { sim } = await makeSim();
    sim.env.hour = 13;
    await sim.teleport(FLATS.x, FLATS.z);
    run(sim, 3);
    expect(sim.peds.peds.length).toBeGreaterThan(8);
    expect(sim.peds.peds.length).toBeLessThanOrEqual(sim.peds.maxPeds);
    const start = new Map(sim.peds.peds.map((p) => [p.id, { x: p.x, z: p.z }]));
    run(sim, 20);
    let moved = 0;
    for (const p of sim.peds.peds) {
      const s = start.get(p.id);
      if (s && Math.hypot(p.x - s.x, p.z - s.z) > 3) moved++;
      // Walking the ring or crossing between rings: never far from a sidewalk, never inside a building.
      if (p.activity === 'walk') {
        const r = p.ring;
        const onEdge = Math.min(Math.abs(p.x - r.x0), Math.abs(p.x - r.x1), Math.abs(p.z - r.z0), Math.abs(p.z - r.z1));
        expect(onEdge).toBeLessThan(0.01);
      }
    }
    expect(moved).toBeGreaterThan(5);
    expect(sim.peds.stats.full + sim.peds.stats.simple).toBe(sim.peds.peds.length);
  }, 60000);

  it('show varied behaviour over time: talking, crossing, entering buildings', async () => {
    const { sim } = await makeSim();
    sim.env.hour = 13;
    sim.peds.maxPeds = 70;
    await sim.teleport(FLATS.x + 40, FLATS.z); // on the sidewalk, among the crowd
    const seen = new Set<string>();
    for (let t = 0; t < 150; t++) { run(sim, 1); for (const p of sim.peds.peds) seen.add(p.activity); }
    for (const a of ['walk', 'idle', 'phone']) expect(seen.has(a), a).toBe(true);
    expect(sim.peds.stats.entered).toBeGreaterThan(0);
    expect(sim.peds.stats.crossings).toBeGreaterThan(0);
    expect(sim.peds.stats.talks).toBeGreaterThan(0);
  }, 120000);

  it('are fewer at night and in rain, and more numerous downtown than in the suburbs', async () => {
    const count = async (hour: number, storm: boolean, x: number, z: number) => {
      const { sim } = await makeSim();
      sim.env.hour = hour;
      if (storm) sim.env.setWeather('storm', true);
      await sim.teleport(x, z);
      run(sim, 2);
      return sim.peds.peds.length;
    };
    const day = await count(13, false, FLATS.x, FLATS.z);
    const night = await count(3, false, FLATS.x, FLATS.z);
    const rain = await count(13, true, FLATS.x, FLATS.z);
    const suburb = await count(13, false, 1000, 900);
    expect(night).toBeLessThan(day * 0.5);
    expect(rain).toBeLessThan(day * 0.75);
    expect(suburb).toBeLessThan(day);
  }, 120000);

  it('get out of the way of a speeding car and can be run over', async () => {
    const { sim, input } = await makeSim();
    sim.env.hour = 13;
    await sim.teleport(FLATS.x, FLATS.z);
    sim.traffic.enabled = false;
    sim.wanted.enabled = false;
    run(sim, 2);
    const car = sim.vehicles.spawn('sedan', 1610, 0.2, 1200 + 2.5, Math.PI / 2);
    car.owner = 'player';
    sim.player.teleport(car.x, 0.3, car.z + 2.2);
    run(sim, 0.4);
    input.pulse('enterExit');
    run(sim, 0.2);
    expect(sim.playerVehicle).toBe(car);
    // Put a bold pedestrian in the road ahead: struck. A timid one to the side: flees.
    const ring = sim.peds.peds[0].ring;
    const victim = sim.peds.spawnOn(ring)!;
    victim.activity = 'idle'; victim.timer = 60; victim.x = car.x + 30; victim.z = car.z; victim.nerve = 1; victim.tier = 0;
    const fled0 = sim.peds.stats.fled;
    input.set({ moveY: 1 });
    run(sim, 6);
    expect(sim.peds.stats.fled + sim.peds.stats.run_over).toBeGreaterThan(fled0);
    expect(sim.peds.stats.run_over).toBeGreaterThan(0);
    expect(victim.activity).toBe('down');
    expect(sim.bus.log.some((e) => e.type === 'crime.committed' && (e.payload as { type: string }).type === 'hit_pedestrian')).toBe(true);
  }, 60000);
});

describe('crime, witnesses and police', () => {
  it('an unwitnessed crime has no consequences', async () => {
    const { sim } = await makeSim();
    await sim.teleport(300, 300); // empty country
    sim.traffic.maxCars = 0;
    run(sim, 1);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    sim.bus.emit('crime.committed', { type: 'vehicle_theft', x: sim.player.x, z: sim.player.z, severity: 2 });
    run(sim, 20);
    expect(sim.bus.count('crime.reported')).toBe(0);
    expect(sim.wanted.level).toBe(0);
  }, 60000);

  it('a witnessed crime is phoned in after a delay, and police go to where it happened', async () => {
    const { sim } = await makeSim();
    sim.env.hour = 13;
    sim.peds.maxPeds = 70;
    sim.traffic.enabled = false;
    await sim.teleport(FLATS.x, FLATS.z);
    run(sim, 2);
    for (const p of sim.peds.peds) { p.civic = 1; p.nerve = 1; }
    const where = { x: sim.player.x, z: sim.player.z };
    sim.bus.emit('crime.committed', { type: 'carjack', x: where.x, z: where.z, severity: 3 });
    expect(sim.peds.stats.witnesses).toBeGreaterThan(0);
    expect(sim.wanted.level).toBe(0); // nobody has called yet
    run(sim, 1);
    expect(sim.peds.peds.some((p) => p.activity === 'report')).toBe(true);
    // The player slips away before the call connects.
    await sim.teleport(FLATS.x + 500, FLATS.z + 300);
    run(sim, 9);
    expect(sim.bus.count('crime.reported')).toBeGreaterThan(0);
    expect(sim.wanted.level).toBeGreaterThan(0);
    expect(sim.wanted.state).toBe('search');
    // Police knowledge is the scene of the crime, not the player's real position.
    expect(Math.hypot(sim.wanted.lastKnown!.x - where.x, sim.wanted.lastKnown!.z - where.z)).toBeLessThan(5);
    expect(Math.hypot(sim.wanted.lastKnown!.x - sim.player.x, sim.wanted.lastKnown!.z - sim.player.z)).toBeGreaterThan(300);
    expect(sim.bus.count('wanted.changed')).toBeGreaterThan(0);
  }, 60000);

  it('witnesses behind a building see nothing', async () => {
    const { sim } = await makeSim();
    sim.env.hour = 13;
    await sim.teleport(2450, 1750); // downtown: towers block the view
    run(sim, 2);
    const seenBefore = sim.peds.stats.witnesses;
    // A crime in the middle of a tower block's footprint: walls all around.
    sim.bus.emit('crime.committed', { type: 'collision', x: 2450 + 50, z: 1750 - 50, severity: 1 });
    const seen = sim.peds.stats.witnesses - seenBefore;
    const near = sim.peds.peds.filter((p) => Math.hypot(p.x - 2500, p.z - 1700) < sim.env.visibility()).length;
    expect(seen).toBeLessThan(Math.max(1, near));
  }, 60000);

  it('units are dispatched, search, and give up when the player stays hidden', async () => {
    const { sim } = await makeSim();
    await sim.teleport(2450, 1750);
    run(sim, 3);
    sim.bus.emit('crime.reported', { type: 'carjack', x: 2450, z: 1750, severity: 3, by: 'witness' });
    expect(sim.wanted.level).toBe(1);
    await sim.teleport(600, 700); // a long way off
    let maxUnits = 0;
    run(sim, 14, () => { maxUnits = Math.max(maxUnits, sim.wanted.units.length); });
    expect(maxUnits).toBeGreaterThan(0);
    expect(sim.wanted.state).toBe('search');
    expect(sim.wanted.seen).toBe(false);
    run(sim, 30);
    expect(sim.wanted.level).toBe(0);
    expect(sim.wanted.escapes).toBe(1);
    expect(sim.bus.log.some((e) => e.type === 'wanted.cleared')).toBe(true);
    expect(sim.wanted.notoriety).toBeGreaterThan(0);
  }, 60000);

  it('escalates with more reported crime', async () => {
    const { sim } = await makeSim();
    const levels: number[] = [];
    for (let i = 0; i < 7; i++) {
      sim.bus.emit('crime.reported', { type: 'hit_pedestrian', x: sim.player.x, z: sim.player.z, severity: 3, by: 'witness' });
      levels.push(sim.wanted.level);
    }
    expect(levels[0]).toBeGreaterThanOrEqual(1);
    expect(levels[6]).toBe(5);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
  });

  it('an officer with line of sight starts a pursuit and arrests a player who stays put', async () => {
    const { sim } = await makeSim();
    await sim.teleport(2450, 1750);
    sim.traffic.maxCars = 0;
    run(sim, 1);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    // A cruiser stopped a few metres from the player, in the open street.
    const cop = sim.traffic.spawnAt(24, 17, 2, 45, 'police')!;
    cop.speed = 0; cop.temper = 0.001;
    run(sim, 0.1);
    sim.player.teleport(cop.x + 3.5, 0.3, cop.z);
    run(sim, 0.5);
    let fined = 0;
    sim.wanted.cashOnHand = () => 1000;
    sim.wanted.chargeFine = (n) => { fined = n; return n; };
    // The officer sees the crime: no witness call needed.
    sim.bus.emit('crime.committed', { type: 'vehicle_theft', x: sim.player.x, z: sim.player.z, severity: 2 });
    expect(sim.wanted.level).toBeGreaterThan(0);
    run(sim, 1);
    expect(sim.wanted.state).toBe('pursuit');
    expect(sim.wanted.seen).toBe(true);
    expect(Math.hypot(sim.wanted.lastKnown!.x - sim.player.x, sim.wanted.lastKnown!.z - sim.player.z)).toBeLessThan(2);
    run(sim, 5);
    expect(sim.wanted.busts).toBe(1);
    expect(fined).toBeGreaterThan(0);
    expect(sim.wanted.level).toBe(0);
    expect(sim.bus.count('player.busted')).toBe(1);
  }, 60000);

  it('pursuing units leave their lane and physically chase a fleeing car', async () => {
    const { sim, input } = await makeSim();
    await sim.teleport(800, 1500); // beside the I-9: room to run
    sim.traffic.maxCars = 0;
    run(sim, 1);
    for (const c of [...sim.traffic.cars]) sim.traffic.remove(c);
    const mine = sim.vehicles.spawn('sedan', 795, 0.2, 1500, 0);
    mine.owner = 'player';
    sim.player.teleport(mine.x + 2.2, 0.3, mine.z);
    run(sim, 0.4);
    input.pulse('enterExit');
    run(sim, 0.2);
    const cop = sim.traffic.spawnAt(8, 14, 2, 60, 'police')!;
    expect(cop).toBeTruthy();
    run(sim, 0.2);
    sim.bus.emit('crime.reported', { type: 'carjack', x: mine.x, z: mine.z, severity: 3, by: 'police' });
    input.set({ moveY: 1 });
    let chasing = 0, minGap = Infinity;
    run(sim, 14, () => {
      const u = sim.wanted.units.find((x) => x.vehicle && x.kind === 'patrol');
      if (u?.vehicle) { chasing++; minGap = Math.min(minGap, Math.hypot(u.vehicle.x - mine.x, u.vehicle.z - mine.z)); }
    });
    expect(chasing).toBeGreaterThan(60);
    const unit = sim.wanted.units.find((x) => x.vehicle && x.kind === 'patrol');
    expect(unit?.vehicle?.distance ?? 0).toBeGreaterThan(40);
    expect(minGap).toBeLessThan(80);
  }, 60000);
});
