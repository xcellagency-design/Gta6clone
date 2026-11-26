import * as THREE from 'three';
import { buildParts, type Part } from '../render/Props';
import { STYLE } from '../streaming/styles';
import type { VehicleProfile } from './VehicleProfile';

/**
 * Procedural vehicle bodies. Origin is the chassis centre (ride height above the road), +z is
 * forward. Painted panels are white so the instance colour tints them; glass, tyres, trim and
 * lamps keep their own colours. These are placeholder models built from extruded profiles.
 */

const GLASS = 0x10181f;
const TRIM = 0x17181a;
const CLEARANCE = 0.26;

/** Extrude a side profile (z forward, y up) across the vehicle's width. */
function slab(points: [number, number][], width: number, bevel = 0.06): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1, curveSegments: 4,
  });
  // Shape x → vehicle z, extrusion → vehicle x.
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g;
}

const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

function lamps(p: VehicleProfile, y: number, hw: number, front: number, rear: number, parts: Part[]): void {
  for (const s of [-1, 1]) {
    parts.push({ geo: box(0.36, 0.14, 0.06), color: 0xfff2cf, style: STYLE.LAMP, noTint: true, pos: [s * (hw - 0.32), y, front] });
    parts.push({ geo: box(0.34, 0.12, 0.06), color: 0xff1a12, style: STYLE.LAMP, noTint: true, pos: [s * (hw - 0.3), y + 0.04, rear] });
  }
  parts.push({ geo: box(p.width * 0.5, 0.16, 0.05), color: TRIM, noTint: true, rough: 0.5, pos: [0, y - 0.22, front + 0.01] });
}

function car(p: VehicleProfile, o: { hood: number; trunk: number; rake: number; rearRake: number; belt: number }): Part[] {
  const b0 = CLEARANCE - p.rideHeight, top = p.height - p.rideHeight;
  const L = p.length / 2, hw = p.width / 2;
  const belt = b0 + (top - b0) * o.belt;
  const cabF = L - o.hood, cabR = -L + o.trunk;
  const parts: Part[] = [];
  parts.push({
    geo: slab([[-L + 0.08, b0], [L - 0.2, b0], [L, b0 + 0.22], [L - 0.04, belt - 0.14], [cabF + 0.1, belt], [cabR - 0.05, belt], [-L, belt - 0.08], [-L - 0.02, b0 + 0.24]], p.width),
    color: 0xffffff, rough: 0.28, metal: 0.55,
  });
  parts.push({
    geo: slab([[cabR, belt - 0.02], [cabF, belt - 0.02], [cabF - o.rake, top - 0.04], [cabR + o.rearRake, top - 0.04]], p.width - 0.22, 0.05),
    color: GLASS, noTint: true, rough: 0.06, metal: 0.75,
  });
  parts.push({ geo: box(p.width - 0.34, 0.06, cabF - o.rake - (cabR + o.rearRake) + 0.1), color: 0xffffff, rough: 0.28, metal: 0.55, pos: [0, top - 0.02, (cabF - o.rake + cabR + o.rearRake) / 2] });
  // Pillars.
  for (const s of [-1, 1]) parts.push({ geo: box(0.07, top - belt, 0.12), color: 0xffffff, rough: 0.3, metal: 0.5, pos: [s * (hw - 0.13), (top + belt) / 2, (cabF + cabR) / 2 - 0.1] });
  parts.push({ geo: box(p.width + 0.02, 0.2, p.length - 0.3), color: TRIM, noTint: true, rough: 0.7, pos: [0, b0 + 0.08, 0] });
  lamps(p, belt - 0.2, hw, L - 0.01, -L, parts);
  return parts;
}

function truck(p: VehicleProfile): Part[] {
  const b0 = CLEARANCE - p.rideHeight + 0.3, top = p.height - p.rideHeight;
  const L = p.length / 2, hw = p.width / 2;
  const cabR = L - 2.3;
  const parts: Part[] = [];
  parts.push({ geo: slab([[cabR, b0], [L, b0], [L, b0 + 0.9], [L - 0.25, top - 0.7], [L - 0.7, top], [cabR, top]], p.width, 0.07), color: 0xffffff, rough: 0.32, metal: 0.5 });
  parts.push({ geo: box(p.width - 0.3, 0.62, 0.06), color: GLASS, noTint: true, rough: 0.06, metal: 0.75, pos: [0, top - 0.52, L - 0.36], rot: [-0.42, 0, 0] });
  for (const s of [-1, 1]) parts.push({ geo: box(0.05, 0.55, 0.9), color: GLASS, noTint: true, rough: 0.06, metal: 0.75, pos: [s * (hw + 0.001), top - 0.52, cabR + 1.05] });
  // Chassis rails and flatbed.
  parts.push({ geo: box(p.width * 0.5, 0.3, p.length - 0.3), color: TRIM, noTint: true, pos: [0, b0 - 0.05, 0] });
  parts.push({ geo: box(p.width, 0.14, p.length - 2.5), color: 0x5b5f63, noTint: true, rough: 0.7, metal: 0.4, pos: [0, b0 + 0.38, -1.2] });
  parts.push({ geo: box(p.width, 0.8, 0.1), color: 0x6a6e72, noTint: true, metal: 0.4, pos: [0, b0 + 0.8, cabR - 0.08] });
  for (const s of [-1, 1]) parts.push({ geo: box(0.07, 0.34, p.length - 2.5), color: 0x6a6e72, noTint: true, metal: 0.4, pos: [s * (hw - 0.04), b0 + 0.6, -1.2] });
  lamps(p, b0 + 0.55, hw, L, -L, parts);
  return parts;
}

function motorcycle(p: VehicleProfile): Part[] {
  const y0 = -p.rideHeight;
  return [
    { geo: box(0.3, 0.26, 0.62), color: 0xffffff, rough: 0.25, metal: 0.6, pos: [0, y0 + 0.86, 0.14] },
    { geo: box(0.3, 0.1, 0.62), color: 0x121212, noTint: true, rough: 0.9, pos: [0, y0 + 0.8, -0.42] },
    { geo: box(0.36, 0.34, 0.5), color: 0x4a4d52, noTint: true, metal: 0.8, rough: 0.4, pos: [0, y0 + 0.5, 0.02] },
    { geo: box(0.07, 0.72, 0.07), color: 0x9a9da3, noTint: true, metal: 0.9, rough: 0.3, pos: [0, y0 + 0.7, 0.68], rot: [0.42, 0, 0] },
    { geo: box(0.66, 0.05, 0.05), color: 0x1a1a1a, noTint: true, pos: [0, y0 + 1.05, 0.56] },
    { geo: box(0.24, 0.16, 0.34), color: 0xffffff, rough: 0.25, metal: 0.6, pos: [0, y0 + 0.74, -0.78] },
    { geo: box(0.1, 0.1, 0.5), color: 0x8a8d92, noTint: true, metal: 0.9, pos: [0.17, y0 + 0.36, -0.5] },
    { geo: box(0.16, 0.14, 0.05), color: 0xfff2cf, style: STYLE.LAMP, noTint: true, pos: [0, y0 + 0.95, 0.83] },
    { geo: box(0.14, 0.07, 0.04), color: 0xff1a12, style: STYLE.LAMP, noTint: true, pos: [0, y0 + 0.78, -0.96] },
  ];
}

function boat(p: VehicleProfile): Part[] {
  const L = p.length / 2;
  return [
    { geo: slab([[-L, -0.55], [L - 1.6, -0.55], [L, 0.35], [L - 0.2, 0.5], [-L, 0.5]], p.width, 0.12), color: 0xffffff, rough: 0.3, metal: 0.2 },
    { geo: box(p.width - 0.3, 0.06, p.length - 1.4), color: 0x9a7650, noTint: true, rough: 0.8, pos: [0, 0.52, -0.5] },
    { geo: box(p.width - 0.7, 0.55, 0.08), color: GLASS, noTint: true, rough: 0.06, metal: 0.7, pos: [0, 0.86, 0.6], rot: [-0.5, 0, 0] },
    { geo: box(p.width - 0.9, 0.5, 0.5), color: 0xf2f2f2, noTint: true, pos: [0, 0.72, 0.25] },
    { geo: box(1.2, 0.4, 0.5), color: 0xe9e2d0, noTint: true, pos: [0, 0.7, -1.4] },
    { geo: box(0.4, 0.9, 0.5), color: 0x202327, noTint: true, metal: 0.5, pos: [0, 0.1, -L - 0.2] },
  ];
}

export function buildVehicleGeometry(p: VehicleProfile): THREE.BufferGeometry {
  let parts: Part[];
  switch (p.class) {
    case 'suv': parts = car(p, { hood: 1.25, trunk: 0.25, rake: 0.5, rearRake: 0.22, belt: 0.56 }); break;
    case 'sports': parts = car(p, { hood: 1.45, trunk: 0.75, rake: 0.85, rearRake: 0.95, belt: 0.58 }); break;
    case 'truck': parts = truck(p); break;
    case 'motorcycle': parts = motorcycle(p); break;
    case 'boat': parts = boat(p); break;
    default: parts = car(p, { hood: 1.25, trunk: 0.85, rake: 0.7, rearRake: 0.75, belt: 0.55 });
  }
  if (p.id === 'police') {
    const top = p.height - p.rideHeight;
    parts.push({ geo: box(0.5, 0.12, 0.26), color: 0xff2020, style: STYLE.GLOW, noTint: true, pos: [-0.3, top + 0.08, -0.1] });
    parts.push({ geo: box(0.5, 0.12, 0.26), color: 0x2050ff, style: STYLE.GLOW, noTint: true, pos: [0.3, top + 0.08, -0.1] });
    parts.push({ geo: box(p.width + 0.03, 0.34, 1.9), color: 0x14161a, noTint: true, rough: 0.3, metal: 0.5, pos: [0, 0.02, -0.1] });
  }
  return buildParts(parts);
}

/** Unit wheel: radius 1, width 1, axle along x. Scaled per vehicle. */
export function buildWheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.58, 0.58, 1.04, 10).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(1.06, 0.22, 1.1);
  return buildParts([
    { geo: tyre, color: 0x101011, rough: 0.92 },
    { geo: hub, color: 0xa9adb3, rough: 0.35, metal: 0.9 },
    { geo: spoke, color: 0x2a2c30, rough: 0.5, metal: 0.6 },
  ]);
}
