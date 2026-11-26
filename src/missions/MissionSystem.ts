import sideData from '../../data/missions/side_missions.json';
import graphData from '../../data/narrative/decision_graph.json';
import registryData from '../../data/narrative/ending_registry.json';
import pathsData from '../../data/narrative/ending_paths.json';
import type { EventBus } from '../core/EventBus';
import { hash2 } from '../core/rng';
import type { Economy } from '../economy/Economy';
import { NarrativeState } from '../narrative/NarrativeState';
import type { DecisionGraph, EndingDef, EndingRegistry, GraphNode, MissionDef, MissionStep } from '../narrative/types';
import type { WantedSystem } from '../police/WantedSystem';
import type { Vehicle } from '../vehicles/Vehicle';
import { BLOCK, districtAnchors, districtOfBlock, isLand, type DistrictId } from '../world/CityPlan';

export const GRAPH = graphData as unknown as DecisionGraph;
export const REGISTRY = registryData as unknown as EndingRegistry;
export const ENDING_PATHS = pathsData as Record<string, string[]>;

interface SideMission { id: string; title: string; summary: string; mission: MissionDef; repeatable: boolean }
export const SIDE_MISSIONS = (sideData as unknown as { missions: SideMission[] }).missions;

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A deterministic road intersection in a district, chosen by key. */
export function anchorFor(district: string, key: string): { x: number; z: number } {
  const a = districtAnchors(district as DistrictId);
  if (!a.length) return { x: 1034, z: 2836 };
  return a[strHash(key) % a.length];
}

/** Open water near a point, for boat objectives. */
export function waterNear(x: number, z: number, maxBlocks = 8): { x: number; z: number } | null {
  const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
  for (let r = 1; r <= maxBlocks; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        // Far enough from the quay to be clear of piers, near enough to see from land.
        if (!isLand(districtOfBlock(bx + dx, bz + dz)) && districtOfBlock(bx + dx, bz + dz) === 'water') {
          return { x: (bx + dx + 0.5) * BLOCK, z: (bz + dz + 0.5) * BLOCK };
        }
      }
    }
  }
  return null;
}

export interface MissionTarget { x: number; z: number; radius: number; label: string; kind: 'goal' | 'pickup' | 'person' }
export interface MissionOffer { id: string; title: string; summary: string; x: number; z: number; story: boolean; giver: string; kind: string }
export interface MissionActor { character: string; x: number; z: number; heading: number }

interface Active {
  id: string;
  title: string;
  def: MissionDef;
  story: boolean;
  step: number;
  /** Step-local state, rebuilt whenever a step starts or restarts. */
  goal: { x: number; z: number } | null;
  pickups: { x: number; z: number; taken: boolean }[];
  timeLeft: number;
  elapsed: number;
  vehicleId: number;
  wantedSeen: boolean;
  line: number;
  lineTimer: number;
  talking: boolean;
  failTimer: number;
  failReason: string;
}

export interface MissionSnapshot {
  active: { id: string; step: number } | null;
  sideDone: string[];
  storyDone: number;
  failures: number;
  narrative: ReturnType<NarrativeState['snapshot']>;
}

export interface MissionWorld {
  player(): { x: number; z: number; vehicle: Vehicle | null; speed: number; interact: boolean };
  /** Narrative-relevant facts the story reads from play. */
  isAlive(character: string): boolean;
}

/**
 * Story and side missions.
 *
 * A mission is data: an ordered list of steps (go, drive, steal, deliver, evade, collect, wait,
 * talk, sail). Each step is a checkpoint — failing restarts that step, not the mission. Finishing
 * a story mission pays out and then puts the node's decision to the player; the choice applies
 * its effects to the narrative state and moves the story to the next node.
 */
export class MissionSystem {
  readonly story: NarrativeState;
  active: Active | null = null;
  /** A decision waiting for the player (after a story mission, or a pure decision node). */
  pendingDecision: GraphNode | null = null;
  sideDone = new Set<string>();
  storyDone = 0;
  failures = 0;
  dialogue: { speaker: string; text: string; index: number; total: number } | null = null;
  endingReached: EndingDef | null = null;
  /** Suppresses the "walk to the marker" requirement (dev commands and tests). */
  private offerCache: MissionOffer[] | null = null;

  constructor(private bus: EventBus, private economy: Economy, private wanted: WantedSystem, private world: MissionWorld) {
    this.story = new NarrativeState(GRAPH, REGISTRY);
    bus.on('player.busted', () => { if (this.active) this.fail('You were arrested.'); });
    bus.on('vehicle.destroyed', (e) => { if (this.active && this.active.vehicleId === e.vehicleId && this.step()?.type === 'deliver_vehicle') this.fail('The vehicle was destroyed.'); });
    this.syncDecision();
  }

  // ── what is on offer ────────────────────────────────────────────────────

  /** Missions that can be started now, with where their giver waits. */
  offers(): MissionOffer[] {
    if (this.offerCache) return this.offerCache;
    const out: MissionOffer[] = [];
    if (!this.active && !this.pendingDecision && !this.endingReached) {
      const n = this.story.getNode();
      if (n.type === 'mission' && n.mission) {
        const a = anchorFor(n.mission.startDistrict, 'start:' + n.id);
        out.push({ id: n.id, title: n.title, summary: n.summary, x: a.x + 9, z: a.z + 9, story: true, giver: n.mission.giver, kind: n.mission.kind });
      }
      for (const s of SIDE_MISSIONS) {
        if (this.sideDone.has(s.id) && !s.repeatable) continue;
        if (!this.world.isAlive(s.mission.giver)) continue;
        const a = anchorFor(s.mission.startDistrict, 'side:' + s.id);
        out.push({ id: s.id, title: s.title, summary: s.summary, x: a.x - 9, z: a.z + 9, story: false, giver: s.mission.giver, kind: s.mission.kind });
      }
    }
    this.offerCache = out;
    return out;
  }

  nearestOffer(x: number, z: number, radius = 6): MissionOffer | null {
    let best: MissionOffer | null = null, bd = radius;
    for (const o of this.offers()) { const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  start(id: string): boolean {
    if (this.active || this.pendingDecision) return false;
    const node = this.story.getNode();
    let def: MissionDef | undefined, title = '', story = false;
    if (node.id === id && node.mission) { def = node.mission; title = node.title; story = true; }
    else { const s = SIDE_MISSIONS.find((m) => m.id === id); if (s) { def = s.mission; title = s.title; } }
    if (!def) return false;
    this.active = { id, title, def, story, step: 0, goal: null, pickups: [], timeLeft: 0, elapsed: 0, vehicleId: 0, wantedSeen: false, line: 0, lineTimer: 0, talking: false, failTimer: 0, failReason: '' };
    this.offerCache = null;
    this.bus.emit('mission.started', { id });
    this.bus.emit('notify', { text: title, kind: 'info' });
    this.beginStep();
    return true;
  }

  step(): MissionStep | null {
    return this.active ? this.active.def.steps[this.active.step] ?? null : null;
  }

  // ── steps ───────────────────────────────────────────────────────────────

  private beginStep(): void {
    const a = this.active!;
    const s = a.def.steps[a.step];
    const p = this.world.player();
    const key = `${a.id}:${a.step}`;
    a.goal = null; a.pickups = []; a.timeLeft = 0; a.elapsed = 0; a.wantedSeen = false; a.line = 0; a.lineTimer = 0; a.talking = false; a.failTimer = 0;
    this.dialogue = null;
    switch (s.type) {
      case 'goto': case 'drive_to': case 'deliver_vehicle': a.goal = anchorFor(s.district, key); break;
      case 'timed_drive': {
        a.goal = anchorFor(s.district, key);
        // The authored time is a floor; long routes get enough time to be drivable.
        a.timeLeft = Math.max(s.seconds, Math.hypot(a.goal.x - p.x, a.goal.z - p.z) / 11 + 25);
        break;
      }
      case 'boat_to': { const g = anchorFor(s.district, key); a.goal = waterNear(g.x, g.z) ?? g; break; }
      case 'collect': {
        const c = anchorFor(s.district, key);
        for (let i = 0; i < s.count; i++) {
          const ang = hash2(strHash(key), i, 5) * Math.PI * 2;
          // Along the streets that meet at the anchor, so every pickup is reachable.
          const along = 22 + hash2(strHash(key), i, 6) * 38;
          const dir = Math.floor(hash2(strHash(key), i, 7) * 4);
          a.pickups.push({ x: c.x + [0, 1, 0, -1][dir] * along + Math.sin(ang) * 2, z: c.z + [-1, 0, 1, 0][dir] * along + Math.cos(ang) * 2, taken: false });
        }
        break;
      }
      case 'wait': a.goal = { x: p.x, z: p.z }; a.timeLeft = s.seconds; break;
      case 'talk': {
        // The character waits a few steps from where the previous objective ended.
        const ang = hash2(strHash(key), 1, 3) * Math.PI * 2;
        a.goal = { x: p.x + Math.sin(ang) * 7, z: p.z + Math.cos(ang) * 7 };
        break;
      }
      case 'evade_police': this.wanted.raise(s.stars, p.x, p.z); break;
      case 'steal_vehicle': break;
    }
    if (s.type === 'deliver_vehicle') a.vehicleId = p.vehicle?.id ?? 0;
    this.bus.emit('mission.step', { id: a.id, step: a.step, label: s.label });
  }

  private advance(): void {
    const a = this.active!;
    this.dialogue = null;
    a.step++;
    if (a.step >= a.def.steps.length) this.complete();
    else this.beginStep();
  }

  private complete(): void {
    const a = this.active!;
    this.active = null;
    this.offerCache = null;
    this.economy.earn(a.def.rewardCash, `mission:${a.id}`);
    this.bus.emit('mission.completed', { id: a.id, reward: a.def.rewardCash });
    this.bus.emit('notify', { text: `${a.title} — complete. $${a.def.rewardCash.toLocaleString('en-US')}`, kind: 'good' });
    if (a.story) { this.storyDone++; this.pendingDecision = this.story.getNode(); }
    else this.sideDone.add(a.id);
  }

  private fail(reason: string): void {
    const a = this.active;
    if (!a || a.failTimer > 0) return;
    a.failTimer = 3;
    a.failReason = reason;
    this.failures++;
    this.dialogue = null;
    this.bus.emit('mission.failed', { id: a.id, reason });
    this.bus.emit('notify', { text: `${reason} Restarting from the last checkpoint.`, kind: 'bad' });
  }

  /** Abandon the current mission; a story mission can be picked up again from its giver. */
  abandon(): void {
    this.active = null;
    this.dialogue = null;
    this.offerCache = null;
  }

  update(dt: number): void {
    const a = this.active;
    if (!a) {
      // Walking up to a giver and pressing interact starts the mission.
      const p = this.world.player();
      if (p.interact && !this.pendingDecision) { const o = this.nearestOffer(p.x, p.z); if (o) this.start(o.id); }
      return;
    }
    if (a.failTimer > 0) {
      a.failTimer -= dt;
      if (a.failTimer <= 0) this.beginStep();
      return;
    }
    const s = a.def.steps[a.step];
    const p = this.world.player();
    const near = (r: number) => !!a.goal && Math.hypot(a.goal.x - p.x, a.goal.z - p.z) < r;
    a.elapsed += dt;
    switch (s.type) {
      case 'goto': if (near(8)) this.advance(); break;
      case 'drive_to': if (near(11) && p.vehicle && !p.vehicle.isBoat) this.advance(); break;
      case 'timed_drive':
        a.timeLeft -= dt;
        if (near(11) && p.vehicle) this.advance();
        else if (a.timeLeft <= 0) this.fail('Out of time.');
        break;
      case 'boat_to': if (near(40) && (p.vehicle?.isBoat || a.goal === null)) this.advance(); break;
      case 'steal_vehicle':
        if (p.vehicle && p.vehicle.owner !== 'player' && (!s.vehicleClass || p.vehicle.profile.class === s.vehicleClass)) this.advance();
        break;
      case 'deliver_vehicle': {
        if (!a.vehicleId && p.vehicle) a.vehicleId = p.vehicle.id;
        const v = p.vehicle;
        if (v && s.maxDamage !== undefined && v.health < 100 - s.maxDamage) this.fail('The vehicle is too badly damaged.');
        else if (v && near(11) && Math.abs(v.speed) < 4) this.advance();
        break;
      }
      case 'evade_police':
        if (this.wanted.level > 0) a.wantedSeen = true;
        else if (a.wantedSeen || a.elapsed > 1) this.advance();
        break;
      case 'collect': {
        let left = 0;
        for (const k of a.pickups) {
          if (!k.taken && Math.hypot(k.x - p.x, k.z - p.z) < 3.2) { k.taken = true; this.bus.emit('notify', { text: 'Collected.', kind: 'good' }); }
          if (!k.taken) left++;
        }
        if (!left) this.advance();
        break;
      }
      case 'wait':
        if (near(35)) a.timeLeft -= dt;
        if (a.timeLeft <= 0) this.advance();
        break;
      case 'talk': {
        if (!a.talking) { if (near(4) && p.speed < 3) { a.talking = true; a.lineTimer = 0; } break; }
        a.lineTimer -= dt;
        if (a.lineTimer <= 0 || (p.interact && a.lineTimer < 2.2)) {
          if (a.line >= s.lines.length) { this.advance(); break; }
          const raw = s.lines[a.line];
          const cut = raw.indexOf(': ');
          this.dialogue = { speaker: cut > 0 ? raw.slice(0, cut) : '', text: cut > 0 ? raw.slice(cut + 2) : raw, index: a.line, total: s.lines.length };
          a.line++;
          a.lineTimer = 2.6 + raw.length * 0.035;
        }
        break;
      }
    }
  }

  // ── what the HUD and the world need to show ─────────────────────────────

  objective(): string | null {
    const a = this.active;
    if (!a) return null;
    if (a.failTimer > 0) return a.failReason;
    const s = a.def.steps[a.step];
    let extra = '';
    if (s.type === 'timed_drive' || s.type === 'wait') extra = `  ·  ${Math.max(0, Math.ceil(a.timeLeft))}s`;
    if (s.type === 'collect') extra = `  ·  ${a.pickups.filter((k) => k.taken).length}/${a.pickups.length}`;
    if (s.type === 'evade_police' && this.wanted.level > 0) extra = this.wanted.seen ? '  ·  in sight' : '  ·  out of sight';
    return s.label + extra;
  }

  targets(): MissionTarget[] {
    const a = this.active;
    if (!a || a.failTimer > 0) return [];
    const s = a.def.steps[a.step];
    if (s.type === 'collect') return a.pickups.filter((k) => !k.taken).map((k) => ({ x: k.x, z: k.z, radius: 3, label: s.label, kind: 'pickup' as const }));
    if (!a.goal) return [];
    return [{ x: a.goal.x, z: a.goal.z, radius: s.type === 'boat_to' ? 40 : s.type === 'wait' ? 35 : 9, label: s.label, kind: s.type === 'talk' ? 'person' : 'goal' }];
  }

  actors(): MissionActor[] {
    const a = this.active;
    const s = this.step();
    if (!a || !s || s.type !== 'talk' || !a.goal) return [];
    const p = this.world.player();
    return [{ character: s.character, x: a.goal.x, z: a.goal.z, heading: Math.atan2(p.x - a.goal.x, p.z - a.goal.z) }];
  }

  // ── decisions and endings ───────────────────────────────────────────────

  private syncDecision(): void {
    const n = this.story.getNode();
    this.pendingDecision = null;
    this.offerCache = null;
    if (n.type === 'finale') {
      const id = this.story.ending ?? this.story.selectEnding().id;
      this.story.ending = id;
      this.endingReached = REGISTRY.endings.find((e) => e.id === id) ?? null;
      this.bus.emit('narrative.ending', { ending: id });
    } else if (n.type === 'decision') this.pendingDecision = n;
  }

  decide(choiceId: string): void {
    const node = this.story.getNode();
    this.story.choose(choiceId);
    this.bus.emit('narrative.choice', { node: node.id, choice: choiceId });
    this.syncDecision();
  }

  /** Dev command and tests: play a recorded path of choices from the beginning. */
  replay(choiceIds: string[]): void {
    this.active = null;
    this.dialogue = null;
    this.endingReached = null;
    this.story.replay(choiceIds);
    this.syncDecision();
  }

  snapshot(): MissionSnapshot {
    return {
      active: this.active ? { id: this.active.id, step: this.active.step } : null,
      sideDone: [...this.sideDone], storyDone: this.storyDone, failures: this.failures,
      narrative: this.story.snapshot(),
    };
  }

  restore(s: MissionSnapshot): void {
    this.active = null;
    this.dialogue = null;
    this.endingReached = null;
    this.story.restore(s.narrative);
    this.sideDone = new Set(s.sideDone);
    this.storyDone = s.storyDone;
    this.failures = s.failures;
    this.syncDecision();
    if (s.active && this.start(s.active.id)) {
      // Resume at the saved checkpoint.
      this.active!.step = Math.min(s.active.step, this.active!.def.steps.length - 1);
      this.beginStep();
    }
  }
}
