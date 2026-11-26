/**
 * Save slots with validation and recovery.
 *
 * Each slot holds a JSON envelope { version, checksum, meta, data }. Before a slot is
 * overwritten its previous contents are copied to a backup key; loading falls back to the backup
 * when the main copy is missing, truncated, tampered with or from an unknown version.
 */

export const SAVE_VERSION = 1;
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOTS)[number];

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

export interface SaveMeta {
  slot: SlotId;
  savedAt: number;
  playtime: number;
  district: string;
  cash: number;
  storyNode: string;
  day: number;
  clock: string;
}

interface Envelope<T> { version: number; checksum: string; meta: SaveMeta; data: T }

export type LoadResult<T> =
  | { ok: true; data: T; meta: SaveMeta; recovered: boolean }
  | { ok: false; reason: string };

/** FNV-1a, enough to detect truncation and corruption. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const key = (slot: string) => `undertow.save.${slot}`;

export class SaveSystem<T> {
  constructor(private store: KeyValueStore, private validate: (data: unknown) => string | null) {}

  write(slot: SlotId, data: T, meta: Omit<SaveMeta, 'slot' | 'savedAt'>): boolean {
    const body = JSON.stringify(data);
    const env: Envelope<T> = { version: SAVE_VERSION, checksum: checksum(body), meta: { ...meta, slot, savedAt: Date.now() }, data };
    try {
      const prev = this.store.getItem(key(slot));
      if (prev && this.parse(prev).ok) this.store.setItem(key(slot) + '.bak', prev);
      this.store.setItem(key(slot), JSON.stringify(env));
      return true;
    } catch {
      return false; // storage full or unavailable
    }
  }

  private parse(text: string): LoadResult<T> {
    let env: Envelope<T>;
    try { env = JSON.parse(text); } catch { return { ok: false, reason: 'not valid JSON' }; }
    if (!env || typeof env !== 'object' || !('data' in env)) return { ok: false, reason: 'missing data' };
    if (env.version !== SAVE_VERSION) return { ok: false, reason: `unsupported version ${env.version}` };
    if (checksum(JSON.stringify(env.data)) !== env.checksum) return { ok: false, reason: 'checksum mismatch' };
    const problem = this.validate(env.data);
    if (problem) return { ok: false, reason: problem };
    return { ok: true, data: env.data, meta: env.meta, recovered: false };
  }

  load(slot: SlotId): LoadResult<T> {
    const main = this.store.getItem(key(slot));
    const first: LoadResult<T> = main ? this.parse(main) : { ok: false, reason: 'empty slot' };
    if (first.ok) return first;
    const bak = this.store.getItem(key(slot) + '.bak');
    if (bak) {
      const second = this.parse(bak);
      if (second.ok) return { ...second, recovered: true };
    }
    return first;
  }

  list(): (SaveMeta | null)[] {
    return SLOTS.map((s) => { const r = this.load(s); return r.ok ? r.meta : null; });
  }

  latest(): SlotId | null {
    let best: SaveMeta | null = null;
    for (const m of this.list()) if (m && (!best || m.savedAt > best.savedAt)) best = m;
    return best ? best.slot : null;
  }
}
