import data from '../../data/narrative/characters.json';
import type { CharacterPose } from '../render/CharacterRenderer';
import { anchorFor } from '../missions/MissionSystem';
import { districtAt } from '../world/CityPlan';

interface ScheduleEntry { from: number; to: number; district: string; activity: string }

export interface CharacterDef {
  id: string;
  name: string;
  role: string;
  faction: string;
  occupation: string;
  personality: string;
  homeDistrict: string;
  schedule: ScheduleEntry[];
  relationships: Record<string, string>;
  reactions: { onCrimeWitnessed: string; onPlayerApproach: string };
}

export interface CharacterMemory { day: number; hour: number; event: string }

export const CHARACTERS = (data as unknown as { characters: CharacterDef[] }).characters;

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const SKIN = [0xf1c9a5, 0xd9a47c, 0xb98a66, 0x8d5a3b, 0x6a4530];
const SHIRT = [0x7a1f1f, 0x1f3a5a, 0x2f4f3f, 0xd9c7a0, 0x3a3a3d, 0x5a3b6a, 0xb5651d, 0xe9e6df];

export interface CharacterInstance { def: CharacterDef; x: number; z: number; heading: number; activity: string; district: string }

/**
 * The named cast. Unlike ambient pedestrians they persist: each has a daily schedule that
 * places them somewhere in the city at any hour, and each remembers what the player has done
 * with or to them. Memories are saved with the game.
 */
export class Characters {
  readonly memories = new Map<string, CharacterMemory[]>();
  private cache: { key: string; list: CharacterInstance[] } = { key: '', list: [] };

  constructor(private env: { hour: number; day: number }, private isAlive: (id: string) => boolean) {}

  get(id: string): CharacterDef | undefined {
    return CHARACTERS.find((c) => c.id === id);
  }

  /** Where the schedule puts a character at a given hour. */
  scheduled(def: CharacterDef, hour: number): ScheduleEntry {
    for (const e of def.schedule) {
      const inRange = e.from <= e.to ? hour >= e.from && hour < e.to : hour >= e.from || hour < e.to;
      if (inRange) return e;
    }
    return def.schedule[0] ?? { from: 0, to: 24, district: def.homeDistrict, activity: 'at home' };
  }

  /** Everyone (alive, and not the protagonist) with where they are right now. */
  whereabouts(): CharacterInstance[] {
    const key = `${Math.floor(this.env.hour * 2)}|${this.env.day}`;
    if (this.cache.key === key) return this.cache.list;
    const list: CharacterInstance[] = [];
    for (const def of CHARACTERS) {
      if (def.id === 'cass' || !this.isAlive(def.id)) continue;
      const e = this.scheduled(def, this.env.hour);
      const a = anchorFor(e.district, 'char:' + def.id);
      const h = strHash(def.id);
      // On the sidewalk at a corner of their block.
      list.push({ def, x: a.x + ((h & 1) ? 11 : -11), z: a.z + ((h & 2) ? 11 : -11), heading: (h % 628) / 100, activity: e.activity, district: e.district });
    }
    this.cache = { key, list };
    return list;
  }

  /** Characters close enough to matter to the player right now. */
  nearby(x: number, z: number, radius: number): CharacterInstance[] {
    return this.whereabouts().filter((c) => Math.hypot(c.x - x, c.z - z) < radius);
  }

  remember(id: string, event: string): void {
    let m = this.memories.get(id);
    if (!m) this.memories.set(id, (m = []));
    m.push({ day: this.env.day, hour: Math.round(this.env.hour * 10) / 10, event });
    if (m.length > 24) m.shift();
  }

  /** What a character says when the player walks up, coloured by what they remember. */
  greet(id: string): { name: string; line: string; activity: string } | null {
    const inst = this.whereabouts().find((c) => c.def.id === id);
    if (!inst) return null;
    const mem = this.memories.get(id) ?? [];
    const last = mem[mem.length - 1];
    let line = inst.def.reactions.onPlayerApproach;
    if (last && last.event.startsWith('choice:')) line += ` (Remembers: ${last.event.slice(7)}.)`;
    else if (mem.length >= 3) line += ' (You have talked before — more than once.)';
    this.remember(id, 'spoke with Cass');
    return { name: inst.def.name, line, activity: inst.activity };
  }

  poses(add: (p: CharacterPose) => void, x: number, z: number, radius: number, time: number): void {
    for (const c of this.nearby(x, z, radius)) {
      const h = strHash(c.def.id);
      const toPlayer = Math.hypot(c.x - x, c.z - z) < 6;
      add({
        x: c.x, y: 0.15, z: c.z, heading: toPlayer ? Math.atan2(x - c.x, z - c.z) : c.heading, stride: time, speed: 0,
        anim: toPlayer ? 'talk' : (h >> 3) % 3 === 0 ? 'phone' : 'stand', shirt: SHIRT[h % SHIRT.length], pants: 0x23262b, skin: SKIN[(h >> 4) % SKIN.length], scale: 1.02,
      });
    }
  }

  /** Whether the district the player is standing in currently hosts this character. */
  inDistrict(id: string, x: number, z: number): boolean {
    const inst = this.whereabouts().find((c) => c.def.id === id);
    return !!inst && inst.district === districtAt(x, z);
  }

  snapshot(): Record<string, CharacterMemory[]> {
    return Object.fromEntries([...this.memories].map(([k, v]) => [k, v.map((m) => ({ ...m }))]));
  }

  restore(s: Record<string, CharacterMemory[]>): void {
    this.memories.clear();
    for (const [k, v] of Object.entries(s)) this.memories.set(k, v.map((m) => ({ ...m })));
    this.cache.key = '';
  }
}
