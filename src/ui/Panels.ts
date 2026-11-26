import type { GameSim } from '../core/GameSim';
import { POI_LABEL } from '../economy/Economy';
import { poiActions, useItem } from '../economy/Interactions';
import { GRAPH, REGISTRY } from '../missions/MissionSystem';
import type { EndingDef, GraphNode } from '../narrative/types';
import { CHARACTERS } from '../npc/Characters';
import type { SaveMeta, SlotId } from '../save/SaveSystem';
import { SLOTS } from '../save/SaveSystem';
import type { PoiDef } from '../streaming/CellData';
import { CELL, CELLS_X, CELLS_Z } from '../world/CityPlan';
import { el } from './dom';
import { drawMap, POI_COLOR } from './MapView';

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** What can be done at a shop, garage, safehouse… Buttons run real actions and report back. */
export function poiPanel(sim: GameSim, poi: PoiDef, close: () => void): HTMLElement {
  const panel = el('div.panel');
  const render = (feedback = '') => {
    panel.replaceChildren(
      el('h2', poi.name),
      el('h3', `${POI_LABEL[poi.type]}  ·  Cash ${money(sim.economy.cash)}`),
      ...poiActions(sim, poi).map((a) =>
        el('button', { disabled: !a.enabled, onclick: () => { const msg = a.run(); render(msg); } },
          a.cost > 0 ? `${a.label} — ${money(a.cost)}` : a.label, el('small', a.note))),
      el('div.fine', feedback),
      el('h3', ''),
      el('button', { onclick: close }, '← Leave'),
    );
  };
  render();
  return panel;
}

/** A story decision. Nothing happens until one is chosen; there is no default. */
export function decisionPanel(sim: GameSim, node: GraphNode, choose: (id: string) => void): HTMLElement {
  const choices = sim.missions.story.availableChoices(node);
  return el('div.panel',
    el('h3', `Act ${node.act}  ·  Decision`),
    el('h2', node.title),
    el('div.fine', { style: 'margin:0 0 14px;font-size:14px;color:var(--ink)' } as never, node.summary),
    ...choices.map((c) => el('button', { onclick: () => choose(c.id) }, c.label, c.description ? el('small', c.description) : null)),
  );
}

export function characterPanel(sim: GameSim, close: () => void, toast: (t: string) => void): HTMLElement {
  const panel = el('div.panel');
  const render = () => {
    const st = sim.missions.story;
    const inv = sim.economy.inventory;
    const rows: [string, string][] = [
      ['Cash', money(sim.economy.cash)],
      ['Business income', `${money(sim.economy.dailyIncome())} / day`],
      ['Properties', String(sim.economy.properties.size)],
      ['Story', `Act ${st.getNode().act} — ${st.getNode().title}`],
      ['Decisions made', String(st.history.length)],
      ['Notoriety (police record)', String(sim.wanted.notoriety)],
      ['Escapes / arrests', `${sim.wanted.escapes} / ${sim.wanted.busts}`],
      ['Missions done', `${sim.missions.storyDone} story, ${sim.missions.sideDone.size} side`],
    ];
    const standing = GRAPH.variables.map((v) => el('div.row', v.desc.split('.')[0].slice(0, 54), el('span', String(st.vars[v.id]))));
    const use = (item: Parameters<typeof useItem>[1], label: string, count: number) =>
      el('button', { disabled: count === 0, onclick: () => { const r = useItem(sim, item); toast(r || 'Nothing to use that on right now.'); render(); } }, `${label} × ${count}`, el('small', 'Use'));
    panel.replaceChildren(
      el('h2', 'Cass Navarro'),
      ...rows.map(([k, v]) => el('div.row', k, el('span', v))),
      el('h3', 'Inventory'),
      use('repairKit', 'Repair kit', inv.repairKits), use('fuelCan', 'Fuel can', inv.fuelCans), use('burnerPhone', 'Burner phone', inv.burnerPhones),
      el('h3', 'Standing'), ...standing,
      el('h3', 'People'),
      ...CHARACTERS.filter((c) => c.id !== 'cass').map((c) => {
        const alive = sim.isAlive(c.id);
        const where = sim.characters.whereabouts().find((w) => w.def.id === c.id);
        const mem = sim.characters.memories.get(c.id)?.length ?? 0;
        return el('div.row', `${c.name} — ${c.occupation}`, el('span', alive ? `${where ? where.activity : ''}${mem ? ` · ${mem} memories` : ''}` : 'dead'));
      }),
      el('h3', ''), el('button', { onclick: close }, '← Back'),
    );
  };
  render();
  return panel;
}

export function savePanel(metas: (SaveMeta | null)[], mode: 'load' | 'save', pick: (slot: SlotId) => void, close: () => void): HTMLElement {
  return el('div.panel',
    el('h2', mode === 'load' ? 'Load Game' : 'Save Game'),
    ...SLOTS.map((slot, i) => {
      const m = metas[i];
      const label = slot === 'auto' ? 'Autosave' : slot.replace('slot', 'Slot ');
      const detail = m ? `${m.storyNode} · ${m.district} · Day ${m.day}, ${m.clock} · ${money(m.cash)} · ${new Date(m.savedAt).toLocaleString()}` : 'Empty';
      return el('button', { disabled: mode === 'load' ? !m : slot === 'auto', onclick: () => pick(slot) }, label, el('small', detail));
    }),
    el('h3', ''), el('button', { onclick: close }, '← Back'),
  );
}

export function mapPanel(sim: GameSim, close: () => void): HTMLElement {
  const canvas = el('canvas', { width: 960, height: 800, style: 'display:block;max-width:100%;max-height:60vh;margin:0 auto;border:1px solid var(--line);border-radius:4px' } as never);
  drawMap(canvas, sim, { cx: (CELLS_X * CELL) / 2, cz: (CELLS_Z * CELL) / 2, scale: 960 / (CELLS_X * CELL), pois: true, labels: true });
  const legend = el('div.fine');
  legend.innerHTML = Object.entries(POI_COLOR).map(([k, v]) => `<span style="color:${v}">■</span> ${POI_LABEL[k as keyof typeof POI_LABEL]}`).join(' &nbsp; ')
    + ' &nbsp; <span style="color:#ffd54a">●</span> Story &nbsp; <span style="color:#5fe0ff">●</span> Side job &nbsp; <span style="color:#6aa0ff">◯</span> Police search';
  const panel = el('div.panel', el('h2', 'Port Meridian'), canvas, legend, el('h3', ''), el('button', { onclick: close }, '← Back'));
  panel.style.width = 'min(1020px, 96vw)';
  return panel;
}

/** The ending: its own staging, shot by shot, then what became of everyone. */
export function endingScreen(ending: EndingDef, found: number, done: () => void): HTMLElement {
  const root = el('div.screen.center');
  root.style.background = 'linear-gradient(180deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.25) 22%, rgba(0,0,0,0.25) 70%, rgba(0,0,0,0.94) 100%)';
  const caption = el('div', { style: 'position:absolute;left:8vw;right:8vw;bottom:9vh;font-size:clamp(18px,2.2vw,28px);line-height:1.4;text-align:center;text-shadow:0 2px 8px #000;transition:opacity .6s' } as never);
  const head = el('div', { style: 'position:absolute;top:5vh;left:0;right:0;text-align:center;letter-spacing:.3em;font-size:13px;color:var(--accent)' } as never, `ENDING ${Number(ending.id.slice(-2))} OF ${REGISTRY.endings.length}`);
  root.append(head, caption);
  let i = 0, timer = 0;
  const summary = () => {
    const panel = el('div.panel',
      el('h3', `${ending.id.replace('_', ' ')}  ·  ${ending.tone}`),
      el('h2', ending.name),
      el('div.fine', { style: 'font-size:14px;color:var(--ink);margin:0 0 6px' } as never, ending.summary),
      el('h3', 'What became of them'),
      ...Object.entries(ending.characterOutcomes).map(([id, text]) => el('div.fine', { style: 'margin:6px 0;font-size:13px;color:var(--ink)' } as never, el('b', (CHARACTERS.find((c) => c.id === id)?.name ?? id) + ': '), text)),
      el('h3', 'What it cost the city'),
      ...ending.consequences.map((c) => el('div.fine', { style: 'margin:4px 0;font-size:13px' } as never, '— ' + c)),
      el('h3', `Final sequence: ${ending.finalSequence.description.slice(0, 160)}`),
      el('div.fine', `Endings found: ${found} of ${REGISTRY.endings.length}`),
      el('button', { onclick: done }, 'Return to Main Menu'),
    );
    root.style.background = 'rgba(5,8,12,0.86)';
    root.replaceChildren(panel);
  };
  const next = () => {
    if (i >= ending.cinematic.shots.length) { summary(); return; }
    const shot = ending.cinematic.shots[i++];
    caption.style.opacity = '0';
    setTimeout(() => { caption.textContent = shot.text; caption.style.opacity = '1'; }, 350);
    timer = window.setTimeout(next, Math.max(2500, shot.duration * 1000));
  };
  root.addEventListener('click', () => { clearTimeout(timer); next(); });
  next();
  return root;
}
