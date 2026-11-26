import type { Weather } from '../environment/Environment';
import type { GameApp } from '../main';
import { ENDING_PATHS, REGISTRY } from '../missions/MissionSystem';
import { el } from '../ui/dom';
import { VEHICLE_PROFILES } from '../vehicles/VehicleProfile';
import { districtAnchors, DISTRICTS, type DistrictId } from '../world/CityPlan';

type Cmd = (...args: string[]) => unknown;

/**
 * Developer console (` key) and the command table behind window.__undertow.commands.
 * This is how streaming, weather, the wanted system and all twenty endings are exercised
 * on demand.
 */
export function installConsole(app: GameApp, commands: Record<string, Cmd>): void {
  const sim = app.sim;
  const help: Record<string, string> = {};
  const def = (name: string, usage: string, fn: Cmd) => { commands[name] = fn; help[name] = usage; };

  def('help', 'help — list commands', () => Object.values(help).join('\n'));
  def('tp', 'tp <x> <z> | tp <district> — teleport', async (a, b) => {
    if (a in DISTRICTS) { const p = districtAnchors(a as DistrictId)[0]; await sim.teleport(p.x + 6, p.z + 6); return `at ${DISTRICTS[a as DistrictId].name}`; }
    await sim.teleport(Number(a), Number(b));
    return `at ${a}, ${b}`;
  });
  def('time', 'time <hour> — set the clock', (h) => { sim.env.hour = Math.max(0, Math.min(23.99, Number(h))); return sim.env.clock(); });
  def('weather', 'weather <clear|cloudy|rain|storm|fog>', (w) => { sim.env.setWeather(w as Weather, true); return sim.env.weather; });
  def('cash', 'cash <amount> — add money', (n) => { sim.economy.earn(Number(n) || 0, 'dev'); return sim.economy.cash; });
  def('wanted', 'wanted <0-5> — set the wanted level', (n) => { const l = Number(n); if (l <= 0) sim.wanted.clearByPayment(); else sim.wanted.raise(l, sim.player.x, sim.player.z); return sim.wanted.level; });
  def('spawn', `spawn <${VEHICLE_PROFILES.map((p) => p.id).join('|')}> — a vehicle beside you`, (id) => {
    const h = sim.player.heading;
    const v = sim.vehicles.spawn(id || 'sedan', sim.player.x + Math.cos(h) * 3.5, id === 'boat' ? -0.6 : 0.2, sim.player.z - Math.sin(h) * 3.5, h);
    v.owner = 'player';
    sim.vehicles.persistent.add(v);
    return v.profile.name;
  });
  def('story', 'story — current node, variables and flags', () => JSON.stringify({ node: sim.missions.story.node, vars: sim.missions.story.vars, flags: sim.missions.story.flags, history: sim.missions.story.history }, null, 1));
  def('decide', 'decide <choiceId> — take a story decision', (id) => { sim.missions.decide(id); return sim.missions.story.node; });
  def('skip', 'skip — complete the active mission step', () => { const m = sim.missions as unknown as { advance(): void }; if (sim.missions.active) m.advance(); return sim.missions.objective() ?? 'no mission'; });
  def('ending', 'ending <1-20> — replay the decisions that lead to an ending and play it', (n) => {
    const id = 'ENDING_' + String(Number(n)).padStart(2, '0');
    const path = ENDING_PATHS[id];
    if (!path) return `unknown ending ${n}`;
    sim.missions.replay(path);
    return `${id}: ${REGISTRY.endings.find((e) => e.id === id)?.name} (${path.length} decisions replayed)`;
  });
  def('endings', 'endings — list all twenty', () => REGISTRY.endings.map((e) => `${e.id}  ${e.name}`).join('\n'));
  def('stream', 'stream — toggle the streaming overlay', () => { app.overlay.toggle(); return app.overlay.visible; });
  def('save', 'save <slot1|slot2|slot3|auto>', (slot) => app.saveGame((slot || 'slot1') as never));
  def('load', 'load <slot>', (slot) => app.loadGame((slot || 'slot1') as never));

  const out = el('div', { style: 'white-space:pre-wrap;max-height:40vh;overflow:auto;margin-bottom:6px' } as never);
  const input = el('input', { style: 'width:100%;font:inherit;background:#000;color:#cfe3d4;border:1px solid var(--line);padding:4px 6px', spellcheck: false } as never);
  const box = el('div.debug.hidden', out, input);
  box.style.cssText += ';left:12px;right:auto;top:auto;bottom:12px;width:min(640px,90vw);pointer-events:auto';
  app.ui.append(box);
  const print = (t: string) => { out.textContent = (out.textContent + '\n' + t).split('\n').slice(-40).join('\n'); out.scrollTop = out.scrollHeight; };
  print('UNDERTOW developer console. Type "help".');
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === '`') { e.preventDefault(); box.classList.add('hidden'); return; }
    if (e.key !== 'Enter') return;
    const [name, ...args] = input.value.trim().split(/\s+/);
    input.value = '';
    if (!name) return;
    print('> ' + [name, ...args].join(' '));
    const fn = commands[name];
    if (!fn) { print('unknown command'); return; }
    try { print(String(await fn(...args))); } catch (err) { print('error: ' + (err as Error).message); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote') return;
    e.preventDefault();
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) { document.exitPointerLock?.(); input.focus(); }
  });
}
