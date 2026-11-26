import { hash2, Rng, seedFor } from '../core/rng';
import {
  BLOCK, CAUSEWAY_KZ, CELL, districtOfBlock, districtOfCell, edgeClass, isLand, nodeInfo, RoadClass, roadWidth,
  SALVAGE_BLOCK, type DistrictId,
} from '../world/CityPlan';
import { poiForBlock } from '../world/Pois';
import {
  cellBytes, type CellData, type InstanceData, type PoiDef, type PropKind,
} from './CellData';
import { hex, MeshBuilder, mix, PLAIN, shade, type Params, type RGB } from './MeshBuilder';
import { STYLE } from './styles';

/**
 * Procedural generation of one streaming cell at one level of detail.
 * A pure function of (seed, cx, cz, lod): it runs unchanged in a Web Worker, in Node tests and,
 * for the spawn area only, synchronously on the main thread.
 *
 * LOD 0  full massing, roof detail, props, colliders, parking and pedestrian data
 * LOD 1  full massing, trees and street lamps only
 * LOD 2  one volume per building, no props
 * LOD 3  merged proxies: tall buildings and one volume per low-rise block, main roads only
 */

const C = {
  asphalt: hex(0x2c2c30), concrete: hex(0x9a9a94), curb: hex(0x7d7d78), grass: hex(0x4f7a3a), dryGrass: hex(0x8a8f52),
  sand: hex(0xd9c592), dirt: hex(0x7a6247), lot: hex(0x3a3a3d), wood: hex(0x7b5a3c), pool: hex(0x2f9fc4),
  roofDark: hex(0x3b3d42), roofLight: hex(0xb9b6ad), roofTile: hex(0x9a4a35), steel: hex(0x5d6670), white: hex(0xe9e6df),
  rust: hex(0x7c4a2d), seawall: hex(0x6f6d68), field: hex(0x7d8c3f), fieldB: hex(0xa39a55), lamp: hex(0xffe2a8),
};

const PALETTE: Record<string, RGB[]> = {
  glass: [hex(0x5d7f96), hex(0x4a6b7d), hex(0x6f8f8a), hex(0x3f5566), hex(0x7b8fa3), hex(0x4f7480)],
  office: [hex(0xb7b2a6), hex(0x9c958a), hex(0xc8c1b3), hex(0x8a8f96), hex(0xa79f93)],
  brick: [hex(0x8f4f3c), hex(0xa0604a), hex(0x7a4636), hex(0xb08a6a), hex(0xc9b08e), hex(0x9c7b63)],
  stucco: [hex(0xe3c9a4), hex(0xd9a98a), hex(0xbfd2cf), hex(0xe9dcc0), hex(0xd8b7b0), hex(0xc7d6b8)],
  pastel: [hex(0xf2d7c4), hex(0xcfe6e0), hex(0xf5e6b8), hex(0xe7c7d6), hex(0xd6e2f2), hex(0xf7f1e6)],
  siding: [hex(0xe8e4da), hex(0xcdd7dc), hex(0xd9cfae), hex(0xb7c4b1), hex(0xe2c9b6), hex(0xc4b9a8)],
  metal: [hex(0x8d969c), hex(0x9aa39a), hex(0x7f8a94), hex(0xa7a59c), hex(0x6f7e88)],
  container: [hex(0xb0412e), hex(0x2f5f8a), hex(0x3e7a4d), hex(0xc98a2b), hex(0x7a7f85), hex(0x8a3f5a), hex(0x2f7f86)],
  neon: [hex(0xff3fa4), hex(0x35e0ff), hex(0xffc93a), hex(0x8dff5a), hex(0xb26bff), hex(0xff6a3a)],
  scrap: [hex(0x7c4a2d), hex(0x5f6468), hex(0x8a6f3f), hex(0x4f5a66), hex(0x93543a)],
};

interface Rect { x0: number; z0: number; x1: number; z1: number }

class Ctx {
  solid = new MeshBuilder();
  /** Roads and ground. At LOD 3 everything goes into one mesh, so a far cell is one draw call. */
  flat: MeshBuilder;
  colliders: number[] = [];
  parking: number[] = [];
  sidewalks: number[] = [];
  lamps: number[] = [];
  inst = new Map<PropKind, number[]>();
  pois: PoiDef[] = [];
  buildings = 0;
  constructor(readonly lod: number, readonly seed: number) {
    this.flat = lod >= 3 ? this.solid : new MeshBuilder();
  }

  prop(kind: PropKind, x: number, y: number, z: number, rot: number, scale: number, c: RGB = [1, 1, 1]): void {
    let a = this.inst.get(kind);
    if (!a) this.inst.set(kind, (a = []));
    a.push(x, y, z, rot, scale, c[0], c[1], c[2]);
  }

  collider(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
    if (this.lod !== 0) return;
    this.colliders.push((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0);
  }

  colliderRot(cx: number, cz: number, sx: number, sz: number, y0: number, y1: number, rot: number): void {
    if (this.lod !== 0) return;
    this.colliders.push(cx, (y0 + y1) / 2, cz, sx / 2, (y1 - y0) / 2, sz / 2, rot);
  }
}

function facade(style: number, seed: number, floorH: number, bayW: number): Params {
  return [style, seed, floorH, bayW];
}

/** A building volume with façade, roof and collider. */
function volume(ctx: Ctx, r: Rect, y0: number, y1: number, wall: RGB, wp: Params, roof: RGB = C.roofDark, vBase = 0): void {
  ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y0, y1, wall, wp, roof, PLAIN, vBase);
  ctx.collider(r.x0, r.z0, r.x1, r.z1, y0, y1);
}

function inset(r: Rect, d: number): Rect {
  return { x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d };
}

function parcels(r: Rect, nx: number, nz: number, gap: number): Rect[] {
  const out: Rect[] = [];
  const w = (r.x1 - r.x0 - gap * (nx - 1)) / nx;
  const d = (r.z1 - r.z0 - gap * (nz - 1)) / nz;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = r.x0 + i * (w + gap);
      const z0 = r.z0 + j * (d + gap);
      out.push({ x0, z0, x1: x0 + w, z1: z0 + d });
    }
  }
  return out;
}

function roofClutter(ctx: Ctx, rng: Rng, r: Rect, y: number, n: number): void {
  if (ctx.lod !== 0) return;
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w < 8 || d < 8) return;
  for (let i = 0; i < n; i++) {
    const sx = rng.range(2, Math.min(6, w * 0.3)), sz = rng.range(2, Math.min(6, d * 0.3));
    const x = rng.range(r.x0 + 1.5, r.x1 - 1.5 - sx), z = rng.range(r.z0 + 1.5, r.z1 - 1.5 - sz);
    ctx.solid.box(x, z, x + sx, z + sz, y, y + rng.range(1.2, 3), C.steel, [STYLE.PLAIN, 0, 0.6, 0.4], C.roofLight);
  }
  // Parapet.
  const t = 0.4, h = 0.9;
  ctx.solid.box(r.x0, r.z0, r.x1, r.z0 + t, y, y + h, C.roofLight, PLAIN, C.roofLight);
  ctx.solid.box(r.x0, r.z1 - t, r.x1, r.z1, y, y + h, C.roofLight, PLAIN, C.roofLight);
  ctx.solid.box(r.x0, r.z0 + t, r.x0 + t, r.z1 - t, y, y + h, C.roofLight, PLAIN, C.roofLight);
  ctx.solid.box(r.x1 - t, r.z0 + t, r.x1, r.z1 - t, y, y + h, C.roofLight, PLAIN, C.roofLight);
}

/** One merged volume for a low-rise block seen from far away. */
function blockProxy(ctx: Ctx, lot: Rect, h: number, color: RGB, style: number, seed: number): void {
  const r = inset(lot, 5);
  if (r.x1 - r.x0 < 10 || r.z1 - r.z0 < 10) return;
  ctx.solid.box(r.x0, r.z0, r.x1, r.z1, 0.15, h, color, facade(style, seed, 3.2, 3.5), mix(color, C.roofDark, 0.6));
  ctx.buildings++;
}

// ───────────────────────────── district fillers ─────────────────────────────

function fillDowntown(ctx: Ctx, brng: Rng, lot: Rect, y: number): void {
  const cxm = (lot.x0 + lot.x1) / 2, czm = (lot.z0 + lot.z1) / 2;
  const centrality = Math.min(1, Math.max(0.18, 1 - Math.hypot(cxm - 2500, czm - 1750) / 950));
  const nx = brng.int(1, 2), nz = brng.int(1, 2);
  for (const p of parcels(lot, nx, nz, 6)) {
    // Every random choice that shapes the building is drawn before any LOD-specific branch,
    // so the same building appears at every level of detail.
    const rng = brng.fork();
    const seed = rng.next();
    const glass = rng.chance(0.62);
    const wall = glass ? rng.pick(PALETTE.glass) : rng.pick(PALETTE.office);
    const style = glass ? STYLE.GLASS : STYLE.OFFICE;
    const floorH = glass ? 3.9 : 3.6;
    const bay = glass ? rng.range(1.5, 2.4) : rng.range(2.8, 4);
    const height = Math.round((36 + 210 * Math.pow(centrality, 1.6) * rng.range(0.45, 1)) / floorH) * floorH;
    const podiumH = Math.round(rng.range(8, 17) / 4) * 4;
    const tIn = rng.range(3, Math.min(9, (p.x1 - p.x0) * 0.2));
    const tower = inset(p, tIn);
    const podiumCol = rng.pick(PALETTE.office);
    const crown = rng.chance(0.55) && height > 70;
    const crownFrac = rng.range(0.72, 0.86);
    ctx.buildings++;
    if (ctx.lod >= 2) {
      ctx.solid.box(tower.x0, tower.z0, tower.x1, tower.z1, y, y + height, wall, facade(style, seed, floorH, bay), C.roofDark);
      if (ctx.lod === 2) ctx.solid.box(p.x0, p.z0, p.x1, p.z1, y, y + podiumH, podiumCol, facade(STYLE.STOREFRONT, seed, 4, 5), C.roofLight);
      continue;
    }
    volume(ctx, p, y, y + podiumH, podiumCol, facade(STYLE.STOREFRONT, seed, 4, 5), C.roofLight);
    const bodyTop = crown ? y + height * crownFrac : y + height;
    volume(ctx, tower, y + podiumH, bodyTop, wall, facade(style, seed, floorH, bay), C.roofDark, podiumH);
    let top = tower;
    if (crown) {
      top = inset(tower, Math.min(6, (tower.x1 - tower.x0) * 0.18));
      volume(ctx, top, bodyTop, y + height, wall, facade(style, seed, floorH, bay), C.roofDark, bodyTop - y);
    }
    roofClutter(ctx, rng, top, y + height, rng.int(1, 3));
    if (height > 150 && ctx.lod === 0) {
      const mx = (top.x0 + top.x1) / 2, mz = (top.z0 + top.z1) / 2;
      ctx.solid.box(mx - 0.4, mz - 0.4, mx + 0.4, mz + 0.4, y + height, y + height + rng.range(14, 30), C.steel, [STYLE.PLAIN, 0, 0.4, 0.8], C.steel);
      ctx.solid.box(mx - 0.6, mz - 0.6, mx + 0.6, mz + 0.6, y + height + 13, y + height + 14, hex(0xff2a2a), [STYLE.GLOW, 0, 0, 0], hex(0xff2a2a));
    }
  }
}

function fillLowRise(
  ctx: Ctx, brng: Rng, lot: Rect, y: number, nx: number, nz: number, minF: number, maxF: number,
  palette: RGB[], style: number, opts: { empty?: number; neon?: boolean; storefront?: number } = {},
): void {
  if (ctx.lod === 3) {
    blockProxy(ctx, lot, 0.15 + ((minF + maxF) / 2) * 3.2, brng.pick(palette), style, brng.next());
    return;
  }
  for (const p of parcels(lot, nx, nz, 2)) {
    const rng = brng.fork();
    if (rng.chance(opts.empty ?? 0.08)) {
      if (ctx.lod <= 1 && rng.chance(0.6)) ctx.prop('tree', (p.x0 + p.x1) / 2, y, (p.z0 + p.z1) / 2, rng.range(0, 6.28), rng.range(0.9, 1.4));
      continue;
    }
    const r = inset(p, rng.range(0.6, 2.2));
    const floors = rng.int(minF, maxF);
    const seed = rng.next();
    const st = rng.chance(opts.storefront ?? 0) ? STYLE.STOREFRONT : style;
    const floorH = st === STYLE.STOREFRONT ? 3.6 : 3.2;
    const h = floors * floorH + (st === STYLE.STOREFRONT ? 0.6 : 0);
    const wall = rng.pick(palette);
    volume(ctx, r, y, y + h, wall, facade(st, seed, floorH, rng.range(2.8, 3.8)), rng.chance(0.5) ? C.roofDark : C.roofLight);
    ctx.buildings++;
    roofClutter(ctx, rng, r, y + h, rng.int(0, 2));
    if (opts.neon && ctx.lod <= 1) {
      const col = rng.pick(PALETTE.neon);
      const sy = y + rng.range(4.2, 6.5), sh = rng.range(0.9, 1.8);
      const sw = (r.x1 - r.x0) * rng.range(0.4, 0.8), mx = (r.x0 + r.x1) / 2;
      ctx.solid.box(mx - sw / 2, r.z1, mx + sw / 2, r.z1 + 0.35, sy, sy + sh, col, [STYLE.NEON, seed, 0, 0], col);
      ctx.solid.box(mx - sw / 2, r.z0 - 0.35, mx + sw / 2, r.z0, sy, sy + sh, col, [STYLE.NEON, seed, 0, 0], col);
      // Signs on the side walls too, so every street of the district glows.
      const c3 = rng.pick(PALETTE.neon);
      const sd = (r.z1 - r.z0) * rng.range(0.35, 0.7), mz = (r.z0 + r.z1) / 2;
      ctx.solid.box(r.x1, mz - sd / 2, r.x1 + 0.35, mz + sd / 2, sy, sy + sh, c3, [STYLE.NEON, seed + 0.5, 0, 0], c3);
      ctx.solid.box(r.x0 - 0.35, mz - sd / 2, r.x0, mz + sd / 2, sy, sy + sh, c3, [STYLE.NEON, seed + 0.6, 0, 0], c3);
      if (rng.chance(0.4)) {
        const c2 = rng.pick(PALETTE.neon);
        ctx.solid.box(r.x1, r.z0 + 2, r.x1 + 0.35, r.z0 + 3.2, y + 3.5, y + Math.min(h, 12), c2, [STYLE.NEON, seed + 0.3, 0, 0], c2);
      }
    }
  }
}

function fillPaseo(ctx: Ctx, rng: Rng, lot: Rect, y: number): void {
  if (rng.chance(0.45)) {
    // A mall in a sea of parking.
    const r = inset(lot, 16);
    const h = rng.range(11, 17);
    const wall = rng.pick(PALETTE.stucco);
    ctx.buildings++;
    if (ctx.lod === 3) { ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y, y + h, wall, facade(STYLE.STOREFRONT, 0.4, 5.5, 8), C.roofLight); return; }
    volume(ctx, r, y, y + h, wall, facade(STYLE.STOREFRONT, rng.next(), 5.5, 8), C.roofLight);
    roofClutter(ctx, rng, r, y + h, 4);
    if (ctx.lod <= 1) {
      const col = rng.pick(PALETTE.neon);
      ctx.solid.box(r.x0 + 6, r.z1, r.x1 - 6, r.z1 + 0.4, y + h - 3.2, y + h - 1, col, [STYLE.NEON, 0.2, 0, 0], col);
    }
    if (ctx.lod === 0) {
      for (let x = lot.x0 + 3; x < lot.x1 - 6; x += 7.8) {
        if (rng.chance(0.35)) ctx.parking.push(x + 1.3, lot.z1 - 6, 0, rng.int(0, 3));
        if (rng.chance(0.35)) ctx.parking.push(x + 1.3, lot.z0 + 6, Math.PI, rng.int(0, 3));
      }
    }
  } else {
    fillLowRise(ctx, rng, lot, y, 2, 2, 3, 8, PALETTE.office, STYLE.OFFICE, { storefront: 0.7, neon: true, empty: 0.05 });
  }
}

function fillCrownShore(ctx: Ctx, brng: Rng, lot: Rect, y: number): void {
  if (brng.chance(0.4)) {
    const rng = brng.fork();
    const cx = rng.range(lot.x0 + 24, lot.x1 - 24), cz = rng.range(lot.z0 + 24, lot.z1 - 24);
    const half = rng.range(13, 17);
    const r = { x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half };
    const h = Math.round(rng.range(55, 135) / 3.3) * 3.3;
    const wall = rng.pick(PALETTE.pastel);
    ctx.buildings++;
    if (ctx.lod >= 2) { ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y, y + h, wall, facade(STYLE.RESIDENTIAL, 0.5, 3.3, 4), C.roofLight); return; }
    const pod = inset(lot, 8);
    volume(ctx, pod, y, y + 7, C.white, facade(STYLE.CONCRETE, rng.next(), 3.5, 6), C.roofLight);
    volume(ctx, r, y + 7, y + h, wall, facade(STYLE.RESIDENTIAL, rng.next(), 3.3, 4), C.roofLight, 7);
    roofClutter(ctx, rng, r, y + h, 2);
    if (ctx.lod === 0) ctx.flat.flat(pod.x0 + 4, pod.z0 + 4, pod.x0 + 16, pod.z0 + 10, y + 7.02, C.pool, [STYLE.POOL, 0, 0, 0]);
  } else {
    if (ctx.lod === 3) { blockProxy(ctx, lot, 7, C.white, STYLE.SIDING, 0.3); return; }
    for (const p of parcels(lot, 3, 2, 3)) {
      const rng = brng.fork();
      const w = rng.range(13, 17), d = rng.range(15, 20);
      const x0 = p.x0 + rng.range(2, Math.max(2.1, p.x1 - p.x0 - w - 2)), z0 = p.z0 + rng.range(2, Math.max(2.1, p.z1 - p.z0 - d - 2));
      const r = { x0, z0, x1: x0 + w, z1: z0 + d };
      volume(ctx, r, y, y + rng.range(6, 8), rng.pick(PALETTE.pastel), facade(STYLE.SIDING, rng.next(), 3.4, 4.5), C.roofTile);
      ctx.buildings++;
      if (ctx.lod <= 1) {
        ctx.prop('palm', p.x0 + 1.5, y, p.z1 - 1.5, rng.range(0, 6.28), rng.range(0.9, 1.3));
        if (ctx.lod === 0 && p.x1 - r.x1 > 6) ctx.flat.flat(r.x1 + 1.5, r.z0 + 2, Math.min(p.x1 - 1, r.x1 + 6.5), r.z0 + 11, y + 0.02, C.pool, [STYLE.POOL, 0, 0, 0]);
      }
    }
  }
}

function fillCypress(ctx: Ctx, brng: Rng, lot: Rect, y: number): void {
  if (ctx.lod === 3) { blockProxy(ctx, lot, 4.6, hex(0x8f8a78), STYLE.SIDING, 0.1); return; }
  const deep = lot.z1 - lot.z0 > lot.x1 - lot.x0 ? 2 : 2;
  for (const p of parcels(lot, 4, deep, 1)) {
    const rng = brng.fork();
    const front = p.z0 < (lot.z0 + lot.z1) / 2; // faces north road or south road
    const w = rng.range(10, 13), d = rng.range(11, 14);
    const x0 = p.x0 + rng.range(2, Math.max(2.1, p.x1 - p.x0 - w - 5));
    const z0 = front ? p.z0 + rng.range(6, 9) : p.z1 - d - rng.range(6, 9);
    const r = { x0, z0, x1: x0 + w, z1: z0 + d };
    const h = rng.chance(0.3) ? 6.2 : 3.3;
    const wall = rng.pick(PALETTE.siding);
    ctx.buildings++;
    if (ctx.lod === 2) { ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y, y + h + 1, wall, facade(STYLE.SIDING, 0.2, 3.1, 3.6), C.roofDark); continue; }
    ctx.solid.walls(r.x0, r.z0, r.x1, r.z1, y, y + h, wall, facade(STYLE.SIDING, rng.next(), 3.1, 3.6));
    ctx.collider(r.x0, r.z0, r.x1, r.z1, y, y + h + 1.5);
    const roof = rng.chance(0.5) ? C.roofDark : rng.chance(0.5) ? C.roofTile : hex(0x5a4a3f);
    ctx.solid.gable(r.x0 - 0.5, r.z0 - 0.5, r.x1 + 0.5, r.z1 + 0.5, y + h, rng.range(1.8, 2.8), rng.chance(0.5), roof, wall, facade(STYLE.SIDING, 0.1, 9, 9));
    if (ctx.lod === 0) {
      // Driveway to the nearer street, with a slot for the family car.
      const dx = r.x1 + 1;
      if (front) { ctx.flat.flat(dx, p.z0, dx + 3.2, r.z0 + 6, y + 0.02, C.concrete, [STYLE.SIDEWALK, 0, 0, 0]); if (rng.chance(0.55)) ctx.parking.push(dx + 1.6, r.z0 + 1, 0, rng.int(0, 1)); }
      else { ctx.flat.flat(dx, r.z1 - 6, dx + 3.2, p.z1, y + 0.02, C.concrete, [STYLE.SIDEWALK, 0, 0, 0]); if (rng.chance(0.55)) ctx.parking.push(dx + 1.6, r.z1 - 1, Math.PI, rng.int(0, 1)); }
    }
    if (rng.chance(0.75)) ctx.prop('tree', p.x0 + rng.range(1.5, 4), y, front ? p.z1 - rng.range(2, 6) : p.z0 + rng.range(2, 6), rng.range(0, 6.28), rng.range(0.9, 1.5));
    if (ctx.lod === 0 && rng.chance(0.5)) ctx.prop('bush', r.x0 - 1, y, (r.z0 + r.z1) / 2, 0, rng.range(0.8, 1.2));
  }
}

function fillSaltgrass(ctx: Ctx, rng: Rng, lot: Rect, y: number, hasRoad: boolean): void {
  const kind = rng.next();
  if (hasRoad && kind < 0.14) {
    const x = rng.range(lot.x0 + 12, lot.x1 - 40), z = rng.range(lot.z0 + 12, lot.z1 - 40);
    ctx.buildings++;
    if (ctx.lod === 3) { ctx.solid.box(x, z, x + 14, z + 22, y, y + 9, hex(0x8c3a2e), facade(STYLE.INDUSTRIAL, 0.2, 9, 9), C.roofDark); return; }
    const barn = { x0: x, z0: z, x1: x + 14, z1: z + 22 };
    ctx.solid.walls(barn.x0, barn.z0, barn.x1, barn.z1, y, y + 6, hex(0x8c3a2e), facade(STYLE.INDUSTRIAL, 0.2, 9, 7));
    ctx.solid.gable(barn.x0 - 0.4, barn.z0 - 0.4, barn.x1 + 0.4, barn.z1 + 0.4, y + 6, 4, false, hex(0x55585c), hex(0x8c3a2e), facade(STYLE.INDUSTRIAL, 0.2, 9, 9));
    ctx.collider(barn.x0, barn.z0, barn.x1, barn.z1, y, y + 8);
    volume(ctx, { x0: x + 20, z0: z + 2, x1: x + 25, z1: z + 7 }, y, y + 13, hex(0xb9b9b4), [STYLE.PLAIN, 0, 0.5, 0.5], hex(0x8e8e88));
    if (ctx.lod <= 1) {
      const house = { x0: x + 2, z0: z + 30, x1: x + 13, z1: z + 39 };
      ctx.solid.walls(house.x0, house.z0, house.x1, house.z1, y, y + 3.3, C.white, facade(STYLE.SIDING, 0.6, 3.1, 3.6));
      ctx.solid.gable(house.x0 - 0.4, house.z0 - 0.4, house.x1 + 0.4, house.z1 + 0.4, y + 3.3, 2.2, true, C.roofDark, C.white, facade(STYLE.SIDING, 0.1, 9, 9));
      ctx.collider(house.x0, house.z0, house.x1, house.z1, y, y + 5);
    }
  }
  if (ctx.lod >= 3) return;
  const trees = kind > 0.72 ? rng.int(10, 22) : rng.int(0, 4);
  const n = ctx.lod === 2 ? Math.floor(trees / 3) : trees;
  for (let i = 0; i < n; i++) {
    ctx.prop('tree', rng.range(lot.x0 + 3, lot.x1 - 3), y, rng.range(lot.z0 + 3, lot.z1 - 3), rng.range(0, 6.28), rng.range(0.9, 1.9));
  }
}

function fillPort(ctx: Ctx, brng: Rng, lot: Rect, y: number, waterSide: boolean): void {
  const kind = brng.next();
  let rng = brng.fork();
  if (kind < 0.42) {
    // Container yard: rows of stacked boxes.
    const rowGap = 9;
    for (let z = lot.z0 + 6; z < lot.z1 - 8; z += rowGap) {
      for (let x = lot.x0 + 6; x < lot.x1 - 16; x += 13.2) {
        rng = brng.fork();
        if (rng.chance(0.22)) continue;
        const stack = rng.int(1, 4);
        if (ctx.lod >= 2) {
          ctx.solid.box(x, z, x + 12.2, z + 5.2, y, y + stack * 2.6, rng.pick(PALETTE.container), [STYLE.INDUSTRIAL, rng.next(), 2.6, 12.2], rng.pick(PALETTE.container));
          continue;
        }
        for (let side = 0; side < 2; side++) {
          const zz = z + side * 2.6;
          const hgt = side === 0 ? stack : rng.int(1, stack);
          for (let s = 0; s < hgt; s++) {
            const col = rng.pick(PALETTE.container);
            ctx.solid.box(x, zz, x + 12.2, zz + 2.44, y + s * 2.6, y + s * 2.6 + 2.59, col, [STYLE.INDUSTRIAL, rng.next(), 2.6, 12.2], shade(col, 0.8));
          }
          ctx.collider(x, zz, x + 12.2, zz + 2.44, y, y + hgt * 2.6);
        }
      }
    }
    ctx.buildings += 4;
    if (waterSide && ctx.lod <= 2) ctx.prop('crane', (lot.x0 + lot.x1) / 2, y, lot.z1 - 10, 0, 1, hex(0xd9a02b));
  } else if (kind < 0.8) {
    const r = inset(lot, rng.range(8, 14));
    const h = rng.range(9, 14);
    const wall = rng.pick(PALETTE.metal);
    ctx.buildings++;
    if (ctx.lod === 3) { ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y, y + h, wall, facade(STYLE.INDUSTRIAL, 0.3, h, 7), C.roofLight); return; }
    const halves = rng.chance(0.5) ? parcels(r, 2, 1, 8) : [r];
    for (const w of halves) {
      volume(ctx, w, y, y + h, wall, facade(STYLE.INDUSTRIAL, rng.next(), h, 7), C.roofLight);
      roofClutter(ctx, rng, w, y + h, 2);
    }
    if (ctx.lod === 0) for (let x = lot.x0 + 4; x < lot.x1 - 8; x += 9) if (rng.chance(0.25)) ctx.parking.push(x, lot.z0 + 4, Math.PI / 2, 3);
  } else {
    // Tank farm.
    if (ctx.lod === 3) return;
    for (const p of parcels(inset(lot, 10), 3, 3, 6)) {
      rng = brng.fork();
      if (rng.chance(0.3)) continue;
      const s = Math.min(p.x1 - p.x0, p.z1 - p.z0);
      const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
      const h = rng.range(8, 13);
      ctx.solid.boxRot(mx, mz, s * 0.72, s * 0.72, y, y + h, 0, C.white, [STYLE.PLAIN, 0, 0.45, 0.3], hex(0xcfcfc8));
      ctx.solid.boxRot(mx, mz, s * 0.72, s * 0.72, y, y + h, Math.PI / 4, C.white, [STYLE.PLAIN, 0, 0.45, 0.3], hex(0xcfcfc8));
      ctx.collider(mx - s * 0.4, mz - s * 0.4, mx + s * 0.4, mz + s * 0.4, y, y + h);
      ctx.buildings++;
    }
  }
}

function fillMarina(ctx: Ctx, brng: Rng, lot: Rect, y: number, water: { n: boolean; e: boolean; s: boolean; w: boolean }): void {
  if (ctx.lod === 3) { blockProxy(ctx, lot, 7, C.white, STYLE.STOREFRONT, 0.4); return; }
  const rng = brng.fork();
  const strip = { x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z0 + (lot.z1 - lot.z0) * 0.45 };
  for (const p of parcels(strip, 3, 1, 4)) {
    const rng = brng.fork();
    if (rng.chance(0.15)) continue;
    const r = inset(p, 2);
    volume(ctx, r, y, y + rng.range(5, 10), rng.pick(PALETTE.pastel), facade(STYLE.STOREFRONT, rng.next(), 3.8, 4.5), rng.chance(0.5) ? C.roofTile : C.roofLight);
    ctx.buildings++;
  }
  if (ctx.lod <= 1) for (let x = lot.x0 + 6; x < lot.x1 - 4; x += 16) ctx.prop('palm', x, y, lot.z1 - 4, rng.range(0, 6.28), rng.range(0.9, 1.3));
  // Piers reach out over the water from any wet edge.
  const pier = (x0: number, z0: number, x1: number, z1: number, alongX: boolean) => {
    ctx.flat.flat(x0, z0, x1, z1, 0.1, C.wood, [STYLE.WOOD, 0, 0, 0]);
    ctx.collider(x0, z0, x1, z1, -0.6, 0.1);
    if (ctx.lod === 0 && brng.chance(0.45)) {
      // A boat for hire at the end of the pier (parking profile 4).
      if (alongX) ctx.parking.push(x1 + 5, (z0 + z1) / 2, Math.PI / 2, 4);
      else ctx.parking.push((x0 + x1) / 2, z1 + 5, 0, 4);
    }
    if (ctx.lod > 1) return;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let t = 8; t < len - 4; t += 11) {
      for (const side of [-1, 1]) {
        if (rng.chance(0.3)) continue;
        const col = rng.chance(0.7) ? C.white : rng.pick(PALETTE.pastel);
        if (alongX) ctx.prop('boat', x0 + t, -0.55, (z0 + z1) / 2 + side * 5.2, side > 0 ? 0 : Math.PI, rng.range(0.8, 1.25), col);
        else ctx.prop('boat', (x0 + x1) / 2 + side * 5.2, -0.55, z0 + t, side > 0 ? Math.PI / 2 : -Math.PI / 2, rng.range(0.8, 1.25), col);
      }
    }
  };
  if (water.s) for (let x = lot.x0 + 12; x < lot.x1 - 6; x += 26) pier(x - 1.5, lot.z1 + 6, x + 1.5, lot.z1 + 62, false);
  if (water.e) for (let z = lot.z0 + 12; z < lot.z1 - 6; z += 26) pier(lot.x1 + 6, z - 1.5, lot.x1 + 62, z + 1.5, true);
}

function fillBeach(ctx: Ctx, brng: Rng, lot: Rect, y: number, oceanSide: boolean): void {
  let rng = brng.fork();
  if (oceanSide) {
    if (ctx.lod >= 2) return;
    for (let i = 0; i < (ctx.lod === 0 ? 16 : 6); i++) {
      const x = rng.range(lot.x0 + 30, lot.x1 - 6), z = rng.range(lot.z0 + 4, lot.z1 - 4);
      ctx.prop('umbrella', x, y, z, rng.range(0, 6.28), 1, rng.pick(PALETTE.neon));
    }
    for (let i = 0; i < 5; i++) ctx.prop('palm', rng.range(lot.x0 + 2, lot.x0 + 22), y, rng.range(lot.z0 + 4, lot.z1 - 4), rng.range(0, 6.28), rng.range(1, 1.5));
    if (rng.chance(0.5)) {
      const x = lot.x0 + 60, z = rng.range(lot.z0 + 20, lot.z1 - 20);
      volume(ctx, { x0: x, z0: z, x1: x + 3, z1: z + 3 }, y + 2.2, y + 4.6, C.white, facade(STYLE.SIDING, 0.3, 2.4, 3), hex(0xd24a3a));
      ctx.solid.box(x + 0.2, z + 0.2, x + 0.5, z + 0.5, y, y + 2.2, C.wood, PLAIN, C.wood);
      ctx.solid.box(x + 2.5, z + 2.5, x + 2.8, z + 2.8, y, y + 2.2, C.wood, PLAIN, C.wood);
    }
    return;
  }
  if (ctx.lod === 3) { blockProxy(ctx, lot, 28, rng.pick(PALETTE.pastel), STYLE.RESIDENTIAL, 0.6); return; }
  for (const p of parcels(inset(lot, 4), 1, 2, 10)) {
    rng = brng.fork();
    const r = { x0: p.x1 - rng.range(30, 44), z0: p.z0 + 3, x1: p.x1 - 3, z1: p.z1 - 3 };
    const h = Math.round(rng.range(18, 52) / 3.3) * 3.3;
    volume(ctx, r, y, y + h, rng.pick(PALETTE.pastel), facade(STYLE.RESIDENTIAL, rng.next(), 3.3, 3.8), C.roofLight);
    roofClutter(ctx, rng, r, y + h, 2);
    ctx.buildings++;
    if (ctx.lod <= 1) {
      ctx.flat.flat(p.x0 + 4, p.z0 + 6, p.x0 + 16, p.z0 + 14, y + 0.03, C.pool, [STYLE.POOL, 0, 0, 0]);
      for (let i = 0; i < 4; i++) ctx.prop('palm', rng.range(p.x0 + 2, r.x0 - 2), y, rng.range(p.z0 + 2, p.z1 - 2), rng.range(0, 6.28), rng.range(1, 1.5));
    }
  }
}

function fillEastbank(ctx: Ctx, brng: Rng, lot: Rect, y: number): void {
  for (const p of parcels(lot, 2, 2, 5)) {
    const rng = brng.fork();
    const kind = rng.next();
    const r = inset(p, rng.range(3, 6));
    if (kind < 0.4) {
      // Steel and concrete frame, floors open to the weather.
      const floors = rng.int(4, 14), fh = 3.6;
      ctx.buildings++;
      if (ctx.lod >= 2) { ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y, y + floors * fh, hex(0x8b8f8c), facade(STYLE.FRAME, rng.next(), fh, 6), C.concrete); continue; }
      for (let f = 1; f <= floors; f++) ctx.solid.box(r.x0, r.z0, r.x1, r.z1, y + f * fh - 0.35, y + f * fh, C.concrete, [STYLE.PLAIN, 0, 0.9, 0], C.concrete);
      const cols = 3;
      for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= cols; j++) {
          const x = r.x0 + ((r.x1 - r.x0 - 0.7) * i) / cols, z = r.z0 + ((r.z1 - r.z0 - 0.7) * j) / cols;
          ctx.solid.walls(x, z, x + 0.7, z + 0.7, y, y + floors * fh, hex(0x777c80), [STYLE.PLAIN, 0, 0.7, 0.3]);
        }
      }
      ctx.collider(r.x0, r.z0, r.x1, r.z1, y + fh - 0.35, y + floors * fh);
      for (const [cx, cz] of [[r.x0, r.z0], [r.x1 - 0.7, r.z0], [r.x0, r.z1 - 0.7], [r.x1 - 0.7, r.z1 - 0.7]]) ctx.collider(cx, cz, cx + 0.7, cz + 0.7, y, y + fh);
      if (rng.chance(0.6) && ctx.lod <= 2) ctx.prop('crane', r.x1 + 2, y, r.z0 - 2, rng.range(0, 6.28), rng.range(0.9, 1.3) * Math.max(1, (floors * fh) / 34), hex(0xe0b020));
    } else if (kind < 0.62) {
      const h = Math.round(rng.range(18, 46) / 3.6) * 3.6;
      volume(ctx, r, y, y + h, rng.pick(PALETTE.glass), facade(STYLE.GLASS, rng.next(), 3.6, 2), C.roofDark);
      roofClutter(ctx, rng, r, y + h, 2);
      ctx.buildings++;
    } else if (ctx.lod <= 1) {
      // Fenced lot with spoil heaps and site cabins.
      for (let i = 0; i < 3; i++) {
        const x = rng.range(r.x0, r.x1 - 6), z = rng.range(r.z0, r.z1 - 3);
        ctx.solid.boxRot(x, z, 6, 2.5, y, y + 2.6, rng.range(0, 3.14), rng.chance(0.5) ? hex(0xd8d4c8) : hex(0x3f6f9a), [STYLE.SIDING, rng.next(), 2.6, 3], C.roofLight);
        ctx.colliderRot(x, z, 6, 2.5, y, y + 2.6, 0);
      }
    }
  }
}

function fillSalvageYard(ctx: Ctx, rng: Rng, lot: Rect, y: number): void {
  // Navarro Salvage: an open yard. The west half stays clear — the game starts here.
  const office = { x0: lot.x0 + 4, z0: lot.z0 + 4, x1: lot.x0 + 13, z1: lot.z0 + 10.5 };
  volume(ctx, office, y, y + 3.6, hex(0xc9b98f), facade(STYLE.SIDING, 0.42, 3.4, 3), hex(0x6a4a3a));
  ctx.buildings++;
  if (ctx.lod <= 1) {
    const col = hex(0xffb347);
    ctx.solid.box(office.x0 + 1, office.z1, office.x1 - 1, office.z1 + 0.25, y + 3.7, y + 4.9, col, [STYLE.NEON, 0.1, 0, 0], col);
  }
  if (ctx.lod >= 3) return;
  // Scrap heaps and crushed-car stacks on the east side.
  for (let i = 0; i < (ctx.lod === 0 ? 26 : 10); i++) {
    const x = rng.range(lot.x0 + 58, lot.x1 - 6), z = rng.range(lot.z0 + 8, lot.z1 - 8);
    const sx = rng.range(3.5, 5), sz = rng.range(1.8, 2.3), h = rng.int(1, 4) * 1.1, rot = rng.range(0, 3.14);
    ctx.solid.boxRot(x, z, sx, sz, y, y + h, rot, rng.pick(PALETTE.scrap), [STYLE.PLAIN, 0, 0.8, 0.3]);
    ctx.colliderRot(x, z, sx, sz, y, y + h, rot);
  }
  // Perimeter fence with gates to the north and west streets.
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    ctx.solid.box(x0, z0, x1, z1, y, y + 2.4, hex(0x6d7377), [STYLE.FRAME, 0.5, 2.4, 2.4], hex(0x6d7377));
    ctx.collider(x0, z0, x1, z1, y, y + 2.4);
  };
  const t = 0.18;
  fence(lot.x0, lot.z0, lot.x0 + 24, lot.z0 + t); fence(lot.x0 + 34, lot.z0, lot.x1, lot.z0 + t);
  fence(lot.x0, lot.z1 - t, lot.x1, lot.z1); fence(lot.x1 - t, lot.z0, lot.x1, lot.z1);
  fence(lot.x0, lot.z0, lot.x0 + t, lot.z0 + 22); fence(lot.x0, lot.z0 + 32, lot.x0 + t, lot.z1);
  ctx.prop('crane', lot.x1 - 26, y, lot.z1 - 22, 0.6, 0.55, hex(0xc98a2b));
}

// ───────────────────────────── blocks and roads ─────────────────────────────

const LOT_GROUND: Record<string, { style: number; color: RGB }> = {
  downtown: { style: STYLE.SIDEWALK, color: C.concrete }, neonmile: { style: STYLE.SIDEWALK, color: hex(0x8f8c88) },
  paseo: { style: STYLE.LOT, color: C.lot }, flats: { style: STYLE.SIDEWALK, color: hex(0x8d8a84) },
  crownshore: { style: STYLE.GRASS, color: C.grass }, cypress: { style: STYLE.GRASS, color: C.grass },
  saltgrass: { style: STYLE.GRASS, color: C.dryGrass }, port: { style: STYLE.LOT, color: hex(0x47474a) },
  marina: { style: STYLE.SIDEWALK, color: hex(0xa9a69c) }, beach: { style: STYLE.SAND, color: C.sand },
  eastbank: { style: STYLE.DIRT, color: C.dirt },
};

function genBlock(ctx: Ctx, bx: number, bz: number): void {
  const d = districtOfBlock(bx, bz);
  if (!isLand(d)) return;
  const X0 = bx * BLOCK, Z0 = bz * BLOCK, X1 = X0 + BLOCK, Z1 = Z0 + BLOCK;
  const cw = edgeClass(true, bx, bz), ce = edgeClass(true, bx + 1, bz), cn = edgeClass(false, bz, bx), cs = edgeClass(false, bz + 1, bx);
  const slab = { x0: X0 + roadWidth(cw) / 2, z0: Z0 + roadWidth(cn) / 2, x1: X1 - roadWidth(ce) / 2, z1: Z1 - roadWidth(cs) / 2 };
  const hasRoad = cw + ce + cn + cs > 0;
  const raised = hasRoad && d !== 'saltgrass' && d !== 'beach';
  const y = raised ? 0.15 : 0;
  const rng = new Rng(seedFor(bx, bz, ctx.seed));
  const lod = ctx.lod;
  const water = {
    w: !isLand(districtOfBlock(bx - 1, bz)), e: !isLand(districtOfBlock(bx + 1, bz)),
    n: !isLand(districtOfBlock(bx, bz - 1)), s: !isLand(districtOfBlock(bx, bz + 1)),
  };

  // Physics ground: one slab per block, widened to carry the roads and the shoreline.
  ctx.collider(X0 - 13, Z0 - 13, X1 + 13, Z1 + 13, -2, 0);
  if (raised) ctx.collider(slab.x0, slab.z0, slab.x1, slab.z1, -0.5, 0.15);

  // Sea wall where the land meets water.
  if (lod <= 2) {
    const wallY0 = -4, pad = 13;
    if (water.w) { const x = X0 - roadWidth(cw) / 2; ctx.solid.quad(x, wallY0, Z0 - pad, x, wallY0, Z1 + pad, x, y, Z1 + pad, x, y, Z0 - pad, 0, 0, BLOCK, 4, C.seawall, [STYLE.CONCRETE, 0.1, 9, 9]); }
    if (water.e) { const x = X1 + roadWidth(ce) / 2; ctx.solid.quad(x, wallY0, Z1 + pad, x, wallY0, Z0 - pad, x, y, Z0 - pad, x, y, Z1 + pad, 0, 0, BLOCK, 4, C.seawall, [STYLE.CONCRETE, 0.1, 9, 9]); }
    if (water.n) { const z = Z0 - roadWidth(cn) / 2; ctx.solid.quad(X1 + pad, wallY0, z, X0 - pad, wallY0, z, X0 - pad, y, z, X1 + pad, y, z, 0, 0, BLOCK, 4, C.seawall, [STYLE.CONCRETE, 0.1, 9, 9]); }
    if (water.s) { const z = Z1 + roadWidth(cs) / 2; ctx.solid.quad(X0 - pad, wallY0, z, X1 + pad, wallY0, z, X1 + pad, y, z, X0 - pad, y, z, 0, 0, BLOCK, 4, C.seawall, [STYLE.CONCRETE, 0.1, 9, 9]); }
  }

  // Ground: sidewalk strips on the sides that have a road, then the lot.
  const swW = d === 'cypress' ? 2 : 3.2;
  const sw = raised ? swW : 0;
  const lot = { x0: slab.x0 + (cw ? sw : 0), z0: slab.z0 + (cn ? sw : 0), x1: slab.x1 - (ce ? sw : 0), z1: slab.z1 - (cs ? sw : 0) };
  let ground = LOT_GROUND[d] ?? LOT_GROUND.downtown;
  if (d === 'saltgrass') {
    const k = hash2(bx, bz, 5);
    ground = k < 0.3 ? { style: STYLE.FIELD, color: C.field } : k < 0.5 ? { style: STYLE.FIELD, color: C.fieldB } : { style: STYLE.GRASS, color: mix(C.dryGrass, C.grass, hash2(bx, bz, 6)) };
  }
  if (bx === SALVAGE_BLOCK.bx && bz === SALVAGE_BLOCK.bz) ground = { style: STYLE.DIRT, color: C.dirt };
  ctx.flat.flat(lot.x0, lot.z0, lot.x1, lot.z1, y, ground.color, [ground.style, hash2(bx, bz, 3), 0, 0]);
  if (raised) {
    const sp: Params = [STYLE.SIDEWALK, 0, 0, 0];
    if (cn) ctx.flat.flat(slab.x0, slab.z0, slab.x1, lot.z0, y, C.concrete, sp);
    if (cs) ctx.flat.flat(slab.x0, lot.z1, slab.x1, slab.z1, y, C.concrete, sp);
    if (cw) ctx.flat.flat(slab.x0, lot.z0, lot.x0, lot.z1, y, C.concrete, sp);
    if (ce) ctx.flat.flat(lot.x1, lot.z0, slab.x1, lot.z1, y, C.concrete, sp);
    if (lod <= 1) ctx.flat.walls(slab.x0, slab.z0, slab.x1, slab.z1, 0, y, C.curb, [STYLE.SIDEWALK, 0, 0, 0]);
    if (lod === 0) ctx.sidewalks.push(slab.x0 + 1.5, slab.z0 + 1.5, slab.x1 - 1.5, slab.z1 - 1.5);
  }

  // Street furniture along every side that has a road.
  if (lod <= 1 && hasRoad && d !== 'saltgrass') {
    const palms = d === 'beach' || d === 'crownshore' || d === 'marina' || d === 'neonmile' || d === 'downtown' || d === 'paseo';
    const treeKind: PropKind = palms ? 'palm' : 'tree';
    const treeEvery = d === 'port' || d === 'eastbank' ? 0 : d === 'downtown' ? 2 : 1;
    const frng = new Rng(seedFor(bx, bz, ctx.seed + 101));
    const side = (cls: number, along: (t: number) => [number, number], rot: number) => {
      if (!cls) return;
      const len = BLOCK - 30;
      let i = 0;
      for (let t = 15; t <= 15 + len; t += 34, i++) {
        const [x, z] = along(t);
        ctx.prop('streetlight', x, y, z, rot, 1);
        ctx.lamps.push(x + Math.sin(rot) * 2.2, y + 7.6, z + Math.cos(rot) * 2.2);
        if (lod === 0) ctx.collider(x - 0.14, z - 0.14, x + 0.14, z + 0.14, y, y + 7.5);
        if (treeEvery && i % treeEvery === 0 && t + 17 < BLOCK - 8) {
          const [tx, tz] = along(t + 17);
          ctx.prop(treeKind, tx, y, tz, frng.range(0, 6.28), frng.range(0.85, 1.25));
          if (lod === 0) ctx.collider(tx - 0.2, tz - 0.2, tx + 0.2, tz + 0.2, y, y + 4);
        }
        const hyd = frng.chance(0.12), ben = frng.chance(0.14);
        if (lod === 0 && hyd) { const [hx, hz] = along(t + 6); ctx.prop('hydrant', hx, y, hz, 0, 1); }
        if (lod === 0 && ben && d !== 'port') { const [hx, hz] = along(t + 24); ctx.prop('bench', hx, y, hz, rot + Math.PI, 1); }
      }
    };
    const e = 0.9;
    side(cn, (t) => [X0 + t, slab.z0 + e], Math.PI);
    side(cs, (t) => [X0 + t, slab.z1 - e], 0);
    side(cw, (t) => [slab.x0 + e, Z0 + t], -Math.PI / 2);
    side(ce, (t) => [slab.x1 - e, Z0 + t], Math.PI / 2);
  }

  const poi = poiForBlock(bx, bz);
  if (poi) ctx.pois.push(poi);

  const blot = inset(lot, d === 'cypress' || d === 'saltgrass' || d === 'beach' ? 0 : 1);
  if (bx === SALVAGE_BLOCK.bx && bz === SALVAGE_BLOCK.bz) { fillSalvageYard(ctx, rng, lot, y); return; }
  switch (d) {
    case 'downtown': fillDowntown(ctx, rng, blot, y); break;
    case 'flats': fillLowRise(ctx, rng, blot, y, 4, 3, 2, 5, rng.chance(0.6) ? PALETTE.brick : PALETTE.stucco, STYLE.RESIDENTIAL, { storefront: 0.15, empty: 0.1 }); break;
    case 'neonmile': fillLowRise(ctx, rng, blot, y, 3, 2, 2, 8, PALETTE.stucco, STYLE.STOREFRONT, { neon: true, empty: 0.04, storefront: 1 }); break;
    case 'paseo': fillPaseo(ctx, rng, blot, y); break;
    case 'crownshore': fillCrownShore(ctx, rng, blot, y); break;
    case 'cypress': fillCypress(ctx, rng, blot, y); break;
    case 'saltgrass': fillSaltgrass(ctx, rng, blot, y, hasRoad); break;
    case 'port': fillPort(ctx, rng, blot, y, water.s || water.e); break;
    case 'marina': fillMarina(ctx, rng, blot, y, water); break;
    case 'beach': fillBeach(ctx, rng, blot, y, bx % 2 === 1); break;
    case 'eastbank': fillEastbank(ctx, rng, blot, y); break;
  }
}

const ROAD_Y = 0.02;

function genRoads(ctx: Ctx, cx: number, cz: number): void {
  const lod = ctx.lod;
  const minClass = lod >= 3 ? RoadClass.Arterial : RoadClass.Street;
  for (let dk = 0; dk < 2; dk++) {
    for (let di = 0; di < 2; di++) {
      // North-south segment on line kx, from intersection kz to kz + 1.
      {
        const k = cx * 2 + dk, i = cz * 2 + di;
        const c = edgeClass(true, k, i);
        if (c >= minClass) {
          const w = roadWidth(c);
          const a = nodeInfo(k, i), b = nodeInfo(k, i + 1);
          const z0 = i * BLOCK + a.halfZ, z1 = (i + 1) * BLOCK - b.halfZ;
          const x0 = k * BLOCK - w / 2, x1 = k * BLOCK + w / 2;
          const len = z1 - z0;
          const xw = (a.degree >= 3 ? 1 : 0) + (b.degree >= 3 ? 2 : 0);
          ctx.flat.flat(x0, z0, x1, z1, ROAD_Y, C.asphalt, [STYLE.ROAD, c + 10 * xw, len / 2, 0], [-w / 2, len / 2, w / 2, -len / 2]);
          if (lod === 0 && c === RoadClass.Street) curbParking(ctx, k, i, true, x0, x1, z0, z1);
        }
      }
      // East-west segment on line kz, from intersection kx to kx + 1.
      {
        const k = cz * 2 + dk, i = cx * 2 + di;
        const c = edgeClass(false, k, i);
        if (c >= minClass) {
          const w = roadWidth(c);
          const a = nodeInfo(i, k), b = nodeInfo(i + 1, k);
          const x0 = i * BLOCK + a.halfX, x1 = (i + 1) * BLOCK - b.halfX;
          const z0 = k * BLOCK - w / 2, z1 = k * BLOCK + w / 2;
          const len = x1 - x0;
          const xw = (a.degree >= 3 ? 1 : 0) + (b.degree >= 3 ? 2 : 0);
          ctx.flat.quad(x1, ROAD_Y, z1, x1, ROAD_Y, z0, x0, ROAD_Y, z0, x0, ROAD_Y, z1, w / 2, len / 2, -w / 2, -len / 2, C.asphalt, [STYLE.ROAD, c + 10 * xw, len / 2, 0]);
          if (lod === 0 && c === RoadClass.Street) curbParking(ctx, k, i, false, x0, x1, z0, z1);
        }
      }
      // Intersection.
      {
        const kx = cx * 2 + dk, kz = cz * 2 + di;
        const n = nodeInfo(kx, kz);
        if (n.degree && n.halfX > 0 && n.halfZ > 0 && (lod < 3 || Math.max(...n.arms) >= RoadClass.Arterial)) {
          const x = kx * BLOCK, z = kz * BLOCK;
          ctx.flat.flat(x - n.halfX, z - n.halfZ, x + n.halfX, z + n.halfZ, ROAD_Y, C.asphalt, [STYLE.INTERSECTION, 0, 0, 0]);
          if (n.signal && lod <= 1) {
            const ox = n.halfX + 1.2, oz = n.halfZ + 1.2;
            ctx.prop('trafficlight', x + ox, 0.15, z + oz, 0, 1);
            ctx.prop('trafficlight', x - ox, 0.15, z - oz, Math.PI, 1);
            ctx.prop('trafficlight', x + ox, 0.15, z - oz, Math.PI / 2, 1);
            ctx.prop('trafficlight', x - ox, 0.15, z + oz, -Math.PI / 2, 1);
          }
        }
      }
    }
  }
}

function curbParking(ctx: Ctx, k: number, i: number, vertical: boolean, x0: number, x1: number, z0: number, z1: number): void {
  const d = vertical ? districtOfBlock(k, i) : districtOfBlock(i, k);
  if (d === 'saltgrass' || d === 'water' || d === 'beach' || d === 'causeway') return;
  const rng = new Rng(seedFor(k * 2 + (vertical ? 1 : 0), i, ctx.seed + 17));
  const density = d === 'flats' || d === 'neonmile' ? 0.3 : d === 'cypress' ? 0.08 : 0.18;
  const pick = () => { const r = rng.next(); return r < 0.5 ? 0 : r < 0.75 ? 1 : r < 0.9 ? 2 : 3; };
  if (vertical) {
    for (let z = z0 + 16; z < z1 - 16; z += 7.5) {
      if (rng.chance(density)) ctx.parking.push(x1 - 1.15, z, Math.PI, pick());
      if (rng.chance(density)) ctx.parking.push(x0 + 1.15, z, 0, pick());
    }
  } else {
    for (let x = x0 + 16; x < x1 - 16; x += 7.5) {
      if (rng.chance(density)) ctx.parking.push(x, z0 + 1.15, Math.PI / 2, pick());
      if (rng.chance(density)) ctx.parking.push(x, z1 - 1.15, -Math.PI / 2, pick());
    }
  }
}

/** The Odile Causeway: deck, parapets and piers across the channel. */
function genCauseway(ctx: Ctx, cx: number): void {
  const x0 = cx * CELL, x1 = x0 + CELL, zc = CAUSEWAY_KZ * BLOCK, half = 10.5;
  ctx.solid.box(x0, zc - half, x1, zc + half, -1.4, 0, C.concrete, [STYLE.CONCRETE, 0.2, 9, 9], C.concrete);
  ctx.collider(x0, zc - half, x1, zc + half, -1.4, 0);
  for (const s of [-1, 1]) {
    const z = zc + s * (half - 0.35);
    ctx.solid.box(x0, z - 0.2, x1, z + 0.2, 0, 1.05, C.concrete, PLAIN, C.concrete);
    ctx.collider(x0, z - 0.2, x1, z + 0.2, 0, 1.05);
  }
  if (ctx.lod <= 2) for (let x = x0 + 25; x < x1; x += 50) ctx.solid.box(x - 2, zc - 7, x + 2, zc + 7, -9, -1.4, C.seawall, [STYLE.CONCRETE, 0.3, 9, 9], C.seawall);
  if (ctx.lod <= 1) for (let x = x0 + 20; x < x1; x += 40) { ctx.prop('streetlight', x, 0, zc - half + 1, Math.PI, 1); ctx.lamps.push(x, 7.6, zc - half + 3.2); }
}

export function generateCell(cx: number, cz: number, lod: number, seed: number): CellData {
  const t0 = performance.now();
  const ctx = new Ctx(lod, seed);
  const district: DistrictId = districtOfCell(cx, cz);
  genRoads(ctx, cx, cz);
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) genBlock(ctx, cx * 2 + dx, cz * 2 + dz);
  if (district === 'causeway') genCauseway(ctx, cx);

  const instances: InstanceData[] = [];
  for (const [kind, arr] of ctx.inst) instances.push({ kind, data: new Float32Array(arr) });
  const cell: CellData = {
    cx, cz, lod, district,
    solid: ctx.solid.build(),
    flat: ctx.flat === ctx.solid ? null : ctx.flat.build(),
    instances,
    colliders: new Float32Array(ctx.colliders),
    parking: new Float32Array(ctx.parking),
    sidewalks: new Float32Array(ctx.sidewalks),
    lamps: new Float32Array(ctx.lamps),
    pois: ctx.pois,
    buildingCount: ctx.buildings,
    bytes: 0,
    generationMs: 0,
  };
  cell.bytes = cellBytes(cell);
  cell.generationMs = performance.now() - t0;
  return cell;
}
