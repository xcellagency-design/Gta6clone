import { conditionRefs, NarrativeState } from './NarrativeState';
import type { Condition, DecisionGraph, EndingRegistry } from './types';

export interface ReachabilityReport {
  errors: string[];
  warnings: string[];
  statesExplored: number;
  totalPaths: number;
  /** endingId -> one valid list of choice ids that reaches it. */
  witness: Record<string, string[]>;
  /** endingId -> number of complete decision paths that end there. */
  pathCounts: Record<string, number>;
  nodesVisited: number;
  longestPath: number;
  shortestPath: number;
}

const MAX_STATES = 4_000_000;

function structuralChecks(graph: DecisionGraph, registry: EndingRegistry, errors: string[], warnings: string[]): void {
  const nodeIds = new Set<string>();
  const choiceIds = new Set<string>();
  const varIds = new Set(graph.variables.map((v) => v.id));
  const flagIds = new Set(graph.flags.map((f) => f.id));

  const checkCond = (c: Condition, where: string) => {
    const refs = conditionRefs(c);
    for (const v of refs.vars) if (!varIds.has(v)) errors.push(`${where}: unknown variable "${v}"`);
    for (const f of refs.flags) if (!flagIds.has(f)) errors.push(`${where}: unknown flag "${f}"`);
  };

  for (const v of graph.variables) {
    if (v.initial < v.min || v.initial > v.max) errors.push(`variable ${v.id}: initial outside its range`);
  }
  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    nodeIds.add(n.id);
  }
  if (!nodeIds.has(graph.start)) errors.push(`start node "${graph.start}" does not exist`);
  if (!graph.nodes.some((n) => n.type === 'finale')) errors.push('graph has no finale node');

  for (const n of graph.nodes) {
    if (n.type === 'finale') {
      if (n.choices.length) errors.push(`finale node ${n.id} must have no choices`);
      continue;
    }
    if (!n.choices.length) errors.push(`node ${n.id} has no choices`);
    for (const c of n.choices) {
      if (choiceIds.has(c.id)) errors.push(`duplicate choice id "${c.id}"`);
      choiceIds.add(c.id);
      if (c.requires) checkCond(c.requires, `choice ${c.id} requires`);
      for (const e of c.effects) {
        if ('flag' in e) {
          if (!flagIds.has(e.flag)) errors.push(`choice ${c.id}: effect on unknown flag "${e.flag}"`);
        } else if (!varIds.has(e.var)) errors.push(`choice ${c.id}: effect on unknown variable "${e.var}"`);
      }
      const targets = typeof c.next === 'string' ? [{ goto: c.next } as { if?: Condition; goto: string }] : c.next;
      if (!targets.length) errors.push(`choice ${c.id} has no next node`);
      targets.forEach((b, i) => {
        if (!nodeIds.has(b.goto)) errors.push(`choice ${c.id}: next node "${b.goto}" does not exist`);
        if (b.if) checkCond(b.if, `choice ${c.id} branch ${i}`);
        else if (i !== targets.length - 1) errors.push(`choice ${c.id}: only the last branch may omit "if"`);
      });
      if (Array.isArray(c.next) && c.next[c.next.length - 1]?.if) {
        errors.push(`choice ${c.id}: the last branch must be an unconditional default`);
      }
    }
  }

  const endingIds = new Set<string>();
  const seenReq = new Map<string, string>();
  const seenSeq = new Map<string, string>();
  const seenCine = new Map<string, string>();
  for (const e of registry.endings) {
    if (endingIds.has(e.id)) errors.push(`duplicate ending id "${e.id}"`);
    endingIds.add(e.id);
    checkCond(e.requirements, `ending ${e.id}`);
    const req = JSON.stringify(e.requirements);
    if (seenReq.has(req)) errors.push(`endings ${seenReq.get(req)} and ${e.id} have identical requirements`);
    seenReq.set(req, e.id);
    if (seenSeq.has(e.finalSequence.id)) {
      errors.push(`endings ${seenSeq.get(e.finalSequence.id)} and ${e.id} share final sequence "${e.finalSequence.id}"`);
    }
    seenSeq.set(e.finalSequence.id, e.id);
    const cine = [e.cinematic.district, e.cinematic.timeOfDay, e.cinematic.weather, e.cinematic.camera].join('|');
    if (seenCine.has(cine)) warnings.push(`endings ${seenCine.get(cine)} and ${e.id} share the same cinematic staging`);
    seenCine.set(cine, e.id);
    if (!e.cinematic.shots.length) errors.push(`ending ${e.id} has no cinematic shots`);
    if (!Object.keys(e.characterOutcomes).length) errors.push(`ending ${e.id} has no character outcomes`);
    if (!e.consequences.length) errors.push(`ending ${e.id} has no consequences`);
  }
  if (!endingIds.has(registry.fallback)) errors.push(`fallback ending "${registry.fallback}" does not exist`);
}

/**
 * Walk every reachable (node, state) pair of the decision graph, memoised, and record which
 * endings can be reached, how many complete paths lead to each, and one witness path per ending.
 */
export function analyseReachability(graph: DecisionGraph, registry: EndingRegistry): ReachabilityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  structuralChecks(graph, registry, errors, warnings);
  const report: ReachabilityReport = {
    errors,
    warnings,
    statesExplored: 0,
    totalPaths: 0,
    witness: {},
    pathCounts: {},
    nodesVisited: 0,
    longestPath: 0,
    shortestPath: Infinity,
  };
  if (errors.length) return report;

  const ns = new NarrativeState(graph, registry);
  const varOrder = graph.variables.map((v) => v.id);
  const flagOrder = graph.flags.map((f) => f.id);
  const keyOf = () =>
    ns.node + '#' + varOrder.map((v) => ns.vars[v]).join(',') + '#' + flagOrder.map((f) => (ns.flags[f] ? 1 : 0)).join('');

  // memo: state key -> endingId -> number of paths from this state to that ending
  const memo = new Map<string, Map<string, number>>();
  const visitedNodes = new Set<string>();
  const path: string[] = [];
  let overflow = false;

  const visit = (): Map<string, number> => {
    const key = keyOf();
    const hit = memo.get(key);
    if (hit) return hit;
    if (memo.size >= MAX_STATES) {
      overflow = true;
      return new Map();
    }
    const node = ns.getNode();
    visitedNodes.add(node.id);
    const result = new Map<string, number>();
    if (node.type === 'finale') {
      const ending = ns.selectEnding().id;
      result.set(ending, 1);
      if (!report.witness[ending] || path.length < report.witness[ending].length) report.witness[ending] = [...path];
      report.longestPath = Math.max(report.longestPath, path.length);
      report.shortestPath = Math.min(report.shortestPath, path.length);
      memo.set(key, result);
      return result;
    }
    const choices = ns.availableChoices(node);
    if (!choices.length) {
      errors.push(`dead end: no choice available at node ${node.id} after [${path.join(', ')}]`);
      memo.set(key, result);
      return result;
    }
    const saved = ns.snapshot();
    for (const c of choices) {
      ns.applyEffects(c.effects);
      ns.node = ns.resolveNext(c);
      path.push(c.id);
      const sub = visit();
      path.pop();
      for (const [e, n] of sub) result.set(e, (result.get(e) ?? 0) + n);
      ns.restore(saved);
    }
    memo.set(key, result);
    return result;
  };

  const totals = visit();
  if (overflow) errors.push(`state space exceeds ${MAX_STATES} states; coarsen variable effects`);
  report.statesExplored = memo.size;
  report.nodesVisited = visitedNodes.size;
  for (const [e, n] of totals) {
    report.pathCounts[e] = n;
    report.totalPaths += n;
  }
  for (const n of graph.nodes) if (!visitedNodes.has(n.id)) warnings.push(`node ${n.id} is never reached`);
  for (const e of registry.endings) {
    if (!report.pathCounts[e.id]) errors.push(`ending ${e.id} (${e.name}) is unreachable`);
  }
  return report;
}
