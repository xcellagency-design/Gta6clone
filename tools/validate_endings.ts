/**
 * Validates the narrative data: structure, references, and that every ending is reachable
 * through a valid decision path. Writes one witness path per ending to
 * data/narrative/ending_paths.json (used by the in-game dev command `ending <n>`).
 *
 *   npm run validate:endings
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analyseReachability } from '../src/narrative/reachability';
import { NarrativeState } from '../src/narrative/NarrativeState';
import type { DecisionGraph, EndingRegistry } from '../src/narrative/types';

const root = new URL('../data/narrative/', import.meta.url);
const graph = JSON.parse(readFileSync(new URL('decision_graph.json', root), 'utf8')) as DecisionGraph;
const registry = JSON.parse(readFileSync(new URL('ending_registry.json', root), 'utf8')) as EndingRegistry;

const report = analyseReachability(graph, registry);

console.log(`nodes: ${graph.nodes.length} (${report.nodesVisited} reachable)   endings: ${registry.endings.length}`);
console.log(`states explored: ${report.statesExplored}   complete paths: ${report.totalPaths}`);
console.log(`decisions per playthrough: ${report.shortestPath}–${report.longestPath}`);
console.log('');
for (const e of [...registry.endings].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const n = report.pathCounts[e.id] ?? 0;
  const pct = report.totalPaths ? ((100 * n) / report.totalPaths).toFixed(2) : '0';
  console.log(`${n ? 'OK  ' : 'FAIL'} ${e.id}  ${e.name.padEnd(28)} priority ${String(e.priority).padStart(4)}  paths ${String(n).padStart(8)} (${pct}%)`);
}
for (const w of report.warnings) console.log(`warning: ${w}`);
for (const err of report.errors) console.error(`ERROR: ${err}`);

let ok = report.errors.length === 0;
if (registry.endings.length !== 20) {
  console.error(`ERROR: expected exactly 20 endings, found ${registry.endings.length}`);
  ok = false;
}

if (ok) {
  // Replay each witness independently to prove the stored path really selects that ending.
  for (const [ending, path] of Object.entries(report.witness)) {
    const ns = new NarrativeState(graph, registry);
    ns.replay(path);
    if (ns.ending !== ending) {
      console.error(`ERROR: witness for ${ending} replays to ${ns.ending}`);
      ok = false;
    }
  }
}
if (ok) {
  const sorted = Object.fromEntries(Object.entries(report.witness).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(new URL('ending_paths.json', root), JSON.stringify(sorted, null, 2) + '\n');
  console.log('\nAll 20 endings are reachable. Witness paths written to data/narrative/ending_paths.json');
}
process.exit(ok ? 0 : 1);
