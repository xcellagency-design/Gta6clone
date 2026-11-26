/**
 * What a streamed cell is made of. Produced by the generator (in a worker), transferred to the
 * main thread as typed arrays, cached, and turned into GPU buffers and physics colliders there.
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Surface coordinates in metres (walls: along, up; roads: across, along). */
  uvs: Float32Array;
  /** Linear RGB per vertex. */
  colors: Float32Array;
  /** Per-vertex style parameters for the city shader: style id, seed, p2, p3. */
  params: Float32Array;
  indices: Uint32Array;
}

export type PropKind = 'streetlight' | 'palm' | 'tree' | 'trafficlight' | 'hydrant' | 'bench' | 'umbrella' | 'boat' | 'crane' | 'bush';

export interface InstanceData {
  kind: PropKind;
  /** x, y, z, rotationY, scale, r, g, b  (8 floats per instance). */
  data: Float32Array;
}

export const INSTANCE_STRIDE = 8;
export const COLLIDER_STRIDE = 7;
export const PARKING_STRIDE = 4;
export const RING_STRIDE = 4;

export type PoiType =
  | 'safehouse' | 'shop' | 'restaurant' | 'garage' | 'clothing' | 'dealership' | 'business' | 'fuel' | 'venue';

export interface PoiDef {
  id: string;
  type: PoiType;
  name: string;
  x: number;
  z: number;
  /** Direction the entrance faces, radians. */
  heading: number;
  district: string;
}

export interface CellData {
  cx: number;
  cz: number;
  lod: number;
  district: string;
  /** Buildings and other shadow-casting volumes. */
  solid: MeshData | null;
  /** Roads and ground. */
  flat: MeshData | null;
  instances: InstanceData[];
  /** cx, cy, cz, hx, hy, hz, rotY per static box collider (LOD 0 only). */
  colliders: Float32Array;
  /** x, z, heading, profile index per parked-vehicle slot (LOD 0 only). */
  parking: Float32Array;
  /** x0, z0, x1, z1 per sidewalk ring: the pedestrian navigation data of the cell. */
  sidewalks: Float32Array;
  /** x, y, z of each street lamp, for night glow. */
  lamps: Float32Array;
  pois: PoiDef[];
  buildingCount: number;
  bytes: number;
  generationMs: number;
}

export function meshBytes(m: MeshData | null): number {
  if (!m) return 0;
  return m.positions.byteLength + m.normals.byteLength + m.uvs.byteLength + m.colors.byteLength + m.params.byteLength + m.indices.byteLength;
}

export function cellBytes(c: CellData): number {
  let b = meshBytes(c.solid) + meshBytes(c.flat) + c.colliders.byteLength + c.parking.byteLength + c.sidewalks.byteLength + c.lamps.byteLength;
  for (const i of c.instances) b += i.data.byteLength;
  return b + 512;
}

/** Buffers that can be moved between threads without copying. */
export function cellTransferables(c: CellData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike }) => out.push(a.buffer as ArrayBuffer);
  for (const m of [c.solid, c.flat]) {
    if (!m) continue;
    add(m.positions); add(m.normals); add(m.uvs); add(m.colors); add(m.params); add(m.indices);
  }
  for (const i of c.instances) add(i.data);
  add(c.colliders); add(c.parking); add(c.sidewalks); add(c.lamps);
  return out;
}
