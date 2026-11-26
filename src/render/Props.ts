import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropKind } from '../streaming/CellData';
import { STYLE } from '../streaming/styles';

/** Procedural models for street furniture and vegetation. One merged geometry per kind, instanced. */

export interface Part {
  /** Keep this part's own colour when the instance is tinted (glass, tyres, lamps). */
  noTint?: boolean;
  geo: THREE.BufferGeometry;
  color: number;
  style?: number;
  rough?: number;
  metal?: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

const tmpColor = new THREE.Color();

export function buildParts(parts: Part[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(p.pos ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    tmpColor.setHex(p.color, THREE.SRGBColorSpace);
    const col = new Float32Array(n * 3);
    const par = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
      par.set([p.style ?? STYLE.PLAIN, p.noTint ? -1 : 0, p.rough ?? 0.8, p.metal ?? 0], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(par, 4));
    g.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false)!;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (r0: number, r1: number, h: number, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg);

function streetlight(): THREE.BufferGeometry {
  return buildParts([
    { geo: cyl(0.07, 0.11, 7.6, 6), color: 0x4a4f55, metal: 0.6, rough: 0.5, pos: [0, 3.8, 0] },
    { geo: box(0.1, 0.1, 2.4), color: 0x4a4f55, metal: 0.6, rough: 0.5, pos: [0, 7.6, 1.1] },
    { geo: box(0.34, 0.14, 0.8), color: 0x3a3d42, metal: 0.5, pos: [0, 7.58, 2.2] },
    { geo: box(0.26, 0.04, 0.66), color: 0xffe2a8, style: STYLE.LAMP, pos: [0, 7.49, 2.2] },
  ]);
}

function palm(): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: cyl(0.14, 0.22, 4.2, 6), color: 0x7a6248, rough: 0.95, pos: [0.05, 2.1, 0], rot: [0, 0, -0.04] },
    { geo: cyl(0.11, 0.14, 4.2, 6), color: 0x846b4e, rough: 0.95, pos: [0.3, 6.2, 0], rot: [0, 0, -0.09] },
  ];
  const top: [number, number, number] = [0.5, 8.3, 0];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
    const droop = 0.35 + (i % 3) * 0.16;
    const len = 3.1 + (i % 2) * 0.5;
    parts.push({
      geo: new THREE.ConeGeometry(0.5, len, 4, 1),
      color: i % 2 ? 0x3f7a35 : 0x4d8a3c,
      rough: 0.85,
      scale: [1, 1, 0.12],
      rot: [0, -a, -(Math.PI / 2) - droop],
      pos: [top[0] + Math.cos(a) * len * 0.45 * Math.cos(droop), top[1] - Math.sin(droop) * len * 0.45, top[2] + Math.sin(a) * len * 0.45 * Math.cos(droop)],
    });
  }
  parts.push({ geo: new THREE.IcosahedronGeometry(0.35, 0), color: 0x6b5a3a, pos: top });
  return buildParts(parts);
}

function tree(): THREE.BufferGeometry {
  return buildParts([
    { geo: cyl(0.16, 0.26, 3, 6), color: 0x5a4632, rough: 0.95, pos: [0, 1.5, 0] },
    { geo: new THREE.IcosahedronGeometry(2.1, 1), color: 0x3f6d33, rough: 0.9, pos: [0, 4.4, 0], scale: [1, 0.85, 1] },
    { geo: new THREE.IcosahedronGeometry(1.5, 1), color: 0x4a7a3a, rough: 0.9, pos: [1.1, 5.3, 0.5] },
    { geo: new THREE.IcosahedronGeometry(1.4, 1), color: 0x37622e, rough: 0.9, pos: [-0.9, 5.0, -0.7] },
  ]);
}

function bush(): THREE.BufferGeometry {
  return buildParts([{ geo: new THREE.IcosahedronGeometry(0.9, 1), color: 0x3d6b34, rough: 0.9, pos: [0, 0.6, 0], scale: [1.2, 0.75, 1] }]);
}

function trafficlight(): THREE.BufferGeometry {
  return buildParts([
    { geo: cyl(0.09, 0.12, 5.6, 6), color: 0x33373c, metal: 0.5, pos: [0, 2.8, 0] },
    { geo: box(0.36, 1.05, 0.3), color: 0x1c1e21, pos: [0, 4.9, 0.22] },
    { geo: box(0.36, 1.05, 0.3), color: 0x1c1e21, pos: [0.22, 4.9, 0], rot: [0, Math.PI / 2, 0] },
  ]);
}

function hydrant(): THREE.BufferGeometry {
  return buildParts([
    { geo: cyl(0.13, 0.16, 0.6, 8), color: 0xb5332a, pos: [0, 0.3, 0] },
    { geo: new THREE.SphereGeometry(0.14, 8, 6), color: 0xb5332a, pos: [0, 0.62, 0] },
    { geo: cyl(0.05, 0.05, 0.42, 6), color: 0x9a9a9a, metal: 0.7, pos: [0, 0.42, 0], rot: [0, 0, Math.PI / 2] },
  ]);
}

function bench(): THREE.BufferGeometry {
  return buildParts([
    { geo: box(1.7, 0.07, 0.5), color: 0x7a5a3c, pos: [0, 0.46, 0] },
    { geo: box(1.7, 0.45, 0.06), color: 0x7a5a3c, pos: [0, 0.75, -0.24], rot: [-0.15, 0, 0] },
    { geo: box(0.07, 0.46, 0.46), color: 0x2f3236, metal: 0.5, pos: [-0.75, 0.23, 0] },
    { geo: box(0.07, 0.46, 0.46), color: 0x2f3236, metal: 0.5, pos: [0.75, 0.23, 0] },
  ]);
}

function umbrella(): THREE.BufferGeometry {
  return buildParts([
    { geo: cyl(0.03, 0.03, 2.2, 5), color: 0xd0d0d0, pos: [0, 1.1, 0] },
    { geo: new THREE.ConeGeometry(1.5, 0.55, 10, 1, true), color: 0xffffff, pos: [0, 2.3, 0] },
    { geo: box(0.7, 0.08, 1.9), color: 0xe8e2d4, pos: [0.9, 0.3, 0.2] },
  ]);
}

function boat(): THREE.BufferGeometry {
  const hull = new THREE.SphereGeometry(1, 12, 8);
  return buildParts([
    { geo: hull, color: 0xffffff, rough: 0.35, scale: [3.6, 0.9, 1.25], pos: [0, 0.45, 0] },
    { geo: box(2.4, 0.9, 1.5), color: 0xf2f2f2, rough: 0.4, pos: [-0.5, 1.5, 0] },
    { geo: box(1.9, 0.5, 1.3), color: 0x22303a, rough: 0.1, metal: 0.6, pos: [-0.3, 1.7, 0] },
    { geo: box(3.8, 0.08, 1.9), color: 0x9a7650, pos: [0.2, 1.08, 0] },
  ]);
}

function crane(): THREE.BufferGeometry {
  return buildParts([
    { geo: box(1.6, 36, 1.6), color: 0xffffff, style: STYLE.FRAME, pos: [0, 18, 0] },
    { geo: box(44, 1.3, 1.3), color: 0xffffff, style: STYLE.FRAME, pos: [13, 36.6, 0] },
    { geo: box(2.6, 2.4, 2.2), color: 0xf2f2f2, pos: [0.8, 35, 1.3] },
    { geo: box(5, 2.2, 2), color: 0x6a6a6a, pos: [-7, 36, 0] },
    { geo: box(0.12, 14, 0.12), color: 0x222222, pos: [24, 29.5, 0] },
    { geo: box(3, 3, 3), color: 0x8c8c8c, style: STYLE.CONCRETE, pos: [0, 1.5, 0] },
  ]);
}

const BUILDERS: Record<PropKind, () => THREE.BufferGeometry> = {
  streetlight, palm, tree, trafficlight, hydrant, bench, umbrella, boat, crane, bush,
};

const cache = new Map<PropKind, THREE.BufferGeometry>();

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  let g = cache.get(kind);
  if (!g) cache.set(kind, (g = BUILDERS[kind]()));
  return g;
}

/** Kinds that sway in the wind and cast soft shadows. */
export const PROP_CASTS_SHADOW: Partial<Record<PropKind, boolean>> = { palm: true, tree: true, crane: true, boat: true };
