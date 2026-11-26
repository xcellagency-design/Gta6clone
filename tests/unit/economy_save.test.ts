import { describe, expect, it } from 'vitest';
import { PRICES, propertyTerms } from '../../src/economy/Economy';
import { poiActions, useItem } from '../../src/economy/Interactions';
import { ENDING_PATHS } from '../../src/missions/MissionSystem';
import { applyState, captureState, saveMeta, validateSave, type GameSave } from '../../src/save/GameState';
import { MemoryStore, SaveSystem } from '../../src/save/SaveSystem';
import { allPois } from '../../src/world/Pois';
import { makeSim, run } from './helpers';

const poi = (type: string, district?: string) => allPois().find((p) => p.type === type && (!district || p.district === district))!;

describe('economy and interactive locations', () => {
  it('spends, earns and refuses what cannot be afforded', async () => {
    const { sim } = await makeSim();
    const e = sim.economy;
    expect(e.cash).toBe(400);
    expect(e.spend(150, 'x')).toBe(true);
    expect(e.cash).toBe(250);
    expect(e.spend(1000, 'y')).toBe(false);
    expect(e.cash).toBe(250);
    e.earn(1000, 'job');
    expect(e.cash).toBe(1250);
    expect(e.fine(5000)).toBe(1250);
    expect(e.cash).toBe(0);
    expect(sim.bus.count('economy.purchase')).toBe(1);
  });

  it('every kind of location does what it says', async () => {
    const { sim } = await makeSim();
    const e = sim.economy;
    e.earn(200000, 'test');
    const act = (p: ReturnType<typeof poi>, id: string) => { const a = poiActions(sim, p).find((x) => x.id === id)!; expect(a, `${p.type}:${id}`).toBeTruthy(); return a; };

    // Store: inventory.
    let cash = e.cash;
    expect(act(poi('shop'), 'kit').run()).not.toBe('');
    act(poi('shop'), 'fuel').run(); act(poi('shop'), 'phone').run();
    expect(e.inventory).toEqual({ repairKits: 1, fuelCans: 1, burnerPhones: 1 });
    expect(e.cash).toBe(cash - PRICES.repairKit - PRICES.fuelCan - PRICES.burnerPhone);

    // Restaurant: time passes, stamina restored.
    sim.player.stamina = 0.1;
    const h = sim.env.hour;
    act(poi('restaurant'), 'meal').run();
    expect(sim.player.stamina).toBe(1);
    expect(sim.player.fed).toBeGreaterThan(0);
    expect(sim.env.hour).toBeCloseTo(h + 0.5, 3);

    // Garage and fuel need a vehicle nearby.
    const garage = poi('garage');
    expect(act(garage, 'repair').enabled).toBe(false);
    const car = sim.vehicles.spawn('sedan', garage.x + 3, 0.2, garage.z, 0);
    car.owner = 'player'; car.health = 40; car.fuel = 0.2; car.hot = true;
    sim.lastVehicle = car;
    cash = e.cash;
    const repair = act(garage, 'repair');
    expect(repair.cost).toBe(Math.round(60 * PRICES.repairPerPoint));
    repair.run();
    expect(car.health).toBe(100);
    expect(e.cash).toBe(cash - repair.cost);
    const colour = car.color;
    act(garage, 'respray').run();
    expect(car.color).not.toBe(colour);
    expect(car.hot).toBe(false);
    const pump = poi('fuel');
    car.reset(pump.x + 3, 0.6, pump.z, 0);
    act(pump, 'fill').run();
    expect(car.fuel).toBe(1);

    // Clothing changes the outfit the renderer reads.
    const shirt = e.outfit.shirt;
    act(poi('clothing'), 'outfit').run();
    expect(e.outfit.shirt).not.toBe(shirt);

    // Dealership: a new owned vehicle appears outside.
    const before = sim.vehicles.all.size;
    cash = e.cash;
    const buy = poiActions(sim, poi('dealership')).find((a) => a.id.startsWith('buy_'))!;
    buy.run();
    expect(sim.vehicles.all.size).toBe(before + 1);
    expect([...sim.vehicles.persistent].filter((v) => v.owner === 'player').length).toBeGreaterThan(1);
    expect(e.cash).toBe(cash - buy.cost);

    // Business: ownership and daily income.
    const biz = poi('business');
    const terms = propertyTerms(biz);
    act(biz, 'buy').run();
    expect(e.owns(biz.id)).toBe(true);
    expect(poiActions(sim, biz)[0].enabled).toBe(false); // already owned
    cash = e.cash;
    sim.env.day += 2;
    e.update();
    expect(e.cash).toBe(cash + terms.income * 2);
    e.update();
    expect(e.cash).toBe(cash + terms.income * 2); // paid once per day

    // Venue: time passes and a search burns down.
    sim.bus.emit('crime.reported', { type: 'vehicle_theft', x: 0, z: 0, severity: 2, by: 'witness' });
    const unseen = sim.wanted.unseen;
    act(poi('venue'), 'cover').run();
    expect(sim.wanted.unseen).toBeGreaterThan(unseen + 20);
    sim.wanted.clearByPayment();

    // Safehouse: sleep, garage storage.
    const home = allPois().find((p) => p.name === 'Navarro Salvage')!;
    const sleep = act(home, 'sleep');
    const day = sim.env.day;
    sleep.run();
    expect(sim.env.hour).toBe(7);
    expect(sim.env.day).toBeGreaterThanOrEqual(day);
    car.reset(home.x + 4, 0.6, home.z, 0);
    sim.lastVehicle = car;
    act(home, 'store').run();
    expect(sim.vehicles.stored.length).toBe(1);
    expect(sim.vehicles.all.has(car.id)).toBe(false);
    act(home, 'take_0').run();
    expect(sim.vehicles.stored.length).toBe(0);
    // Another safehouse has to be bought before it can be used.
    const other = allPois().find((p) => p.type === 'safehouse' && p.name !== 'Navarro Salvage')!;
    expect(poiActions(sim, other).map((a) => a.id)).toEqual(['buy']);
  }, 60000);

  it('inventory items work and are consumed', async () => {
    const { sim } = await makeSim();
    sim.economy.inventory = { repairKits: 1, fuelCans: 1, burnerPhones: 1 };
    const car = [...sim.vehicles.all.values()].find((v) => v.owner === 'player')!;
    sim.putInVehicle(car);
    car.health = 30; car.fuel = 0.3;
    expect(useItem(sim, 'repairKit')).not.toBe('');
    expect(car.health).toBe(70);
    expect(useItem(sim, 'repairKit')).toBe('');
    useItem(sim, 'fuelCan');
    expect(car.fuel).toBeCloseTo(0.8);
    // A burner phone only helps while a search is on and nobody is watching.
    expect(useItem(sim, 'burnerPhone')).toBe('');
    sim.bus.emit('crime.reported', { type: 'carjack', x: sim.player.x + 300, z: sim.player.z, severity: 3, by: 'witness' });
    const lk = { ...sim.wanted.lastKnown! };
    expect(useItem(sim, 'burnerPhone')).not.toBe('');
    expect(Math.hypot(sim.wanted.lastKnown!.x - lk.x, sim.wanted.lastKnown!.z - lk.z)).toBeGreaterThan(300);
    expect(sim.economy.inventory).toEqual({ repairKits: 0, fuelCans: 0, burnerPhones: 0 });
  }, 60000);

  it('sprinting drains stamina and resting restores it', async () => {
    const { sim, input } = await makeSim();
    sim.camera.yaw = -Math.PI / 2;
    await sim.teleport(1650, 2805);
    sim.camera.yaw = Math.PI / 2;
    input.set({ moveY: 1, sprint: true });
    run(sim, 8);
    expect(sim.player.stamina).toBeLessThan(0.7);
    // Run dry: sprinting stops and does not resume until some breath is back.
    sim.player.stamina = 0.001;
    run(sim, 0.3);
    expect(sim.player.sprinting).toBe(false);
    expect(sim.player.speed).toBeLessThan(5);
    input.set({ moveY: 0, sprint: false });
    run(sim, 10);
    expect(sim.player.stamina).toBe(1);
  }, 60000);
});

describe('saving and loading', () => {
  const fresh = () => new SaveSystem<GameSave>(new MemoryStore(), validateSave);

  it('round-trips the whole playthrough into a different game instance', async () => {
    const { sim } = await makeSim();
    const path = ENDING_PATHS.ENDING_03.slice(0, 6);
    sim.missions.replay(path);
    sim.economy.earn(7777, 'test');
    sim.economy.inventory.repairKits = 2;
    sim.economy.properties.add('poi_test');
    sim.env.hour = 21.25; sim.env.day = 4; sim.env.setWeather('rain', true);
    sim.wanted.notoriety = 5; sim.wanted.escapes = 2;
    sim.characters.remember('jun', 'choice:kept the truck');
    sim.missions.sideDone.add('sm_test');
    await sim.teleport(2450, 1750, 1.2);
    const mine = sim.vehicles.spawn('sports', 2456, 0.2, 1750, 0.5, '#f2c200');
    mine.owner = 'player'; mine.health = 61; mine.fuel = 0.4;
    sim.putInVehicle(mine);
    run(sim, 0.5);
    const saves = fresh();
    expect(saves.write('slot1', captureState(sim), saveMeta(sim))).toBe(true);
    const meta = saves.list()[1]!;
    expect(meta.cash).toBe(sim.economy.cash);
    expect(meta.day).toBe(4);

    const other = (await makeSim()).sim;
    const loaded = saves.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    await applyState(other, loaded.data);
    run(other, 0.5);
    expect(other.economy.cash).toBe(sim.economy.cash);
    expect(other.economy.inventory.repairKits).toBe(2);
    expect(other.economy.owns('poi_test')).toBe(true);
    expect(other.missions.story.snapshot()).toEqual(sim.missions.story.snapshot());
    expect(other.missions.story.history).toEqual(path);
    expect(other.missions.sideDone.has('sm_test')).toBe(true);
    expect(other.env.day).toBe(4);
    expect(other.env.weather).toBe('rain');
    expect(Math.abs(other.env.hour - sim.env.hour)).toBeLessThan(0.05);
    expect(other.wanted.notoriety).toBe(5);
    expect(other.wanted.escapes).toBe(2);
    expect(other.characters.memories.get('jun')?.[0].event).toBe('choice:kept the truck');
    // Back behind the wheel of the same car.
    expect(other.playerVehicle?.profile.id).toBe('sports');
    expect(other.playerVehicle?.color).toBe('#f2c200');
    expect(other.playerVehicle?.health).toBeCloseTo(mine.health, 0);
    expect(other.playerVehicle?.owner).toBe('player');
    expect(Math.hypot(other.player.x - sim.player.x, other.player.z - sim.player.z)).toBeLessThan(3);
    expect(other.waitingForWorld).toBe(false);
  }, 120000);

  it('resumes an interrupted mission at its checkpoint', async () => {
    const { sim } = await makeSim();
    sim.missions.start(sim.missions.story.node);
    (sim.missions as unknown as { advance(): void }).advance();
    const step = sim.missions.active!.step;
    const snap = captureState(sim);
    const other = (await makeSim()).sim;
    await applyState(other, JSON.parse(JSON.stringify(snap)));
    expect(other.missions.active?.id).toBe(sim.missions.active!.id);
    expect(other.missions.active?.step).toBe(step);
    expect(other.missions.objective()).toBe(sim.missions.objective());
  }, 120000);

  it('keeps separate slots and reports the newest', async () => {
    const { sim } = await makeSim();
    const saves = fresh();
    expect(saves.latest()).toBeNull();
    saves.write('slot1', captureState(sim), saveMeta(sim));
    sim.economy.earn(50, 't');
    await new Promise((r) => setTimeout(r, 5));
    saves.write('auto', captureState(sim), saveMeta(sim));
    expect(saves.list().filter(Boolean).length).toBe(2);
    expect(saves.latest()).toBe('auto');
    const a = saves.load('slot1'), b = saves.load('auto');
    expect(a.ok && b.ok && a.data.economy.cash + 50 === b.data.economy.cash).toBe(true);
    expect(saves.load('slot2').ok).toBe(false);
  }, 60000);

  it('detects corruption and recovers from the backup copy', async () => {
    const { sim } = await makeSim();
    const store = new MemoryStore();
    const saves = new SaveSystem<GameSave>(store, validateSave);
    sim.economy.cash = 111;
    saves.write('slot2', captureState(sim), saveMeta(sim));
    sim.economy.cash = 222;
    saves.write('slot2', captureState(sim), saveMeta(sim));
    const key = 'undertow.save.slot2';
    const good = store.getItem(key)!;

    // Truncated.
    store.setItem(key, good.slice(0, good.length / 2));
    let r = saves.load('slot2');
    expect(r.ok && r.recovered && r.data.economy.cash === 111).toBe(true);
    // Tampered: valid JSON, wrong checksum.
    store.setItem(key, good.replaceAll('"cash":222', '"cash":999999'));
    r = saves.load('slot2');
    expect(r.ok && r.recovered && r.data.economy.cash === 111).toBe(true);
    // Wrong version.
    store.setItem(key, good.replace('"version":1', '"version":99'));
    r = saves.load('slot2');
    expect(r.ok && r.recovered).toBe(true);
    // Intact: loads the newest, not flagged.
    store.setItem(key, good);
    r = saves.load('slot2');
    expect(r.ok && !r.recovered && r.data.economy.cash === 222).toBe(true);
    // Both copies destroyed: fails with a reason instead of crashing.
    store.setItem(key, 'garbage');
    store.setItem(key + '.bak', '{"version":1}');
    r = saves.load('slot2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(3);
  }, 60000);

  it('rejects structurally invalid data', () => {
    expect(validateSave(null)).toBeTruthy();
    expect(validateSave({})).toBeTruthy();
    expect(validateSave({ player: { x: 1, z: 2, heading: 0 }, playtime: 1, env: { hour: 30, day: 1 } })).toContain('clock');
  });
});
