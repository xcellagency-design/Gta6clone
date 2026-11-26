import RAPIER from '@dimforge/rapier3d-compat';
import { COLLIDER_STRIDE } from '../streaming/CellData';
import { SIM_DT } from './config';

export const GROUP = {
  WORLD: 0x0001,
  VEHICLE: 0x0002,
  PLAYER: 0x0004,
  NPC: 0x0008,
};

export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

let ready: Promise<void> | null = null;

/** Thin wrapper around the Rapier world: fixed step, streamed static colliders, ray queries. */
export class Physics {
  readonly R = RAPIER;
  readonly world: RAPIER.World;
  staticColliderCount = 0;
  lastStepMs = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_DT;
    // Sea bed: anything that leaves the land comes to rest here instead of falling forever.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -9, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    );
  }

  static async create(): Promise<Physics> {
    if (!ready) ready = RAPIER.init();
    await ready;
    return new Physics();
  }

  step(): void {
    const t = performance.now();
    this.world.step();
    this.lastStepMs = performance.now() - t;
  }

  /** Adds the static boxes of a cell. Returns handles for removal when the cell unloads. */
  addStaticBoxes(data: Float32Array): number[] {
    const handles: number[] = [];
    for (let o = 0; o < data.length; o += COLLIDER_STRIDE) {
      const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, data[o + 3]), Math.max(0.01, data[o + 4]), Math.max(0.01, data[o + 5]))
        .setTranslation(data[o], data[o + 1], data[o + 2])
        .setFriction(0.9)
        .setCollisionGroups(groups(GROUP.WORLD, 0xffff));
      const rot = data[o + 6];
      if (rot) desc.setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) });
      handles.push(this.world.createCollider(desc).handle);
    }
    this.staticColliderCount += handles.length;
    return handles;
  }

  removeColliders(handles: number[]): void {
    for (const h of handles) {
      const c = this.world.getCollider(h);
      if (c) this.world.removeCollider(c, false);
    }
    this.staticColliderCount -= handles.length;
  }

  /** Distance to the first static surface along a ray, or null. */
  raycastWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number | null {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, max, true, undefined, groups(0xffff, GROUP.WORLD));
    return hit ? hit.timeOfImpact : null;
  }
}
