import * as THREE from 'three';
import { BLOCK, nodeInfo, signalState } from '../world/CityPlan';

const RED = new THREE.Color(2.4, 0.12, 0.08), AMBER = new THREE.Color(2.4, 1.3, 0.1), GREEN = new THREE.Color(0.15, 2.2, 0.5), OFF = new THREE.Color(0.03, 0.03, 0.03);
const CAP = 1200;
const m = new THREE.Matrix4();

/**
 * The lit lenses of nearby traffic signals. Their state comes from the same shared clock the
 * traffic simulation reads, so what the player sees is what the drivers obey.
 */
export class TrafficLightRenderer {
  readonly mesh: THREE.InstancedMesh;

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, OFF);
  }

  update(cx: number, cz: number, time: number): void {
    const kx0 = Math.round(cx / BLOCK), kz0 = Math.round(cz / BLOCK);
    let n = 0;
    for (let kz = kz0 - 3; kz <= kz0 + 3; kz++) {
      for (let kx = kx0 - 3; kx <= kx0 + 3; kx++) {
        const node = nodeInfo(kx, kz);
        if (!node.signal) continue;
        const s = signalState(kx, kz, time);
        const x = kx * BLOCK, z = kz * BLOCK, ox = node.halfX + 1.2, oz = node.halfZ + 1.2;
        const poles: [number, number, number][] = [[x + ox, z + oz, 0], [x - ox, z - oz, Math.PI], [x + ox, z - oz, Math.PI / 2], [x - ox, z + oz, -Math.PI / 2]];
        for (const [px, pz, rot] of poles) {
          const sr = Math.sin(rot), cr = Math.cos(rot);
          // Head 1 faces local +z, head 2 faces local +x (see Props.trafficlight).
          for (let head = 0; head < 2; head++) {
            const lx = head ? 0.4 : 0, lz = head ? 0 : 0.4;
            const wx = px + lx * cr + lz * sr, wz = pz - lx * sr + lz * cr;
            const facesNS = (head === 0) === (Math.abs(sr) < 0.5);
            const green = facesNS ? s.nsGreen : s.ewGreen;
            const amber = green && s.yellow;
            const cols = [!green ? RED : OFF, amber ? AMBER : OFF, green && !amber ? GREEN : OFF];
            for (let l = 0; l < 3 && n < CAP; l++) {
              m.makeTranslation(wx, 0.15 + 5.22 - l * 0.32, wz);
              this.mesh.setMatrixAt(n, m);
              this.mesh.setColorAt(n, cols[l]);
              n++;
            }
          }
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
