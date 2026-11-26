import type { MeshData } from './CellData';

export type RGB = readonly [number, number, number];
export type Params = readonly [number, number, number, number];

/** sRGB hex colour to linear RGB, the space vertex colours are stored in. */
export function hex(c: number): RGB {
  const f = (v: number) => Math.pow(v / 255, 2.2);
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
}

export function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const PLAIN: Params = [0, 0, 0.85, 0];

/** Accumulates quads into one indexed triangle mesh. */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private par: number[] = [];
  private idx: number[] = [];
  private n = 0;

  get vertexCount(): number {
    return this.n;
  }

  /** Corners counter-clockwise seen from the front. UVs: a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1). */
  quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    u0: number, v0: number, u1: number, v1: number, color: RGB, p: Params,
  ): void {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = dx - ax, e2y = dy - ay, e2z = dz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let i = 0; i < 4; i++) {
      this.nor.push(nx, ny, nz);
      this.col.push(color[0], color[1], color[2]);
      this.par.push(p[0], p[1], p[2], p[3]);
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }

  /** Upward-facing rectangle. UVs are world metres unless `uv` is given. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB, p: Params, uv?: readonly [number, number, number, number]): void {
    if (x1 - x0 <= 0.001 || z1 - z0 <= 0.001) return;
    const u = uv ?? [x0, z1, x1, z0];
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, u[0], u[1], u[2], u[3], color, p);
  }

  /** The four walls of an axis-aligned box. v runs from `vBase` at y0. */
  walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: RGB, p: Params, vBase = 0): void {
    const h = y1 - y0;
    const w = x1 - x0, d = z1 - z0;
    let u = 0;
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, u, vBase, u + w, vBase + h, color, p); u += w;
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, u, vBase, u + d, vBase + h, color, p); u += d;
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, u, vBase, u + w, vBase + h, color, p); u += w;
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, u, vBase, u + d, vBase + h, color, p);
  }

  /** Axis-aligned box: walls plus a roof. */
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: RGB, wp: Params, roof: RGB, rp: Params = PLAIN, vBase = 0): void {
    this.walls(x0, z0, x1, z1, y0, y1, wall, wp, vBase);
    this.flat(x0, z0, x1, z1, y1, roof, rp);
  }

  /** A box rotated about the vertical axis, centred at (cx, cz), resting on y0. */
  boxRot(cx: number, cz: number, sx: number, sz: number, y0: number, y1: number, rot: number, color: RGB, p: Params, top: RGB = color): void {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = sx / 2, hz = sz / 2;
    const corner = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const sw = corner(-hx, hz), se = corner(hx, hz), ne = corner(hx, -hz), nw = corner(-hx, -hz);
    const h = y1 - y0;
    const side = (a: [number, number], b: [number, number], len: number, u: number) =>
      this.quad(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1], u, 0, u + len, h, color, p);
    side(sw, se, sx, 0); side(se, ne, sz, sx); side(ne, nw, sx, sx + sz); side(nw, sw, sz, 2 * sx + sz);
    this.quad(sw[0], y1, sw[1], se[0], y1, se[1], ne[0], y1, ne[1], nw[0], y1, nw[1], 0, 0, sx, sz, top, PLAIN);
  }

  /** A pitched roof over an axis-aligned rectangle. The ridge runs along x when `alongX`. */
  gable(x0: number, z0: number, x1: number, z1: number, y0: number, rise: number, alongX: boolean, roof: RGB, wall: RGB, wp: Params): void {
    const y1 = y0 + rise;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      this.quad(x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y1, zm, 0, 0, x1 - x0, 1, roof, PLAIN);
      this.quad(x1, y0, z0, x0, y0, z0, x0, y1, zm, x1, y1, zm, 0, 0, x1 - x0, 1, roof, PLAIN);
      this.quad(x1, y0, z1, x1, y0, z0, x1, y1, zm, x1, y1, zm, 0, 0, z1 - z0, rise, wall, wp);
      this.quad(x0, y0, z0, x0, y0, z1, x0, y1, zm, x0, y1, zm, 0, 0, z1 - z0, rise, wall, wp);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad(x1, y0, z1, x1, y0, z0, xm, y1, z0, xm, y1, z1, 0, 0, z1 - z0, 1, roof, PLAIN);
      this.quad(x0, y0, z0, x0, y0, z1, xm, y1, z1, xm, y1, z0, 0, 0, z1 - z0, 1, roof, PLAIN);
      this.quad(x0, y0, z1, x1, y0, z1, xm, y1, z1, xm, y1, z1, 0, 0, x1 - x0, rise, wall, wp);
      this.quad(x1, y0, z0, x0, y0, z0, xm, y1, z0, xm, y1, z0, 0, 0, x1 - x0, rise, wall, wp);
    }
  }

  build(): MeshData | null {
    if (!this.n) return null;
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col),
      params: new Float32Array(this.par),
      indices: new Uint32Array(this.idx),
    };
  }
}
