import type { GameSim } from '../core/GameSim';
import type { EconomySnapshot } from '../economy/Economy';
import type { Weather } from '../environment/Environment';
import type { MissionSnapshot } from '../missions/MissionSystem';
import type { CharacterMemory } from '../npc/Characters';
import type { WantedSnapshot } from '../police/WantedSystem';
import type { SavedVehicle } from '../vehicles/VehicleManager';
import { districtAt, DISTRICTS } from '../world/CityPlan';
import type { SaveMeta } from './SaveSystem';

/** Everything that defines a playthrough. The static world is not saved: it is regenerated. */
export interface GameSave {
  player: { x: number; y: number; z: number; heading: number; stamina: number; fed: number };
  playtime: number;
  env: { hour: number; day: number; weather: Weather; wetness: number; minutesLeft: number };
  economy: EconomySnapshot;
  vehicles: { vehicles: SavedVehicle[]; stored: SavedVehicle[]; player: number };
  missions: MissionSnapshot;
  wanted: WantedSnapshot;
  characters: Record<string, CharacterMemory[]>;
}

export function captureState(sim: GameSim): GameSave {
  const p = sim.player;
  return {
    player: { x: p.x, y: p.y, z: p.z, heading: p.heading, stamina: p.stamina, fed: p.fed },
    playtime: sim.time,
    env: sim.env.snapshot(),
    economy: sim.economy.snapshot(),
    vehicles: sim.vehicles.snapshot(),
    missions: sim.missions.snapshot(),
    wanted: sim.wanted.snapshot(),
    characters: sim.characters.snapshot(),
  };
}

export function saveMeta(sim: GameSim): Omit<SaveMeta, 'slot' | 'savedAt'> {
  return {
    playtime: sim.time,
    district: DISTRICTS[districtAt(sim.player.x, sim.player.z)].name,
    cash: sim.economy.cash,
    storyNode: sim.missions.story.getNode().title,
    day: sim.env.day,
    clock: sim.env.clock(),
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural validation of loaded data. Returns a description of the first problem, or null. */
export function validateSave(d: unknown): string | null {
  const s = d as Partial<GameSave> | null;
  if (!s || typeof s !== 'object') return 'not an object';
  if (!s.player || !num(s.player.x) || !num(s.player.z) || !num(s.player.heading)) return 'bad player position';
  if (!num(s.playtime)) return 'bad playtime';
  if (!s.env || !num(s.env.hour) || s.env.hour < 0 || s.env.hour >= 24 || !num(s.env.day)) return 'bad clock';
  if (!s.economy || !num(s.economy.cash) || s.economy.cash < 0 || !Array.isArray(s.economy.properties)) return 'bad economy';
  if (!s.vehicles || !Array.isArray(s.vehicles.vehicles) || !Array.isArray(s.vehicles.stored)) return 'bad vehicles';
  if (!s.missions || !s.missions.narrative || typeof s.missions.narrative.node !== 'string' || !Array.isArray(s.missions.narrative.history)) return 'bad story state';
  if (!s.wanted || !num(s.wanted.notoriety)) return 'bad police record';
  if (!s.characters || typeof s.characters !== 'object') return 'bad character memory';
  return null;
}

/** Puts a loaded save into the running game. The world around the player streams in first. */
export async function applyState(sim: GameSim, s: GameSave): Promise<void> {
  const cur = sim.vehicles.playerVehicle;
  if (cur) { cur.occupied = false; sim.vehicles.playerVehicle = null; sim.player.exitVehicle(sim.player.x, 0.3, sim.player.z, 0); }
  sim.time = s.playtime;
  sim.env.restore(s.env);
  sim.economy.restore(s.economy);
  sim.wanted.restore(s.wanted);
  sim.characters.restore(s.characters);
  sim.missions.restore(s.missions);
  sim.player.stamina = s.player.stamina;
  sim.player.fed = s.player.fed;
  sim.lastVehicle = null;
  await sim.teleport(s.player.x, s.player.z, s.player.heading);
  const driven = sim.vehicles.restore(s.vehicles);
  if (driven) {
    driven.occupied = true;
    sim.vehicles.playerVehicle = driven;
    sim.player.enterVehicle(driven.id);
    sim.camera.snapBehind(driven.heading());
  }
}
