import { hash2 } from '../core/rng';

/**
 * The plan of Port Meridian: which district every cell belongs to, and the class of every road on
 * the 100 m lattice. Pure functions of coordinates, shared by the generator workers, the traffic
 * and pedestrian simulation, the minimap and the tests.
 *
 * World axes: +x east, +z south, y up. Lattice line k lies at 100·k metres.
 */

export const BLOCK = 100;
export const CELL = 200;
export const CELLS_X = 24;
export const CELLS_Z = 20;
export const BLOCKS_X = CELLS_X * 2;
export const BLOCKS_Z = CELLS_Z * 2;
export const WORLD_W = CELLS_X * CELL;
export const WORLD_D = CELLS_Z * CELL;

export type DistrictId =
  | 'water' | 'downtown' | 'flats' | 'crownshore' | 'port' | 'beach' | 'paseo'
  | 'cypress' | 'saltgrass' | 'marina' | 'neonmile' | 'eastbank' | 'causeway';

export const RoadClass = { None: 0, Street: 1, Arterial: 2, Highway: 3 } as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

export interface DistrictInfo {
  id: DistrictId;
  name: string;
  description: string;
  /** Pedestrians per cell at midday, before weather and time-of-day scaling. */
  pedDensity: number;
  /** Relative traffic demand. */
  trafficDensity: number;
  /** Minimap colour. */
  color: string;
}

export const DISTRICTS: Record<DistrictId, DistrictInfo> = {
  water: { id: 'water', name: 'Gulf of Meridian', description: 'Open water.', pedDensity: 0, trafficDensity: 0, color: '#1d4d63' },
  downtown: { id: 'downtown', name: 'Meridian Center', description: 'Glass towers of the financial district.', pedDensity: 10, trafficDensity: 1.0, color: '#8a94a6' },
  flats: { id: 'flats', name: 'The Flats', description: 'Dense walk-up blocks, corner stores and porches.', pedDensity: 8, trafficDensity: 0.7, color: '#b98f6b' },
  crownshore: { id: 'crownshore', name: 'Crown Shore', description: 'Condo towers and walled villas on the water.', pedDensity: 4, trafficDensity: 0.5, color: '#d9d2c0' },
  port: { id: 'port', name: 'Ironhook Port', description: 'Container yards, cranes and warehouses.', pedDensity: 2, trafficDensity: 0.5, color: '#6e7469' },
  beach: { id: 'beach', name: 'Sol Strand', description: 'A barrier island of sand, palms and hotels.', pedDensity: 7, trafficDensity: 0.4, color: '#e2cf9c' },
  paseo: { id: 'paseo', name: 'Paseo District', description: 'Malls, arcades and theatres.', pedDensity: 9, trafficDensity: 0.9, color: '#c79a7d' },
  cypress: { id: 'cypress', name: 'Cypress Heights', description: 'Lawns, cul-de-sacs and two-car garages.', pedDensity: 2, trafficDensity: 0.35, color: '#8fae7a' },
  saltgrass: { id: 'saltgrass', name: 'Saltgrass County', description: 'Fields, barns and two-lane county roads.', pedDensity: 0.3, trafficDensity: 0.15, color: '#7f9a5a' },
  marina: { id: 'marina', name: 'Pelican Marina', description: 'Slips, yacht clubs and chandlers.', pedDensity: 5, trafficDensity: 0.5, color: '#9fc2c9' },
  neonmile: { id: 'neonmile', name: 'Neon Mile', description: 'Clubs, bars and all-night diners.', pedDensity: 9, trafficDensity: 0.8, color: '#b0679a' },
  eastbank: { id: 'eastbank', name: 'Eastbank Rebuild Zone', description: 'Cranes, steel frames and fenced lots.', pedDensity: 2, trafficDensity: 0.4, color: '#b3a07a' },
  causeway: { id: 'causeway', name: 'Odile Causeway', description: 'The bridge to Sol Strand.', pedDensity: 0, trafficDensity: 0.6, color: '#1d4d63' },
};

const LEGEND: Record<string, DistrictId> = {
  '~': 'water', D: 'downtown', F: 'flats', C: 'crownshore', P: 'port', B: 'beach', S: 'paseo',
  Y: 'cypress', R: 'saltgrass', M: 'marina', N: 'neonmile', E: 'eastbank', '=': 'causeway',
};

/** One character per 200 m cell. Row 0 is the north edge. */
export const DISTRICT_MAP: readonly string[] = [
  'RRRRRRRRRRRRRRRRRR~~~~~~',
  'RRRRRRRRRRRRRRRRRR~~~~~~',
  'RRRRYYYYYYRRRRREEE~~~~~~',
  'RRYYYYYYYYYYRREEEE~~~~B~',
  'RRYYYYYYYYYFFFEEEE~~~~B~',
  'RRYYYYYYFFFFFFEEEE~~~~B~',
  'RRYYYYFFFFFFDDDDNN~~~~B~',
  'RRYYSSSFFFFDDDDDNN~~~~B~',
  'RRYYSSSSSDDDDDDDNNCC~~B~',
  'RRRYSSSSSDDDDDDDNNCC==B~',
  'RRRYYSSSSDDDDDDCCCCC~~B~',
  'RRRRYYSSFFFDDMMMCCC~~~B~',
  'RRRRRYFFFFFFMMMM~~~~~~B~',
  'RRRRRPPPPFFFMM~~~~~~~~~~',
  'RRRRPPPPPPP~~~~~~~~~~~~~',
  'RRRPPPPPPPP~~~~~~~~~~~~~',
  'RRRPPPPPP~~~~~~~~~~~~~~~',
  'RRR~~PPP~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~',
];

export function districtOfCell(cx: number, cz: number): DistrictId {
  if (cx >= 0 && cx < CELLS_X && cz >= 0 && cz < CELLS_Z) return LEGEND[DISTRICT_MAP[cz][cx]];
  // Beyond the map: open country to the north and west, open water to the south and east.
  if (cz >= CELLS_Z - 2 || cx >= CELLS_X - 6) return 'water';
  if (cz >= 17 && cx >= 3) return 'water';
  return 'saltgrass';
}

export function districtOfBlock(bx: number, bz: number): DistrictId {
  return districtOfCell(Math.floor(bx / 2), Math.floor(bz / 2));
}

export function districtAt(x: number, z: number): DistrictId {
  return districtOfCell(Math.floor(x / CELL), Math.floor(z / CELL));
}

export function isLand(d: DistrictId): boolean {
  return d !== 'water' && d !== 'causeway';
}

export function isLandAt(x: number, z: number): boolean {
  return isLand(districtAt(x, z));
}

/** Lattice lines of the causeway deck (z = 1900 m, from Crown Shore to Sol Strand). */
export const CAUSEWAY_KZ = 19;
const CAUSEWAY_X0 = 40;
const CAUSEWAY_X1 = 45;

function isHighway(vertical: boolean, k: number, i: number): boolean {
  if (vertical) {
    if (k === 8 && i >= -6 && i < 34) return true; // I-9, north-south spine
    if (k === 32 && i >= 4 && i < 22) return true; // east leg of the loop
    if (k === 28 && i >= 22 && i < 26) return true;
    return false;
  }
  if (k === 4 && i >= -6 && i < 32) return true; // north leg
  if (k === 26 && i >= -6 && i < 28) return true; // south leg
  if (k === 22 && i >= 28 && i < 32) return true;
  return false;
}

function wantsStreet(d: DistrictId, vertical: boolean, k: number): boolean {
  switch (d) {
    case 'downtown': case 'neonmile': case 'paseo': case 'flats': case 'crownshore': case 'marina': case 'eastbank':
      return true;
    case 'cypress':
      return vertical ? true : k % 2 === 0;
    case 'port':
      return k % 2 === 0;
    case 'beach':
      return vertical ? k === 45 : k % 2 === 0;
    case 'saltgrass':
      return k % 8 === 0;
    default:
      return false;
  }
}

function isUrban(d: DistrictId): boolean {
  return d !== 'water' && d !== 'causeway' && d !== 'saltgrass' && d !== 'beach';
}

/**
 * Class of the 100 m road segment on lattice line `k`, between intersections `i` and `i + 1`.
 * `vertical` segments run north-south (constant x = 100·k).
 */
export function edgeClass(vertical: boolean, k: number, i: number): RoadClass {
  let a = vertical ? districtOfBlock(k - 1, i) : districtOfBlock(i, k - 1);
  let b = vertical ? districtOfBlock(k, i) : districtOfBlock(i, k);
  if (!vertical && k === CAUSEWAY_KZ && i >= CAUSEWAY_X0 && i < CAUSEWAY_X1) return RoadClass.Arterial;
  if (a === 'causeway') a = 'water';
  if (b === 'causeway') b = 'water';
  if (a === 'water' && b === 'water') return RoadClass.None;
  if (isHighway(vertical, k, i)) return RoadClass.Highway;
  if (k % 4 === 0 && (isUrban(a) || isUrban(b))) return RoadClass.Arterial;
  if (wantsStreet(a, vertical, k) || wantsStreet(b, vertical, k)) return RoadClass.Street;
  return RoadClass.None;
}

/** Full paved width in metres, kerb to kerb. */
export function roadWidth(c: RoadClass): number {
  return c === RoadClass.Highway ? 26 : c === RoadClass.Arterial ? 17 : c === RoadClass.Street ? 10 : 0;
}

/** Driving lanes per direction. */
export function lanesPerDirection(c: RoadClass): number {
  return c === RoadClass.Highway ? 3 : c === RoadClass.Arterial ? 2 : c === RoadClass.Street ? 1 : 0;
}

export function speedLimit(c: RoadClass): number {
  return c === RoadClass.Highway ? 27 : c === RoadClass.Arterial ? 16 : 11;
}

export interface NodeInfo {
  /** Road classes of the four arms: north (−z), east (+x), south (+z), west (−x). */
  arms: [RoadClass, RoadClass, RoadClass, RoadClass];
  degree: number;
  signal: boolean;
  /** Half-size of the intersection box along x and z. */
  halfX: number;
  halfZ: number;
}

/** The intersection at lattice point (kx, kz). */
export function nodeInfo(kx: number, kz: number): NodeInfo {
  const n = edgeClass(true, kx, kz - 1);
  const s = edgeClass(true, kx, kz);
  const w = edgeClass(false, kz, kx - 1);
  const e = edgeClass(false, kz, kx);
  const arms: [RoadClass, RoadClass, RoadClass, RoadClass] = [n, e, s, w];
  const degree = arms.filter((c) => c > 0).length;
  const nsMax = Math.max(n, s) as RoadClass;
  const ewMax = Math.max(e, w) as RoadClass;
  const signal = degree >= 3 && nsMax >= RoadClass.Arterial && ewMax >= RoadClass.Arterial;
  return { arms, degree, signal, halfX: roadWidth(nsMax) / 2, halfZ: roadWidth(ewMax) / 2 };
}

/** Signal cycle shared by rendering and traffic. Phase 0: north-south green. Phase 1: east-west. */
export const SIGNAL_CYCLE = 36;
export function signalState(kx: number, kz: number, time: number): { nsGreen: boolean; ewGreen: boolean; yellow: boolean } {
  const offset = hash2(kx, kz, 77) * SIGNAL_CYCLE;
  const t = (((time + offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const half = SIGNAL_CYCLE / 2;
  const inPhase = t % half;
  const yellow = inPhase > half - 3.5;
  const allRed = inPhase > half - 1;
  const ns = t < half;
  return { nsGreen: ns && !allRed, ewGreen: !ns && !allRed, yellow: yellow && !allRed };
}

export function cellKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export function cellOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
}

/** Deterministic, well-spread road intersections inside a district, for mission markers. */
export function districtAnchors(d: DistrictId): { x: number; z: number }[] {
  const out: { x: number; z: number; h: number }[] = [];
  for (let cz = 0; cz < CELLS_Z; cz++) {
    for (let cx = 0; cx < CELLS_X; cx++) {
      if (districtOfCell(cx, cz) !== d) continue;
      // The intersection in the middle of the cell, if it is a real one.
      const kx = cx * 2 + 1;
      const kz = cz * 2 + 1;
      for (const [ax, az] of [[kx, kz], [cx * 2, cz * 2], [kx, cz * 2], [cx * 2, kz]] as const) {
        if (nodeInfo(ax, az).degree >= 2) {
          out.push({ x: ax * BLOCK, z: az * BLOCK, h: hash2(ax, az, 991) });
          break;
        }
      }
    }
  }
  out.sort((p, q) => p.h - q.h);
  return out.map(({ x, z }) => ({ x, z }));
}

/** Where a new game starts: Navarro Salvage, on the northern edge of Ironhook Port. */
export const SPAWN = { x: 1034, z: 2836, heading: -Math.PI / 2 };
/** The block that holds Navarro Salvage (generated as an open yard). */
export const SALVAGE_BLOCK = { bx: 10, bz: 28 };

/** Nearest point on a drivable road centre line, used for respawns and vehicle spawns. */
export function nearestRoadPoint(x: number, z: number): { x: number; z: number; vertical: boolean; cls: RoadClass } | null {
  let best: { x: number; z: number; vertical: boolean; cls: RoadClass } | null = null;
  let bestD = Infinity;
  const bx = Math.floor(x / BLOCK);
  const bz = Math.floor(z / BLOCK);
  for (let r = 0; r <= 4 && !best; r++) {
    for (let dz = -r; dz <= r + 1; dz++) {
      for (let dx = -r; dx <= r + 1; dx++) {
        const kx = bx + dx;
        const kz = bz + dz;
        const cv = edgeClass(true, kx, bz + Math.min(dz, r));
        if (cv > 0) {
          const pz = Math.min(Math.max(z, (bz + Math.min(dz, r)) * BLOCK + 14), (bz + Math.min(dz, r) + 1) * BLOCK - 14);
          const d = Math.hypot(kx * BLOCK - x, pz - z);
          if (d < bestD) { bestD = d; best = { x: kx * BLOCK, z: pz, vertical: true, cls: cv }; }
        }
        const ch = edgeClass(false, kz, bx + Math.min(dx, r));
        if (ch > 0) {
          const px = Math.min(Math.max(x, (bx + Math.min(dx, r)) * BLOCK + 14), (bx + Math.min(dx, r) + 1) * BLOCK - 14);
          const d = Math.hypot(px - x, kz * BLOCK - z);
          if (d < bestD) { bestD = d; best = { x: px, z: kz * BLOCK, vertical: false, cls: ch }; }
        }
      }
    }
  }
  return best;
}
