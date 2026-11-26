import * as THREE from 'three';
import type { GameSim } from '../core/GameSim';
import { POI_COLOR } from '../ui/MapView';
import { allPois } from '../world/Pois';

const CAP = 160;
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * World-space markers: objectives, mission givers, pickups, interactive locations and the named
 * cast. One instanced, additive draw call.
 */
export class MarkerRenderer {
  readonly mesh: THREE.InstancedMesh;
  private t = 0;

  constructor() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.setColorAt(0, c.set(0xffffff));
  }

  update(sim: GameSim, dt: number): void {
    this.t += dt;
    let n = 0;
    const put = (x: number, y: number, z: number, radius: number, height: number, color: number | string, spin = 0) => {
      if (n >= CAP) return;
      q.setFromAxisAngle(UP, spin);
      m.compose(p.set(x, y, z), q, s.set(radius, height, radius));
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, c.set(color));
      n++;
    };
    const px = sim.player.x, pz = sim.player.z;
    const pulse = 1 + 0.12 * Math.sin(this.t * 4);
    for (const t of sim.missions.targets()) {
      if (t.kind === 'pickup') { put(t.x, 0.2, t.z, 0.9 * pulse, 2.2, 0x7ad98b); continue; }
      const far = Math.hypot(t.x - px, t.z - pz);
      put(t.x, 0.05, t.z, Math.min(t.radius, 6) * 0.5, 0.6, 0xffd54a);
      // A tall beam that can be seen from across the district.
      put(t.x, 0.05, t.z, 0.5 + far * 0.004, 60 + far * 0.25, 0xffd54a);
    }
    for (const o of sim.missions.offers()) {
      if (Math.hypot(o.x - px, o.z - pz) > 900) continue;
      put(o.x, 0.1, o.z, 1.6 * pulse, 0.5, o.story ? 0xffd54a : 0x5fe0ff);
      put(o.x, 0.1, o.z, 0.35, o.story ? 46 : 26, o.story ? 0xffd54a : 0x5fe0ff);
    }
    for (const a of sim.missions.actors()) put(a.x, 2.15, a.z, 0.16, 0.5, 0xffd54a, this.t * 2);
    for (const ch of sim.characters.nearby(px, pz, 160)) put(ch.x, 2.15, ch.z, 0.14, 0.42, 0xffffff, this.t * 2);
    for (const poi of allPois()) {
      if (Math.abs(poi.x - px) > 140 || Math.abs(poi.z - pz) > 140) continue;
      put(poi.x, 0.2, poi.z, 0.7, 0.25, POI_COLOR[poi.type]);
      put(poi.x, 2.6 + 0.15 * Math.sin(this.t * 2 + poi.x), poi.z, 0.22, 0.5, POI_COLOR[poi.type], this.t);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
