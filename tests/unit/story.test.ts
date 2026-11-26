import { describe, expect, it } from 'vitest';
import type { GameSim } from '../../src/core/GameSim';
import { ENDING_PATHS, GRAPH, MissionSystem, REGISTRY, SIDE_MISSIONS } from '../../src/missions/MissionSystem';
import { NarrativeState } from '../../src/narrative/NarrativeState';
import { analyseReachability } from '../../src/narrative/reachability';
import { CHARACTERS } from '../../src/npc/Characters';
import { DISTRICTS } from '../../src/world/CityPlan';
import { makeSim, run } from './helpers';

/** Completes whatever step is active the way a player would, but without the commute. */
async function playStep(sim: GameSim): Promise<void> {
  const m = sim.missions;
  const s = m.step()!;
  const a = m.active!;
  const before = a.step;
  const onFoot = async (x: number, z: number) => { sim.leaveVehicle(); await sim.teleport(x, z); };
  const inCar = async (x: number, z: number, profile = 'sedan', owner: 'player' | 'npc' = 'player') => {
    let v = sim.playerVehicle;
    if (!v || v.profile.id !== profile) { v = sim.vehicles.spawn(profile, x, profile === 'boat' ? -0.6 : 0.2, z, 0); v.owner = owner; sim.putInVehicle(v); }
    await sim.teleport(x, z);
  };
  switch (s.type) {
    case 'goto': await onFoot(a.goal!.x, a.goal!.z); break;
    case 'drive_to': case 'timed_drive': case 'deliver_vehicle': await inCar(a.goal!.x, a.goal!.z); break;
    case 'boat_to': await inCar(a.goal!.x, a.goal!.z, 'boat'); break;
    case 'steal_vehicle': {
      sim.leaveVehicle();
      const cls = s.vehicleClass ?? 'sedan';
      const v = sim.vehicles.spawn(cls, sim.player.x + 4, cls === 'boat' ? -0.6 : 0.2, sim.player.z, 0);
      sim.putInVehicle(v);
      break;
    }
    case 'collect': for (const k of [...a.pickups]) { await onFoot(k.x, k.z); run(sim, 0.2); } break;
    case 'talk': await onFoot(a.goal!.x + 1, a.goal!.z); break;
    case 'evade_police': run(sim, 0.5); sim.wanted.clearByPayment(); break;
    case 'wait': break;
  }
  for (let i = 0; i < 1500 && m.active === a && a.step === before; i++) run(sim, 0.1);
}

async function playMission(sim: GameSim, id: string): Promise<void> {
  expect(sim.missions.start(id)).toBe(true);
  let guard = 0;
  while (sim.missions.active && guard++ < 20) await playStep(sim);
  expect(sim.missions.active).toBeNull();
}

describe('narrative data', () => {
  it('has exactly twenty endings and every one is reachable by valid decisions', () => {
    const r = analyseReachability(GRAPH, REGISTRY);
    expect(r.errors).toEqual([]);
    expect(REGISTRY.endings.length).toBe(20);
    expect(new Set(REGISTRY.endings.map((e) => e.id)).size).toBe(20);
    for (const e of REGISTRY.endings) expect(r.pathCounts[e.id], `${e.id} ${e.name}`).toBeGreaterThan(0);
    // No ending is a rounding error of the path space, and none swallows it.
    for (const e of REGISTRY.endings) {
      const share = r.pathCounts[e.id] / r.totalPaths;
      expect(share).toBeGreaterThan(0.003);
      expect(share).toBeLessThan(0.3);
    }
    expect(r.nodesVisited).toBe(GRAPH.nodes.length);
    // A playthrough does not see every branch.
    expect(r.longestPath).toBeLessThan(GRAPH.nodes.length - 8);
  });

  it('the stored witness path for each ending replays to exactly that ending', () => {
    for (const e of REGISTRY.endings) {
      const path = ENDING_PATHS[e.id];
      expect(path, e.id).toBeTruthy();
      const ns = new NarrativeState(GRAPH, REGISTRY);
      ns.replay(path);
      expect(ns.atFinale()).toBe(true);
      expect(ns.ending).toBe(e.id);
      // Deterministic: the same choices always end the same way.
      const again = new NarrativeState(GRAPH, REGISTRY);
      again.replay(path);
      expect(again.snapshot()).toEqual(ns.snapshot());
    }
  });

  it('endings are genuinely different conclusions', () => {
    const fates = new Set(REGISTRY.endings.map((e) => e.characterOutcomes.cass));
    expect(fates.size).toBe(20);
    expect(new Set(REGISTRY.endings.map((e) => e.finalSequence.id)).size).toBe(20);
    expect(new Set(REGISTRY.endings.map((e) => e.name)).size).toBe(20);
    expect(new Set(REGISTRY.endings.map((e) => [e.cinematic.district, e.cinematic.timeOfDay, e.cinematic.weather, e.cinematic.camera].join())).size).toBe(20);
    for (const e of REGISTRY.endings) {
      expect(Object.keys(e.characterOutcomes).length).toBeGreaterThanOrEqual(4);
      expect(e.consequences.length).toBeGreaterThanOrEqual(3);
      expect(e.cinematic.shots.length).toBeGreaterThanOrEqual(4);
      expect(DISTRICTS[e.cinematic.district as keyof typeof DISTRICTS], e.cinematic.district).toBeTruthy();
    }
    // Different survivors across endings.
    const pathsAlive = REGISTRY.endings.map((e) => { const ns = new NarrativeState(GRAPH, REGISTRY); ns.replay(ENDING_PATHS[e.id]); return `${ns.flags.jun_alive}${ns.flags.sal_alive}${ns.flags.toby_alive}${ns.flags.mama_tide_dead}${ns.flags.whitlock_dead}`; });
    expect(new Set(pathsAlive).size).toBeGreaterThanOrEqual(4);
  });

  it('references only characters and districts that exist', () => {
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const check = (m: { giver: string; startDistrict: string; steps: { type: string; district?: string; character?: string }[] }) => {
      expect(ids.has(m.giver), m.giver).toBe(true);
      expect(DISTRICTS[m.startDistrict as keyof typeof DISTRICTS]).toBeTruthy();
      for (const s of m.steps) {
        if (s.district) expect(DISTRICTS[s.district as keyof typeof DISTRICTS], s.district).toBeTruthy();
        if (s.character) expect(ids.has(s.character), s.character).toBe(true);
      }
    };
    for (const n of GRAPH.nodes) if (n.mission) check(n.mission);
    for (const s of SIDE_MISSIONS) check(s.mission);
    expect(SIDE_MISSIONS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SIDE_MISSIONS.map((s) => s.mission.kind)).size).toBeGreaterThanOrEqual(6);
    for (const c of CHARACTERS) {
      const hours = new Set<number>();
      for (const e of c.schedule) for (let i = 0, h = e.from % 24; i < 24 && h !== e.to % 24 || (i === 0 && e.from % 24 === e.to % 24); i++, h = (h + 1) % 24) hours.add(h);
      expect(hours.size, `${c.id} schedule covers the day`).toBe(24);
    }
  });
});

describe('missions in the running game', () => {
  it('offers the first story mission, runs its objectives, pays out and asks for a decision', async () => {
    const { sim, input } = await makeSim();
    const m = sim.missions;
    const offer = m.offers().find((o) => o.story)!;
    expect(offer.id).toBe(GRAPH.start);
    expect(m.offers().length).toBeGreaterThan(8);
    // Walk up to the giver and press interact.
    await sim.teleport(offer.x + 1, offer.z);
    run(sim, 0.2);
    expect(m.nearestOffer(sim.player.x, sim.player.z)?.id).toBe(offer.id);
    input.pulse('interact');
    run(sim, 0.2);
    expect(m.active?.id).toBe(offer.id);
    expect(m.objective()).toBeTruthy();
    expect(m.targets().length).toBeGreaterThan(0);
    expect(sim.bus.count('mission.started')).toBe(1);
    const cash = sim.economy.cash;
    const steps = m.active!.def.steps.length;
    let guard = 0;
    while (m.active && guard++ < 20) await playStep(sim);
    expect(sim.bus.count('mission.step')).toBe(steps);
    expect(sim.bus.count('mission.completed')).toBe(1);
    expect(sim.economy.cash).toBe(cash + GRAPH.nodes[0].mission!.rewardCash);
    // The decision is now the player's.
    expect(m.pendingDecision?.id).toBe(GRAPH.start);
    expect(m.offers().length).toBe(0);
    const choice = m.story.availableChoices()[0];
    const before = JSON.stringify(m.story.snapshot());
    m.decide(choice.id);
    expect(JSON.stringify(m.story.snapshot())).not.toBe(before);
    expect(m.story.history).toEqual([choice.id]);
    expect(m.story.node).not.toBe(GRAPH.start);
    expect(sim.bus.count('narrative.choice')).toBe(1);
  }, 120000);

  it('shows dialogue line by line during a talk objective', async () => {
    const { sim } = await makeSim();
    const m = sim.missions;
    m.start(GRAPH.start);
    while (m.step()?.type !== 'talk') await playStep(sim);
    const talk = m.step() as { lines: string[] };
    expect(m.actors().length).toBe(1);
    sim.leaveVehicle();
    await sim.teleport(m.active!.goal!.x + 1, m.active!.goal!.z);
    const seen: string[] = [];
    for (let i = 0; i < 900 && m.step()?.type === 'talk'; i++) { run(sim, 0.1); if (m.dialogue && seen[seen.length - 1] !== m.dialogue.text) seen.push(m.dialogue.text); }
    expect(seen.length).toBe(talk.lines.length);
    expect(talk.lines[0]).toContain(seen[0]);
  }, 120000);

  it('fails a timed drive when the clock runs out and restarts from that checkpoint', async () => {
    const { sim } = await makeSim();
    const m = sim.missions;
    const node = GRAPH.nodes.find((n) => n.mission?.steps.some((s) => s.type === 'timed_drive'))!;
    const path = Object.values(ENDING_PATHS).find((p) => { const ns = new NarrativeState(GRAPH, REGISTRY); for (const c of p) { if (ns.node === node.id) return true; ns.choose(c); } return false; })!;
    const ns = new NarrativeState(GRAPH, REGISTRY);
    const prefix: string[] = [];
    for (const c of path) { if (ns.node === node.id) break; ns.choose(c); prefix.push(c); }
    m.replay(prefix);
    expect(m.story.node).toBe(node.id);
    m.start(node.id);
    while (m.step()?.type !== 'timed_drive') await playStep(sim);
    const stepIndex = m.active!.step;
    m.active!.timeLeft = 0.5;
    run(sim, 1);
    expect(sim.bus.count('mission.failed')).toBe(1);
    expect(m.objective()).toContain('Out of time');
    run(sim, 4);
    expect(m.active!.step).toBe(stepIndex); // same checkpoint, clock reset
    expect(m.active!.timeLeft).toBeGreaterThan(20);
    expect(m.failures).toBe(1);
  }, 120000);

  it('an evade objective really puts the police on the player and clears when they escape', async () => {
    const { sim } = await makeSim();
    const m = sim.missions;
    const side = SIDE_MISSIONS.find((s) => s.mission.steps.some((x) => x.type === 'evade_police'))!;
    m.start(side.id);
    while (m.step()?.type !== 'evade_police') await playStep(sim);
    run(sim, 0.3);
    expect(sim.wanted.level).toBeGreaterThan(0);
    const idx = m.active!.step;
    await sim.teleport(300, 300); // out in the country, unseen
    for (let i = 0; i < 900 && sim.wanted.level > 0; i++) run(sim, 0.1);
    expect(sim.wanted.level).toBe(0);
    expect(sim.wanted.escapes).toBe(1);
    run(sim, 0.3);
    expect(m.active === null || m.active.step > idx).toBe(true);
  }, 180000);

  it('side missions pay out and are then finished', async () => {
    const { sim } = await makeSim();
    const side = SIDE_MISSIONS.find((s) => !s.repeatable)!;
    const cash = sim.economy.cash;
    await playMission(sim, side.id);
    expect(sim.economy.cash).toBe(cash + side.mission.rewardCash);
    expect(sim.missions.sideDone.has(side.id)).toBe(true);
    expect(sim.missions.offers().some((o) => o.id === side.id)).toBe(false);
    expect(sim.missions.pendingDecision).toBeNull();
  }, 180000);

  it('plays a whole story from the first mission to its ending, every mission along the way', async () => {
    const { sim } = await makeSim();
    const m = sim.missions;
    const target = 'ENDING_08';
    const path = ENDING_PATHS[target];
    let missions = 0;
    for (const choice of path) {
      const node = m.story.getNode();
      if (node.type === 'mission') { await playMission(sim, node.id); missions++; }
      expect(m.pendingDecision?.id).toBe(node.id);
      m.decide(choice);
    }
    expect(m.endingReached?.id).toBe(target);
    expect(sim.bus.count('narrative.ending')).toBe(1);
    expect(missions).toBeGreaterThan(8);
    expect(sim.bus.count('mission.completed')).toBe(missions);
    expect(sim.economy.cash).toBeGreaterThan(5000);
    // The cast remembers what was decided.
    expect([...sim.characters.memories.values()].flat().some((x) => x.event.startsWith('choice:'))).toBe(true);
  }, 600000);

  it('every ending can be reached in the running game through the dev replay', async () => {
    const { sim } = await makeSim();
    const seen = new Set<string>();
    for (const e of REGISTRY.endings) {
      sim.missions.replay(ENDING_PATHS[e.id]);
      expect(sim.missions.endingReached?.id).toBe(e.id);
      seen.add(sim.missions.endingReached!.id);
    }
    expect(seen.size).toBe(20);
    expect(new MissionSystem(sim.bus, sim.economy, sim.wanted, { player: () => ({ x: 0, z: 0, vehicle: null, speed: 0, interact: false }), isAlive: () => true }).story.node).toBe(GRAPH.start);
  }, 60000);
});
