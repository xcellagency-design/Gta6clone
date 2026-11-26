import { beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '../../src/core/Physics';
import { SIM_DT } from '../../src/core/config';
import { Vehicle, type VehicleControls } from '../../src/vehicles/Vehicle';
import { VEHICLE_PROFILES, vehicleProfile } from '../../src/vehicles/VehicleProfile';

let physics: Physics;

function flatGround(p: Physics): void {
  p.addStaticBoxes(new Float32Array([0, -1, 0, 3000, 1, 3000, 0]));
}

function run(p: Physics, v: Vehicle, seconds: number, c: VehicleControls, grip = 1): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    v.update(SIM_DT, c, { grip });
    p.step();
  }
}

beforeAll(async () => {
  physics = await Physics.create();
  flatGround(physics);
});

describe('wheeled vehicles', () => {
  for (const [n, id] of ['sedan', 'suv', 'sports', 'truck', 'motorcycle', 'police'].entries()) {
    it(`${id}: settles, accelerates, shifts, brakes and stays upright`, () => {
      const p = vehicleProfile(id);
      const v = new Vehicle(physics, p, n * 60, 0, -2000, 0);
      v.occupied = true;
      run(physics, v, 1.5, { throttle: 0, steer: 0, handbrake: false });
      expect(v.wheelsOnGround()).toBe(4);
      expect(Math.abs(v.y - p.rideHeight)).toBeLessThan(0.12);
      expect(v.health).toBe(100);

      const z0 = v.z;
      run(physics, v, 8, { throttle: 1, steer: 0, handbrake: false });
      expect(v.speed).toBeGreaterThan(p.topSpeed * 0.45);
      expect(v.speed).toBeLessThan(p.topSpeed * 1.08);
      expect(v.z - z0).toBeGreaterThan(40);
      expect(Math.abs(v.x - n * 60)).toBeLessThan(3);
      expect(v.gear).toBeGreaterThan(1);
      expect(v.gearChanges).toBeGreaterThan(0);
      expect(v.fuel).toBeLessThan(1);

      const before = v.speed;
      run(physics, v, 1.5, { throttle: -1, steer: 0, handbrake: false });
      expect(v.speed).toBeLessThan(before - 6);
      run(physics, v, 6, { throttle: -1, steer: 0, handbrake: false });
      // Brakes to a stop, then backs up.
      expect(v.speed).toBeLessThan(0);
      expect(v.health).toBe(100);
      v.dispose();
    });
  }

  it('steers right with positive input and left with negative', () => {
    const v = new Vehicle(physics, vehicleProfile('sedan'), 500, 0, 0, 0);
    v.occupied = true;
    run(physics, v, 3, { throttle: 0.7, steer: 0, handbrake: false });
    const h0 = v.heading();
    run(physics, v, 1.5, { throttle: 0.5, steer: 1, handbrake: false });
    // Facing +z, the driver's right is −x, so a right turn decreases the heading angle.
    expect(v.heading()).toBeLessThan(h0 - 0.2);
    const h1 = v.heading();
    run(physics, v, 1.5, { throttle: 0.5, steer: -1, handbrake: false });
    expect(v.heading()).toBeGreaterThan(h1 + 0.2);
    v.dispose();
  });

  it('has class-specific handling: the sports car out-accelerates the truck', () => {
    const times: Record<string, number> = {};
    for (const id of ['sports', 'sedan', 'truck']) {
      const v = new Vehicle(physics, vehicleProfile(id), -500, 0, id.length * 50, 0);
      v.occupied = true;
      run(physics, v, 1, { throttle: 0, steer: 0, handbrake: false });
      let t = 0;
      while (v.speed < 20 && t < 30) { run(physics, v, 0.1, { throttle: 1, steer: 0, handbrake: false }); t += 0.1; }
      times[id] = t;
      v.dispose();
    }
    expect(times.sports).toBeLessThan(times.sedan);
    expect(times.sedan).toBeLessThan(times.truck);
  });

  it('rain reduces cornering grip', () => {
    const drift = (grip: number) => {
      const v = new Vehicle(physics, vehicleProfile('sedan'), 900, 0, grip * 1000, 0);
      v.occupied = true;
      run(physics, v, 5, { throttle: 1, steer: 0, handbrake: false }, grip);
      const h0 = v.heading();
      run(physics, v, 1.2, { throttle: 0.3, steer: 1, handbrake: false }, grip);
      const turned = Math.abs(v.heading() - h0);
      v.dispose();
      return turned;
    };
    expect(drift(0.45)).toBeLessThan(drift(1));
  });

  it('takes damage from a wall and none from normal driving', () => {
    const p = vehicleProfile('sedan');
    const v = new Vehicle(physics, p, -900, 0, 0, 0);
    v.occupied = true;
    const wall = physics.addStaticBoxes(new Float32Array([-900, 3, 70, 20, 3, 1, 0]));
    run(physics, v, 7, { throttle: 1, steer: 0, handbrake: false });
    expect(v.health).toBeLessThan(95);
    expect(v.z).toBeLessThan(71);
    physics.removeColliders(wall);
    v.dispose();
  });

  it('an unoccupied vehicle holds its position', () => {
    const v = new Vehicle(physics, vehicleProfile('suv'), 1200, 0, 0, 0.7);
    run(physics, v, 3, { throttle: 1, steer: 1, handbrake: false });
    expect(Math.hypot(v.x - 1200, v.z)).toBeLessThan(0.3);
    v.dispose();
  });
});

describe('boat', () => {
  it('floats, moves under power and turns', async () => {
    const sea = await Physics.create();
    const v = new Vehicle(sea, vehicleProfile('boat'), 0, -0.6, 0, 0);
    v.occupied = true;
    run(sea, v, 4, { throttle: 0, steer: 0, handbrake: false });
    expect(v.inWater).toBe(true);
    expect(v.y).toBeGreaterThan(-1.4);
    expect(v.y).toBeLessThan(0.3);
    run(sea, v, 8, { throttle: 1, steer: 0, handbrake: false });
    expect(v.speed).toBeGreaterThan(6);
    expect(v.speed).toBeLessThan(vehicleProfile('boat').topSpeed * 1.15);
    const h0 = v.heading();
    run(sea, v, 3, { throttle: 1, steer: 1, handbrake: false });
    expect(v.heading()).toBeLessThan(h0 - 0.3);
    expect(v.y).toBeGreaterThan(-1.6);
  });
});

it('every profile has sane data', () => {
  for (const p of VEHICLE_PROFILES) {
    expect(p.mass).toBeGreaterThan(100);
    expect(p.colors.length).toBeGreaterThan(0);
    expect(p.topSpeed).toBeGreaterThan(10);
  }
});
