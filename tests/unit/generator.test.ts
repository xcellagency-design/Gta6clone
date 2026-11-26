import { describe, expect, it } from 'vitest';
import { generateCell } from '../../src/streaming/CellGenerator';
import { cellTransferables, COLLIDER_STRIDE, type CellData, type MeshData } from '../../src/streaming/CellData';
import { CELLS_X, CELLS_Z, districtOfCell, SPAWN } from '../../src/world/CityPlan';

const SEED = 1234;
const verts = (m: MeshData | null) => (m ? m.positions.length / 3 : 0);
const total = (c: CellData) => verts(c.solid) + verts(c.flat);

function finite(m: MeshData | null): boolean {
  if (!m) return true;
  for (const a of [m.positions, m.normals, m.uvs, m.colors, m.params]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  const n = m.positions.length / 3;
  for (let i = 0; i < m.indices.length; i++) if (m.indices[i] >= n) return false;
  return m.normals.length === n * 3 && m.uvs.length === n * 2 && m.colors.length === n * 3 && m.params.length === n * 4;
}

describe('cell generator', () => {
  it('is deterministic', () => {
    const a = generateCell(12, 8, 0, SEED), b = generateCell(12, 8, 0, SEED);
    expect(a.solid!.positions).toEqual(b.solid!.positions);
    expect(a.colliders).toEqual(b.colliders);
    expect(a.parking).toEqual(b.parking);
    const c = generateCell(12, 8, 0, SEED + 1);
    expect(c.solid!.positions).not.toEqual(a.solid!.positions);
  });

  it('generates every cell of the map at every LOD with valid buffers', () => {
    let worst = 0, sum = 0, n = 0;
    const districtBuildings: Record<string, number> = {};
    for (let cz = 0; cz < CELLS_Z; cz++) {
      for (let cx = 0; cx < CELLS_X; cx++) {
        const cells = [0, 1, 2, 3].map((lod) => generateCell(cx, cz, lod, SEED));
        for (const c of cells) {
          expect(finite(c.solid) && finite(c.flat), `cell ${cx},${cz} lod ${c.lod}`).toBe(true);
          expect(c.bytes).toBeGreaterThan(0);
        }
        // Coarser LODs never cost more than finer ones.
        expect(total(cells[1])).toBeLessThanOrEqual(total(cells[0]));
        expect(total(cells[2])).toBeLessThanOrEqual(total(cells[1]));
        expect(total(cells[3])).toBeLessThanOrEqual(total(cells[2]));
        // Collision, parking and pedestrian data exist only at full detail.
        expect(cells[1].colliders.length + cells[2].colliders.length + cells[3].colliders.length).toBe(0);
        expect(cells[1].parking.length).toBe(0);
        expect(cells[0].colliders.length % COLLIDER_STRIDE).toBe(0);
        // A far cell is a single mesh.
        expect(cells[3].flat).toBeNull();
        worst = Math.max(worst, cells[0].generationMs);
        sum += cells[0].generationMs; n++;
        const d = districtOfCell(cx, cz);
        districtBuildings[d] = (districtBuildings[d] ?? 0) + cells[0].buildingCount;
      }
    }
    for (const d of ['downtown', 'flats', 'crownshore', 'port', 'beach', 'paseo', 'cypress', 'marina', 'neonmile', 'eastbank', 'saltgrass']) {
      expect(districtBuildings[d], `buildings in ${d}`).toBeGreaterThan(0);
    }
    expect(districtBuildings.water ?? 0).toBe(0);
    // Performance budget from docs/GAME_ARCHITECTURE.md §12.
    expect(sum / n).toBeLessThan(20);
    expect(worst).toBeLessThan(250);
  });

  it('gives land cells ground collision and water cells none', () => {
    const land = generateCell(12, 8, 0, SEED);
    expect(land.colliders.length / COLLIDER_STRIDE).toBeGreaterThan(8);
    const sea = generateCell(21, 18, 0, SEED);
    expect(sea.colliders.length).toBe(0);
    expect(sea.solid).toBeNull();
    const bridge = generateCell(20, 9, 0, SEED);
    expect(bridge.district).toBe('causeway');
    expect(bridge.colliders.length / COLLIDER_STRIDE).toBeGreaterThanOrEqual(3);
  });

  it('produces transferable buffers for the worker hand-off', () => {
    const c = generateCell(10, 7, 0, SEED);
    const t = cellTransferables(c);
    expect(t.length).toBeGreaterThan(10);
    expect(new Set(t).size).toBe(t.length);
  });

  it('keeps the spawn yard clear', () => {
    const c = generateCell(5, 14, 0, SEED);
    const sx = SPAWN.x, sz = SPAWN.z;
    for (let o = 0; o < c.colliders.length; o += COLLIDER_STRIDE) {
      const [x, y, z, hx, hy, hz] = [c.colliders[o], c.colliders[o + 1], c.colliders[o + 2], c.colliders[o + 3], c.colliders[o + 4], c.colliders[o + 5]];
      if (y + hy <= 0.2) continue; // ground and kerb slabs
      const inside = Math.abs(sx - x) < hx + 2.5 && Math.abs(sz - z) < hz + 2.5;
      expect(inside, `collider at ${x.toFixed(0)},${z.toFixed(0)} blocks the spawn`).toBe(false);
    }
    expect(c.pois.some((p) => p.name === 'Navarro Salvage')).toBe(true);
  });
});

describe('level-of-detail consistency', () => {
  it('shows the same buildings at every LOD (tallest roofline matches)', () => {
    const top = (c: CellData) => {
      let m = 0;
      const p = c.solid?.positions;
      if (p) for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i]);
      return m;
    };
    for (const [cx, cz] of [[12, 8], [13, 7], [11, 9], [16, 7], [18, 9], [10, 5], [15, 4], [22, 6]]) {
      const tops = [0, 1, 2].map((lod) => top(generateCell(cx, cz, lod, SEED)));
      // Roof clutter and masts add a little at LOD 0; the massing itself must agree.
      expect(Math.abs(tops[1] - tops[2]), `cell ${cx},${cz}`).toBeLessThan(1.2);
      expect(tops[0]).toBeGreaterThanOrEqual(tops[1] - 0.01);
      expect(tops[0] - tops[1]).toBeLessThan(35);
    }
  });
});
