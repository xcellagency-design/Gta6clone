import * as THREE from 'three';
import { createCityMaterial, type CityMaterialHandle } from '../render/CityMaterial';
import { PROP_CASTS_SHADOW, propGeometry } from '../render/Props';
import { INSTANCE_STRIDE, type CellData, type MeshData } from './CellData';
import type { StreamView } from './StreamingManager';

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(m.uvs, 2));
  g.setAttribute('aParams', new THREE.BufferAttribute(m.params, 4));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * The scene objects of one cell at one LOD. Built in steps so the streaming manager can spread
 * the work across frames; `fade` drives the dithered cross-fade.
 */
export class CellView implements StreamView {
  readonly group = new THREE.Group();
  private handles: CityMaterialHandle[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private step = 0;
  fade = 0;
  triangles = 0;
  drawCalls = 0;

  constructor(readonly data: CellData, private shadows: boolean, private parent: THREE.Object3D) {
    this.group.name = `cell_${data.cx}_${data.cz}_lod${data.lod}`;
    this.group.matrixAutoUpdate = false;
  }

  /** Performs one unit of instantiation work. Returns true when the view is complete. */
  buildStep(): boolean {
    const d = this.data;
    const s = this.step++;
    if (s === 0) {
      if (d.flat) this.addMesh(d.flat, false, true);
      return false;
    }
    if (s === 1) {
      if (d.solid) this.addMesh(d.solid, this.shadows && d.lod <= 1, true);
      return false;
    }
    const idx = s - 2;
    if (idx < d.instances.length) {
      const inst = d.instances[idx];
      const n = inst.data.length / INSTANCE_STRIDE;
      const h = createCityMaterial({ instanced: true, doubleSide: inst.kind === 'palm' || inst.kind === 'umbrella' });
      const mesh = new THREE.InstancedMesh(propGeometry(inst.kind), h.material, n);
      for (let i = 0; i < n; i++) {
        const o = i * INSTANCE_STRIDE;
        dummy.position.set(inst.data[o], inst.data[o + 1], inst.data[o + 2]);
        dummy.rotation.set(0, inst.data[o + 3], 0);
        dummy.scale.setScalar(inst.data[o + 4]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.setRGB(inst.data[o + 5], inst.data[o + 6], inst.data[o + 7]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows && d.lod === 0 && !!PROP_CASTS_SHADOW[inst.kind];
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      this.handles.push(h);
      this.group.add(mesh);
      this.drawCalls++;
      this.triangles += (propGeometry(inst.kind).getAttribute('position').count / 3) * n;
      return idx + 1 >= d.instances.length;
    }
    return true;
  }

  private addMesh(m: MeshData, cast: boolean, receive: boolean): void {
    const g = toGeometry(m);
    const h = createCityMaterial();
    const mesh = new THREE.Mesh(g, h.material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    this.handles.push(h);
    this.geometries.push(g);
    this.group.add(mesh);
    this.drawCalls++;
    this.triangles += m.indices.length / 3;
  }

  attach(): void {
    this.parent.add(this.group);
  }

  setFade(f: number): void {
    this.fade = f;
    for (const h of this.handles) h.fade.value = f;
    this.group.visible = f > 0.001;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const h of this.handles) h.material.dispose();
    for (const c of this.group.children) if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
    this.handles = [];
    this.geometries = [];
  }
}
