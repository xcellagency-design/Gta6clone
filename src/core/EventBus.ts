/**
 * Decoupled messaging between systems. Missions, police, narrative, UI and audio react to what
 * happens in the world by subscribing here instead of calling each other.
 */
export interface GameEvents {
  'player.spawned': { x: number; z: number };
  'vehicle.entered': { vehicleId: number; stolen: boolean; profile: string };
  'vehicle.exited': { vehicleId: number };
  'vehicle.damaged': { vehicleId: number; amount: number; health: number };
  'vehicle.destroyed': { vehicleId: number };
  'cell.activated': { key: string; lod: number; latencyMs: number };
  'cell.unloaded': { key: string };
  'crime.committed': { type: string; x: number; z: number; severity: number };
  'crime.reported': { type: string; x: number; z: number; severity: number; by: string };
  'wanted.changed': { level: number; previous: number };
  'wanted.cleared': { reason: 'escaped' | 'busted' | 'paid' };
  'player.busted': { fine: number };
  'mission.started': { id: string };
  'mission.step': { id: string; step: number; label: string };
  'mission.completed': { id: string; reward: number };
  'mission.failed': { id: string; reason: string };
  'narrative.choice': { node: string; choice: string };
  'narrative.ending': { ending: string };
  'economy.cash': { amount: number; delta: number; reason: string };
  'economy.purchase': { item: string; cost: number };
  'npc.reaction': { npcId: number; reaction: string };
  'weather.changed': { weather: string };
  'save.written': { slot: string };
  'notify': { text: string; kind?: 'info' | 'good' | 'bad' };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>();
  /** Recent events, newest last. Used by tests and the dev console. */
  readonly log: { type: string; payload: unknown; t: number }[] = [];
  now = 0;

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    this.log.push({ type, payload, t: this.now });
    if (this.log.length > 400) this.log.splice(0, 100);
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }

  count(type: keyof GameEvents): number {
    let n = 0;
    for (const e of this.log) if (e.type === type) n++;
    return n;
  }
}
