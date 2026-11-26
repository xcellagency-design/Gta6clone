import { poiActions } from '../economy/Interactions';
import type { GameApp } from '../main';
import { ENDING_PATHS, GRAPH, REGISTRY } from '../missions/MissionSystem';
import { applyState, captureState, saveMeta } from '../save/GameState';
import { allPois } from '../world/Pois';

interface StepResult { step: string; passed: boolean; detail: string }

/**
 * The later-milestone half of the gameplay self-test. It runs inside the page, against the
 * live game, and measures everything from game state — nothing here is asserted by fiat.
 */
export function installSelfTest(app: GameApp, commands: Record<string, (...a: string[]) => unknown>): void {
  commands.selftest = async (): Promise<StepResult[]> => {
    const sim = app.sim;
    const out: StepResult[] = [];
    const add = (step: string, passed: boolean, detail: string) => out.push({ step, passed, detail });
    const run = (ticks: number) => { for (let i = 0; i < ticks; i++) { sim.streamTick(1 / 60, 8); sim.step(); } };
    const guard = async (name: string, fn: () => Promise<void> | void) => {
      try { await fn(); } catch (e) { add(name, false, 'threw: ' + String((e as Error).message).split('\n')[0]); }
    };

    await guard('npcs spawn and move', async () => {
      sim.env.hour = 13;
      sim.env.setWeather('clear', true);
      await sim.teleport(1603, 1250);
      run(120);
      const before = new Map(sim.peds.peds.map((p) => [p.id, { x: p.x, z: p.z }]));
      const cars0 = new Map(sim.traffic.cars.map((c) => [c.id, { x: c.x, z: c.z }]));
      run(600);
      let moved = 0, drove = 0;
      for (const p of sim.peds.peds) { const b = before.get(p.id); if (b && Math.hypot(p.x - b.x, p.z - b.z) > 2) moved++; }
      for (const c of sim.traffic.cars) { const b = cars0.get(c.id); if (b && Math.hypot(c.x - b.x, c.z - b.z) > 5) drove++; }
      add('npcs spawn and move', sim.peds.peds.length >= 4 && moved >= 2,
        `${sim.peds.peds.length} pedestrians (${sim.peds.stats.full} full, ${sim.peds.stats.simple} simple), ${moved} walked on; ${app.renderer.characters.count} characters drawn`);
      add('traffic drives', sim.traffic.cars.length >= 3 && drove >= 2,
        `${sim.traffic.cars.length} cars (${sim.traffic.stats.physical} physical, ${sim.traffic.stats.kinematic} kinematic), ${drove} moved on; ${sim.traffic.stats.redLightStops.toFixed(0)} s spent waiting at red lights`);
    });

    await guard('mission objectives', async () => {
      const m = sim.missions;
      const offer = m.offers().find((o) => o.story)!;
      await sim.teleport(offer.x + 1, offer.z);
      run(10);
      app.scripted!.pulse('interact');
      run(10);
      const started = m.active?.id === offer.id;
      const first = m.objective();
      const goal = m.active!.goal!;
      const car = sim.vehicles.spawn('sedan', goal.x, 0.2, goal.z + 4, 0);
      car.owner = 'player';
      sim.putInVehicle(car);
      await sim.teleport(goal.x, goal.z);
      run(40);
      const advanced = (m.active?.step ?? 0) >= 1;
      app.hud.extras.objective = m.objective();
      app.hud.update(sim);
      const shown = app.hud.root.querySelector('.hud-objective')?.textContent ?? '';
      add('mission objectives', started && advanced && !!first && shown.length > 3,
        `"${offer.title}" started at its giver; objective "${(first ?? '').slice(0, 50)}…" completed on arrival, next: "${shown.slice(0, 50)}…"`);
      m.abandon();
      sim.leaveVehicle();
    });

    await guard('save and load', async () => {
      const m = sim.missions;
      m.replay([]);
      const choice = GRAPH.nodes[0].choices[0].id;
      m.decide(choice);
      sim.economy.earn(1234, 'self-test');
      await sim.teleport(2500, 1905);
      run(20);
      const want = { cash: sim.economy.cash, node: m.story.node, history: [...m.story.history], x: sim.player.x, z: sim.player.z, vars: JSON.stringify(m.story.vars), day: sim.env.day };
      const wrote = app.saves.write('slot3', captureState(sim), saveMeta(sim));
      // Change everything, then load.
      sim.economy.fine(999999);
      m.replay([]);
      await sim.teleport(600, 700);
      const r = app.saves.load('slot3');
      if (r.ok) await applyState(sim, r.data);
      run(20);
      const pos = Math.hypot(sim.player.x - want.x, sim.player.z - want.z);
      add('save and load', wrote && r.ok && sim.economy.cash === want.cash && pos < 3,
        `slot written and read back: cash $${sim.economy.cash}, position restored to within ${pos.toFixed(1)} m`);
      add('narrative decisions persist', m.story.node === want.node && JSON.stringify(m.story.history) === JSON.stringify(want.history) && JSON.stringify(m.story.vars) === want.vars,
        `after loading, the story is at "${m.story.getNode().title}" with decision [${m.story.history.join(', ')}] and identical variables`);

      // Recovery: damage the newest copy and load again.
      app.saves.write('slot3', captureState(sim), saveMeta(sim));
      localStorage.setItem('undertow.save.slot3', localStorage.getItem('undertow.save.slot3')!.slice(0, 200));
      const rec = app.saves.load('slot3');
      add('corrupt save recovery', rec.ok && rec.recovered, rec.ok ? 'a truncated save was detected by its checksum and the backup copy loaded instead' : `not recovered: ${rec.reason}`);
    });

    await guard('all 20 endings reachable', () => {
      const reached: string[] = [];
      for (const e of REGISTRY.endings) {
        sim.missions.replay(ENDING_PATHS[e.id]);
        if (sim.missions.endingReached?.id === e.id) reached.push(e.id);
      }
      sim.missions.replay([]);
      add('all 20 endings reachable', reached.length === 20 && REGISTRY.endings.length === 20,
        `${reached.length}/20 endings selected in the running game by replaying their decision paths`);
    });

    await guard('economy', async () => {
      const shop = allPois().find((p) => p.type === 'shop')!;
      sim.economy.earn(500, 'self-test');
      const cash = sim.economy.cash, kits = sim.economy.inventory.repairKits;
      const action = poiActions(sim, shop).find((a) => a.id === 'kit')!;
      const msg = action.run();
      const broke = poiActions(sim, allPois().find((p) => p.type === 'dealership')!).find((a) => a.cost > sim.economy.cash);
      add('economy', sim.economy.cash === cash - action.cost && sim.economy.inventory.repairKits === kits + 1 && (!broke || !broke.enabled),
        `bought a repair kit at ${shop.name} for $${action.cost} ("${msg}"); purchases the player cannot afford are disabled`);
    });

    await guard('wanted level', async () => {
      await sim.teleport(2500, 1905);
      sim.bus.emit('crime.reported', { type: 'carjack', x: sim.player.x, z: sim.player.z, severity: 3, by: 'witness' });
      run(30);
      const level = sim.wanted.level;
      app.hud.extras.wanted = level;
      app.hud.update(sim);
      const stars = app.hud.root.querySelector('.hud-wanted')?.textContent ?? '';
      sim.wanted.clearByPayment();
      add('wanted level', level >= 1 && stars.includes('★') && sim.wanted.level === 0, `a reported carjacking raised the wanted level to ${level}; the HUD showed "${stars}"; cleared afterwards`);
    });

    await guard('audio', () => {
      app.audio.start(sim);
      app.audio.update(sim, 1 / 60);
      const ctx = (app.audio as unknown as { ctx: AudioContext | null }).ctx;
      add('audio', !!ctx, ctx ? `Web Audio graph built, context ${ctx.state} (a browser may hold it suspended until the first real key press or click)` : 'no AudioContext available');
    });

    return out;
  };
}
