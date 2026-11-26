import * as THREE from 'three';

export type CharacterAnim = 'stand' | 'crouch' | 'sit' | 'swim' | 'air' | 'phone' | 'talk' | 'cower';

export interface CharacterPose {
  x: number; y: number; z: number;
  heading: number;
  /** Walk-cycle phase in radians. */
  stride: number;
  speed: number;
  anim: CharacterAnim;
  shirt: number; pants: number; skin: number;
  scale: number;
}

const PARTS = 13;
const root = new THREE.Matrix4();
const pelvis = new THREE.Matrix4();
const a = new THREE.Matrix4();
const b = new THREE.Matrix4();
const c = new THREE.Matrix4();
const out = new THREE.Matrix4();
const col = new THREE.Color();
const SHOE = 0x1c1a19;

/**
 * Every character in the world — player and NPCs — drawn as one instanced mesh of capsules,
 * posed procedurally each frame. Placeholder figures: articulated, animated, not sculpted.
 */
export class CharacterRenderer {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private cap: number;

  constructor(maxCharacters: number, shadows: boolean) {
    this.cap = maxCharacters * PARTS;
    const geo = new THREE.CapsuleGeometry(0.5, 1, 4, 10);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, col.set(0xffffff));
  }

  begin(): void {
    this.n = 0;
  }

  private put(parent: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    if (this.n >= this.cap) return;
    a.makeTranslation(x, y, z);
    b.makeScale(sx, sy, sz);
    out.multiplyMatrices(parent, a).multiply(b);
    this.mesh.setMatrixAt(this.n, out);
    this.mesh.setColorAt(this.n, col.set(color));
    this.n++;
  }

  /** A two-segment limb hanging from `joint`: swing the upper part by `up`, bend the lower by `low`. */
  private limb(parent: THREE.Matrix4, jx: number, jy: number, up: number, low: number, splay: number, l1: number, l2: number, t1: number, t2: number, c1: number, c2: number, foot: boolean): void {
    a.makeTranslation(jx, jy, 0);
    b.makeRotationX(-up);
    c.multiplyMatrices(parent, a).multiply(b);
    if (splay) c.multiply(b.makeRotationZ(splay));
    const upper = c.clone();
    this.put(upper, 0, -l1 / 2, 0, t1, l1 / 2, t1, c1);
    a.makeTranslation(0, -l1, 0);
    b.makeRotationX(low);
    const lower = upper.multiply(a).multiply(b);
    this.put(lower, 0, -l2 / 2, 0, t2, l2 / 2, t2, c2);
    if (foot) this.put(lower, 0, -l2 - 0.02, 0.07, 0.1, 0.05, 0.25, SHOE);
  }

  add(p: CharacterPose): void {
    const s = p.scale;
    const moving = p.speed > 0.25;
    const A = moving ? Math.min(0.95, 0.18 + p.speed * 0.13) : 0;
    const ph = p.stride;
    const sw = Math.sin(ph) * A;
    let hip = 0.93, lean = moving ? Math.min(0.28, p.speed * 0.03) : 0, pitch = 0;
    let thL = sw, thR = -sw;
    let knL = Math.max(0, Math.sin(ph - 1.9)) * A * 1.5 + 0.05, knR = Math.max(0, Math.sin(ph - 1.9 + Math.PI)) * A * 1.5 + 0.05;
    let arL = -sw * 0.85, arR = sw * 0.85;
    let elL = 0.2 + A * 0.7, elR = 0.2 + A * 0.7;
    let bob = Math.abs(Math.sin(ph)) * 0.035 * A;
    let splay = 0.07;
    switch (p.anim) {
      case 'crouch': hip = 0.62; lean = 0.5; thL += 1.15; thR += 1.15; knL += 1.9; knR += 1.9; elL = 1.3; elR = 1.3; break;
      case 'sit': hip = 0.95; lean = -0.12; thL = thR = 1.42; knL = knR = 1.3; arL = arR = 1.05; elL = elR = 0.45; bob = 0; break;
      case 'swim': pitch = 1.3; hip = 0.5; thL = Math.sin(ph * 2) * 0.35; thR = -thL; knL = knR = 0.2; arL = 2.6 + Math.sin(ph) * 0.8; arR = 2.6 - Math.sin(ph) * 0.8; elL = elR = 0.3; break;
      case 'air': thL = 0.5; thR = -0.15; knL = 0.9; knR = 0.5; arL = arR = -0.5; splay = 0.6; break;
      case 'phone': arR = 0.9; elR = 2.1; break;
      case 'talk': arL = 0.4 + Math.sin(ph * 3) * 0.15; elL = 1.2; break;
      case 'cower': hip = 0.6; lean = 0.7; thL = thR = 1.2; knL = knR = 2.0; arL = arR = 2.6; elL = elR = 1.6; break;
    }
    root.makeTranslation(p.x, p.y, p.z);
    root.multiply(a.makeRotationY(p.heading));
    if (pitch) root.multiply(a.makeRotationX(pitch));
    if (s !== 1) root.multiply(a.makeScale(s, s, s));
    const legs = root.clone().multiply(a.makeTranslation(0, hip + bob, 0));
    pelvis.copy(legs).multiply(a.makeRotationX(lean));
    this.put(pelvis, 0, 0.3, 0, 0.37, 0.29, 0.23, p.shirt);
    this.put(pelvis, 0, 0.02, 0, 0.33, 0.11, 0.22, p.pants);
    this.put(pelvis, 0, 0.74, 0.015, 0.2, 0.125, 0.22, p.skin);
    this.limb(legs, 0.1, 0, thL, knL, 0, 0.45, 0.42, 0.14, 0.11, p.pants, p.pants, true);
    this.limb(legs, -0.1, 0, thR, knR, 0, 0.45, 0.42, 0.14, 0.11, p.pants, p.pants, true);
    this.limb(pelvis, 0.235, 0.5, arL, -elL, splay, 0.3, 0.28, 0.1, 0.085, p.shirt, p.skin, false);
    this.limb(pelvis, -0.235, 0.5, arR, -elR, -splay, 0.3, 0.28, 0.1, 0.085, p.shirt, p.skin, false);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get count(): number {
    return this.n / PARTS;
  }
}
