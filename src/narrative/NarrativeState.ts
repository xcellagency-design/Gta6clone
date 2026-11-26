import type {
  Choice,
  Condition,
  DecisionGraph,
  Effect,
  EndingDef,
  EndingRegistry,
  GraphNode,
  NarrativeSnapshot,
} from './types';

export function evalCondition(c: Condition, vars: Record<string, number>, flags: Record<string, boolean>): boolean {
  if ('all' in c) return c.all.every((x) => evalCondition(x, vars, flags));
  if ('any' in c) return c.any.some((x) => evalCondition(x, vars, flags));
  if ('not' in c) return !evalCondition(c.not, vars, flags);
  if ('const' in c) return c.const;
  if ('flag' in c) return (flags[c.flag] ?? false) === (c.is ?? true);
  const v = vars[c.var] ?? 0;
  if (c.gte !== undefined && !(v >= c.gte)) return false;
  if (c.lte !== undefined && !(v <= c.lte)) return false;
  if (c.gt !== undefined && !(v > c.gt)) return false;
  if (c.lt !== undefined && !(v < c.lt)) return false;
  if (c.eq !== undefined && !(v === c.eq)) return false;
  return true;
}

/** Names of the variables and flags a condition reads. */
export function conditionRefs(c: Condition, out = { vars: new Set<string>(), flags: new Set<string>() }) {
  if ('all' in c) c.all.forEach((x) => conditionRefs(x, out));
  else if ('any' in c) c.any.forEach((x) => conditionRefs(x, out));
  else if ('not' in c) conditionRefs(c.not, out);
  else if ('flag' in c) out.flags.add(c.flag);
  else if ('var' in c) out.vars.add(c.var);
  return out;
}

/**
 * The story so far: where the player is in the decision graph, the tracked variables and flags,
 * and the choices taken. Deterministic: the same choices always give the same state and ending.
 */
export class NarrativeState {
  readonly graph: DecisionGraph;
  readonly registry: EndingRegistry;
  private readonly nodes = new Map<string, GraphNode>();
  private readonly ranges = new Map<string, { min: number; max: number }>();
  private readonly sortedEndings: EndingDef[];

  node: string;
  vars: Record<string, number> = {};
  flags: Record<string, boolean> = {};
  history: string[] = [];
  ending: string | null = null;

  constructor(graph: DecisionGraph, registry: EndingRegistry) {
    this.graph = graph;
    this.registry = registry;
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    for (const v of graph.variables) this.ranges.set(v.id, { min: v.min, max: v.max });
    this.sortedEndings = [...registry.endings].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
    this.node = graph.start;
    this.reset();
  }

  reset(): void {
    this.node = this.graph.start;
    this.vars = {};
    this.flags = {};
    for (const v of this.graph.variables) this.vars[v.id] = v.initial;
    for (const f of this.graph.flags) this.flags[f.id] = f.initial;
    this.history = [];
    this.ending = null;
  }

  getNode(id: string = this.node): GraphNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown narrative node "${id}"`);
    return n;
  }

  check(c: Condition): boolean {
    return evalCondition(c, this.vars, this.flags);
  }

  availableChoices(node: GraphNode = this.getNode()): Choice[] {
    return node.choices.filter((c) => !c.requires || this.check(c.requires));
  }

  applyEffects(effects: Effect[]): void {
    for (const e of effects) {
      if ('flag' in e) {
        this.flags[e.flag] = e.set;
      } else {
        const r = this.ranges.get(e.var) ?? { min: -Infinity, max: Infinity };
        const cur = this.vars[e.var] ?? 0;
        const next = 'add' in e ? cur + e.add : e.set;
        this.vars[e.var] = Math.min(r.max, Math.max(r.min, next));
      }
    }
  }

  /** Adjust a variable from gameplay (cash earned, crimes witnessed…), clamped to its range. */
  adjust(variable: string, delta: number): void {
    this.applyEffects([{ var: variable, add: delta }]);
  }

  resolveNext(choice: Choice): string {
    if (typeof choice.next === 'string') return choice.next;
    for (const b of choice.next) if (!b.if || this.check(b.if)) return b.goto;
    throw new Error(`Choice "${choice.id}" has no matching branch`);
  }

  /** Take a choice at the current node. Returns the new node. Selects the ending at a finale. */
  choose(choiceId: string): GraphNode {
    const node = this.getNode();
    const choice = this.availableChoices(node).find((c) => c.id === choiceId);
    if (!choice) throw new Error(`Choice "${choiceId}" is not available at node "${node.id}"`);
    this.applyEffects(choice.effects);
    this.history.push(choice.id);
    this.node = this.resolveNext(choice);
    const next = this.getNode();
    if (next.type === 'finale') this.ending = this.selectEnding().id;
    return next;
  }

  atFinale(): boolean {
    return this.getNode().type === 'finale';
  }

  /** First ending, by priority, whose requirements hold; the registry's fallback otherwise. */
  selectEnding(): EndingDef {
    for (const e of this.sortedEndings) if (this.check(e.requirements)) return e;
    const fb = this.registry.endings.find((e) => e.id === this.registry.fallback);
    if (!fb) throw new Error('Ending registry has no fallback ending');
    return fb;
  }

  snapshot(): NarrativeSnapshot {
    return {
      node: this.node,
      vars: { ...this.vars },
      flags: { ...this.flags },
      history: [...this.history],
      ending: this.ending,
    };
  }

  restore(s: NarrativeSnapshot): void {
    this.getNode(s.node);
    this.reset();
    this.node = s.node;
    Object.assign(this.vars, s.vars);
    Object.assign(this.flags, s.flags);
    this.history = [...s.history];
    this.ending = s.ending;
  }

  /** Replay a list of choice ids from the start. Used by dev commands and tests. */
  replay(choiceIds: string[]): void {
    this.reset();
    for (const id of choiceIds) this.choose(id);
  }
}
