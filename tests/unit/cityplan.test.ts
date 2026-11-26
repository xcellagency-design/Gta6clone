import { describe, expect, it } from 'vitest';
import {
  BLOCK, BLOCKS_X, BLOCKS_Z, CELLS_X, CELLS_Z, DISTRICT_MAP, DISTRICTS, districtAnchors, districtAt, districtOfCell, edgeClass,
  isLandAt, nearestRoadPoint, nodeInfo, RoadClass, signalState, SPAWN, type DistrictId,
} from '../../src/world/CityPlan';
import { allPois } from '../../src/world/Pois';

const MISSION_DISTRICTS: DistrictId[] = ['downtown', 'flats', 'crownshore', 'port', 'beach', 'paseo', 'cypress', 'saltgrass', 'marina', 'neonmile', 'eastbank'];

describe('city plan', () => {
  it('has a well-formed district map containing all twelve districts', () => {
    expect(DISTRICT_MAP.length).toBe(CELLS_Z);
    for (const row of DISTRICT_MAP) expect(row.length).toBe(CELLS_X);
    const seen = new Set<string>();
    for (let cz = 0; cz < CELLS_Z; cz++) for (let cx = 0; cx < CELLS_X; cx++) seen.add(districtOfCell(cx, cz));
    for (const d of [...MISSION_DISTRICTS, 'causeway', 'water']) expect(seen.has(d)).toBe(true);
    for (const d of seen) expect(DISTRICTS[d as DistrictId].name.length).toBeGreaterThan(2);
  });

  it('starts the player on land beside a road', () => {
    expect(isLandAt(SPAWN.x, SPAWN.z)).toBe(true);
    expect(districtAt(SPAWN.x, SPAWN.z)).toBe('port');
    const r = nearestRoadPoint(SPAWN.x, SPAWN.z)!;
    expect(Math.hypot(r.x - SPAWN.x, r.z - SPAWN.z)).toBeLessThan(60);
  });

  it('has highways, arterials and streets', () => {
    const counts = [0, 0, 0, 0];
    for (let k = 0; k <= BLOCKS_X; k++) for (let i = 0; i < BLOCKS_Z; i++) counts[edgeClass(true, k, i)]++;
    for (let k = 0; k <= BLOCKS_Z; k++) for (let i = 0; i < BLOCKS_X; i++) counts[edgeClass(false, k, i)]++;
    expect(counts[RoadClass.Highway]).toBeGreaterThan(80);
    expect(counts[RoadClass.Arterial]).toBeGreaterThan(150);
    expect(counts[RoadClass.Street]).toBeGreaterThan(600);
  });

  it('connects every district by road, including the island over the causeway', () => {
    // Flood fill the lattice graph from the intersection nearest the spawn.
    const key = (x: number, z: number) => x * 1000 + z;
    const start = [Math.round(SPAWN.x / BLOCK), Math.round(SPAWN.z / BLOCK)];
    const seen = new Set<number>([key(start[0], start[1])]);
    const queue = [start];
    while (queue.length) {
      const [kx, kz] = queue.pop()!;
      const n = nodeInfo(kx, kz);
      const next: [number, number, number][] = [[kx, kz - 1, n.arms[0]], [kx + 1, kz, n.arms[1]], [kx, kz + 1, n.arms[2]], [kx - 1, kz, n.arms[3]]];
      for (const [x, z, cls] of next) {
        if (!cls || x < 0 || z < 0 || x > BLOCKS_X || z > BLOCKS_Z || seen.has(key(x, z))) continue;
        seen.add(key(x, z));
        queue.push([x, z]);
      }
    }
    expect(seen.size).toBeGreaterThan(700);
    for (const d of MISSION_DISTRICTS) {
      const anchors = districtAnchors(d);
      expect(anchors.length, `anchors in ${d}`).toBeGreaterThan(0);
      const reachable = anchors.filter((a) => seen.has(key(a.x / BLOCK, a.z / BLOCK)));
      expect(reachable.length, `reachable anchors in ${d}`).toBeGreaterThan(0);
    }
  });

  it('signals alternate and never show green both ways', () => {
    let ns = 0, ew = 0;
    for (let t = 0; t < 72; t += 0.5) {
      const s = signalState(16, 16, t);
      expect(s.nsGreen && s.ewGreen).toBe(false);
      if (s.nsGreen) ns++;
      if (s.ewGreen) ew++;
    }
    expect(ns).toBeGreaterThan(20);
    expect(ew).toBeGreaterThan(20);
  });

  it('places every kind of interactive location', () => {
    const pois = allPois();
    expect(pois.length).toBeGreaterThan(120);
    const types = new Set(pois.map((p) => p.type));
    for (const t of ['safehouse', 'shop', 'restaurant', 'garage', 'clothing', 'dealership', 'business', 'fuel', 'venue']) expect(types.has(t as never), t).toBe(true);
    expect(new Set(pois.map((p) => p.id)).size).toBe(pois.length);
    for (const p of pois) expect(isLandAt(p.x, p.z)).toBe(true);
  });
});
