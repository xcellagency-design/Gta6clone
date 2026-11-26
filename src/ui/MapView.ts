import type { GameSim } from '../core/GameSim';
import type { PoiType } from '../streaming/CellData';
import {
  BLOCK, BLOCKS_X, BLOCKS_Z, CELL, CELLS_X, CELLS_Z, districtOfCell, DISTRICTS, edgeClass, RoadClass, roadWidth,
} from '../world/CityPlan';
import { allPois } from '../world/Pois';

export const POI_COLOR: Record<PoiType, string> = {
  safehouse: '#7ad98b', shop: '#e9e2d0', restaurant: '#ffb347', garage: '#9fb4c8', clothing: '#e79fb3', dealership: '#5fa8d3',
  business: '#c9a0ff', fuel: '#ff7a5a', venue: '#ff5fb8',
};

let base: HTMLCanvasElement | null = null;
const BASE_SCALE = 0.25; // pixels per metre

/** The whole city drawn once: districts, water and the road network. */
function baseMap(): HTMLCanvasElement {
  if (base) return base;
  base = document.createElement('canvas');
  base.width = CELLS_X * CELL * BASE_SCALE;
  base.height = CELLS_Z * CELL * BASE_SCALE;
  const g = base.getContext('2d')!;
  const s = BASE_SCALE;
  for (let cz = 0; cz < CELLS_Z; cz++) {
    for (let cx = 0; cx < CELLS_X; cx++) {
      const d = districtOfCell(cx, cz);
      g.fillStyle = d === 'water' || d === 'causeway' ? '#153746' : mixHex(DISTRICTS[d].color, '#1a1f24', 0.62);
      g.fillRect(cx * CELL * s, cz * CELL * s, CELL * s + 0.5, CELL * s + 0.5);
    }
  }
  const stroke = (cls: number) => (cls === RoadClass.Highway ? '#e8c46a' : cls === RoadClass.Arterial ? '#cfd3d6' : '#7d858c');
  for (const pass of [RoadClass.Street, RoadClass.Arterial, RoadClass.Highway]) {
    for (let k = 0; k <= BLOCKS_X; k++) {
      for (let i = 0; i < BLOCKS_Z; i++) {
        const c = edgeClass(true, k, i);
        if (c !== pass) continue;
        g.fillStyle = stroke(c);
        const w = Math.max(1, roadWidth(c) * s * 0.55);
        g.fillRect(k * BLOCK * s - w / 2, i * BLOCK * s, w, BLOCK * s + 0.5);
      }
    }
    for (let k = 0; k <= BLOCKS_Z; k++) {
      for (let i = 0; i < BLOCKS_X; i++) {
        const c = edgeClass(false, k, i);
        if (c !== pass) continue;
        g.fillStyle = stroke(c);
        const w = Math.max(1, roadWidth(c) * s * 0.55);
        g.fillRect(i * BLOCK * s, k * BLOCK * s - w / 2, BLOCK * s + 0.5, w);
      }
    }
  }
  return base;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export interface MapOptions {
  /** World point at the centre of the view, and pixels per metre. */
  cx: number; cz: number; scale: number;
  pois: boolean;
  labels: boolean;
}

/** Draws the map with everything the player knows: where they are, objectives, the search area. */
export function drawMap(canvas: HTMLCanvasElement, sim: GameSim, o: MapOptions): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#0d2530';
  g.fillRect(0, 0, W, H);
  const X = (x: number) => W / 2 + (x - o.cx) * o.scale;
  const Z = (z: number) => H / 2 + (z - o.cz) * o.scale;
  const b = baseMap();
  g.imageSmoothingEnabled = true;
  g.drawImage(b, X(0), Z(0), (b.width / BASE_SCALE) * o.scale, (b.height / BASE_SCALE) * o.scale);

  if (o.labels) {
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'center';
    const seen = new Map<string, { x: number; z: number; n: number }>();
    for (let cz = 0; cz < CELLS_Z; cz++) for (let cx = 0; cx < CELLS_X; cx++) {
      const d = districtOfCell(cx, cz);
      if (d === 'water' || d === 'causeway') continue;
      const e = seen.get(d) ?? { x: 0, z: 0, n: 0 };
      e.x += (cx + 0.5) * CELL; e.z += (cz + 0.5) * CELL; e.n++;
      seen.set(d, e);
    }
    for (const [d, e] of seen) {
      g.fillStyle = 'rgba(255,255,255,0.78)';
      g.fillText(DISTRICTS[d as keyof typeof DISTRICTS].name.toUpperCase(), X(e.x / e.n), Z(e.z / e.n));
    }
  }
  if (o.pois) {
    for (const p of allPois()) {
      const x = X(p.x), z = Z(p.z);
      if (x < -4 || z < -4 || x > W + 4 || z > H + 4) continue;
      g.fillStyle = POI_COLOR[p.type];
      g.globalAlpha = sim.economy.owns(p.id) || p.name === 'Navarro Salvage' ? 1 : 0.8;
      g.fillRect(x - 2, z - 2, 4, 4);
      if (sim.economy.owns(p.id)) { g.strokeStyle = '#fff'; g.strokeRect(x - 3.5, z - 3.5, 7, 7); }
    }
    g.globalAlpha = 1;
  }
  // Police search area: what they believe, drawn where they believe it.
  const w = sim.wanted;
  if (w.level > 0 && w.lastKnown) {
    g.beginPath();
    g.arc(X(w.lastKnown.x), Z(w.lastKnown.z), Math.max(6, (w.state === 'search' ? w.searchRadius : 40) * o.scale), 0, Math.PI * 2);
    g.fillStyle = w.state === 'pursuit' ? 'rgba(255,60,60,0.28)' : 'rgba(80,140,255,0.22)';
    g.fill();
    g.strokeStyle = w.state === 'pursuit' ? '#ff5a4f' : '#6aa0ff';
    g.stroke();
  }
  for (const c of sim.traffic.cars) {
    if (!c.police) continue;
    g.fillStyle = c.siren ? '#ff5a4f' : '#6aa0ff';
    g.fillRect(X(c.x) - 2, Z(c.z) - 2, 4, 4);
  }
  for (const off of sim.missions.offers()) {
    g.fillStyle = off.story ? '#ffd54a' : '#5fe0ff';
    g.beginPath(); g.arc(X(off.x), Z(off.z), off.story ? 5 : 3.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#000'; g.stroke();
  }
  for (const t of sim.missions.targets()) {
    const x = Math.max(8, Math.min(W - 8, X(t.x))), z = Math.max(8, Math.min(H - 8, Z(t.z)));
    g.fillStyle = '#ffd54a';
    g.beginPath(); g.moveTo(x, z - 7); g.lineTo(x + 6, z); g.lineTo(x, z + 7); g.lineTo(x - 6, z); g.closePath(); g.fill();
    g.strokeStyle = '#000'; g.stroke();
  }
  // The player.
  const p = sim.player;
  g.save();
  g.translate(X(p.x), Z(p.z));
  g.rotate(Math.PI - p.heading);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#000';
  g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
