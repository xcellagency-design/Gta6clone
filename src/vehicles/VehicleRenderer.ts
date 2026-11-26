import * as THREE from 'three';
import { createCityMaterial } from '../render/CityMaterial';
import type { TrafficCar } from '../traffic/TrafficSim';
import type { Vehicle } from './Vehicle';
import { buildVehicleGeometry, buildWheelGeometry } from './VehicleModels';
import { VEHICLE_PROFILES } from './VehicleProfile';

const CAP = 96;
const m = new THREE.Matrix4();
const body = new THREE.Matrix4();
const local = new THREE.Matrix4();
const q = new THREE.Quaternion();
const qs = new THREE.Quaternion();
const qr = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const col = new THREE.Color();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

/** Draws every vehicle in the world with one instanced mesh per model plus one for all wheels. */
export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private wheels: THREE.InstancedMesh;
  readonly group = new THREE.Group();

  constructor(shadows: boolean) {
    for (const p of VEHICLE_PROFILES) {
      const mesh = new THREE.InstancedMesh(buildVehicleGeometry(p), createCityMaterial({ instanced: true }).material, CAP);
      mesh.count = 0;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.set(p.id, mesh);
      this.group.add(mesh);
    }
    this.wheels = new THREE.InstancedMesh(buildWheelGeometry(), createCityMaterial({ instanced: true }).material, CAP * 4);
    this.wheels.count = 0;
    this.wheels.castShadow = shadows;
    this.wheels.frustumCulled = false;
    this.group.add(this.wheels);
  }

  sync(vehicles: Iterable<Vehicle>, traffic: Iterable<TrafficCar> = []): void {
    const counts = new Map<string, number>();
    let w = 0;
    for (const v of vehicles) {
      const mesh = this.meshes.get(v.profile.id);
      if (!mesh) continue;
      const i = counts.get(v.profile.id) ?? 0;
      if (i >= CAP) continue;
      counts.set(v.profile.id, i + 1);
      const t = v.body.translation(), r = v.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      pos.set(t.x, t.y, t.z);
      body.compose(pos, q, one);
      if (v.isBike) {
        local.makeRotationAxis(AZ, v.lean);
        m.multiplyMatrices(body, local);
        mesh.setMatrixAt(i, m);
      } else mesh.setMatrixAt(i, body);
      col.set(v.color);
      if (v.destroyed) col.multiplyScalar(0.18);
      else if (v.health < 60) col.lerp(new THREE.Color(0x2a2623), (60 - v.health) / 110);
      mesh.setColorAt(i, col);
      if (v.ctrl && w + 4 <= CAP * 4) {
        const rad = v.profile.wheelRadius;
        const width = v.isBike ? 0.14 : v.profile.class === 'truck' ? 0.36 : 0.25;
        for (let k = 0; k < 4; k++) {
          if (v.isBike && k % 2 === 1) continue; // two visible wheels, on the centre line
          const wp = v.wheelPose(k);
          qs.setFromAxisAngle(AY, wp.steer);
          qr.setFromAxisAngle(AX, wp.spin);
          qs.multiply(qr);
          pos.set(v.isBike ? 0 : wp.x, wp.y, wp.z);
          scl.set(width, rad, rad);
          local.compose(pos, qs, scl);
          m.multiplyMatrices(body, local);
          this.wheels.setMatrixAt(w++, m);
        }
      }
    }
    // Ambient traffic: lane agents with no physics body of their own.
    for (const c of traffic) {
      const mesh = this.meshes.get(c.profile.id);
      if (!mesh) continue;
      const i = counts.get(c.profile.id) ?? 0;
      if (i >= CAP) continue;
      counts.set(c.profile.id, i + 1);
      const p = c.profile;
      q.setFromAxisAngle(AY, c.heading);
      pos.set(c.x, p.rideHeight, c.z);
      body.compose(pos, q, one);
      mesh.setMatrixAt(i, body);
      mesh.setColorAt(i, col.set(c.color));
      if (w + 4 > CAP * 4) continue;
      const bike = p.class === 'motorcycle';
      const width = bike ? 0.14 : p.class === 'truck' ? 0.36 : 0.25;
      const hw = p.track / 2, hb = p.wheelBase / 2, wy = p.wheelRadius - p.rideHeight;
      for (let k = 0; k < 4; k++) {
        if (bike && k % 2 === 1) continue;
        qs.setFromAxisAngle(AY, k < 2 ? Math.max(-0.5, Math.min(0.5, c.steer)) : 0);
        qr.setFromAxisAngle(AX, c.spin);
        qs.multiply(qr);
        pos.set(bike ? 0 : k % 2 ? -hw : hw, wy, k < 2 ? hb : -hb);
        scl.set(width, p.wheelRadius, p.wheelRadius);
        local.compose(pos, qs, scl);
        m.multiplyMatrices(body, local);
        this.wheels.setMatrixAt(w++, m);
      }
    }
    for (const [id, mesh] of this.meshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.wheels.count = w;
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
