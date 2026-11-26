import { describe, expect, it } from 'vitest';
import { SPAWN } from '../../src/world/CityPlan';
import { makeSim, run } from './helpers';

describe('core gameplay loop (headless)', () => {
  it('spawns the player on the ground at the salvage yard', async () => {
    const { sim } = await makeSim();
    run(sim, 1);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.y).toBeGreaterThan(-0.05);
    expect(sim.player.y).toBeLessThan(0.4);
    expect(Math.hypot(sim.player.x - SPAWN.x, sim.player.z - SPAWN.z)).toBeLessThan(1);
    expect(sim.waitingForWorld).toBe(false);
    expect(sim.streaming.stats().byLod[0]).toBeGreaterThan(0);
  });

  it('walks, runs, sprints, crouches and jumps', async () => {
    const { sim, input } = await makeSim();
    run(sim, 0.5);
    sim.camera.yaw = -Math.PI / 2; // looking west, toward the yard gate
    const x0 = sim.player.x;
    input.set({ moveY: 1 });
    run(sim, 2);
    expect(x0 - sim.player.x).toBeGreaterThan(6);
    expect(sim.player.speed).toBeGreaterThan(3.8);
    expect(sim.player.speed).toBeLessThan(4.8);
    expect(sim.player.distanceWalked).toBeGreaterThan(6);

    input.set({ sprint: true });
    run(sim, 1);
    expect(sim.player.speed).toBeGreaterThan(6.5);
    input.set({ sprint: false, crouch: true });
    run(sim, 1);
    expect(sim.player.crouching).toBe(true);
    expect(sim.player.speed).toBeLessThan(2);
    input.set({ crouch: false, moveY: 0, moveX: 1 });
    const z0 = sim.player.z;
    run(sim, 1);
    // Facing west, "right" is north (−z).
    expect(sim.player.z).toBeLessThan(z0 - 2);

    input.set({ moveX: 0 });
    run(sim, 0.5);
    const y0 = sim.player.y;
    input.pulse('jump');
    let peak = y0;
    run(sim, 0.9, () => { peak = Math.max(peak, sim.player.y); });
    expect(peak - y0).toBeGreaterThan(0.5);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.jumps).toBe(1);
  });

  it('is stopped by buildings', async () => {
    const { sim, input } = await makeSim();
    run(sim, 0.3);
    // The yard office is north-west of the spawn; walk straight at its south wall.
    sim.player.teleport(1014, 0.3, 2828);
    sim.camera.yaw = Math.PI; // face −z (north)
    input.set({ moveY: 1 });
    run(sim, 4);
    expect(sim.player.z).toBeGreaterThan(2819);
  });

  it('enters the car, drives it, and gets out', async () => {
    const { sim, input } = await makeSim();
    run(sim, 1);
    const car = [...sim.vehicles.all.values()].find((v) => v.owner === 'player')!;
    expect(car).toBeTruthy();
    // Walk to the car.
    sim.player.teleport(car.x + 2.2, 0.2, car.z);
    run(sim, 0.3);
    input.pulse('enterExit');
    run(sim, 0.2);
    expect(sim.player.mode).toBe('vehicle');
    expect(sim.playerVehicle).toBe(car);
    expect(sim.bus.count('vehicle.entered')).toBe(1);

    const start = { x: car.x, z: car.z };
    input.set({ moveY: 1 });
    run(sim, 3);
    expect(Math.hypot(car.x - start.x, car.z - start.z)).toBeGreaterThan(8);
    expect(car.speed).toBeGreaterThan(5);
    // The player rides along.
    expect(Math.hypot(sim.player.x - car.x, sim.player.z - car.z)).toBeLessThan(0.1);
    // Cannot bail out at speed.
    input.pulse('enterExit');
    run(sim, 0.1);
    expect(sim.player.mode).toBe('vehicle');

    input.set({ moveY: -1 });
    run(sim, 2.5);
    input.set({ moveY: 0, handbrake: true });
    run(sim, 1.5);
    expect(Math.abs(car.speed)).toBeLessThan(1);
    input.set({ handbrake: false });
    input.pulse('enterExit');
    run(sim, 0.5);
    expect(sim.player.mode).toBe('foot');
    expect(sim.playerVehicle).toBeNull();
    const gap = Math.hypot(sim.player.x - car.x, sim.player.z - car.z);
    expect(gap).toBeGreaterThan(1.2);
    expect(gap).toBeLessThan(3.5);
    run(sim, 1);
    expect(sim.player.grounded).toBe(true);
    // And can walk away afterwards.
    const p0 = { x: sim.player.x, z: sim.player.z };
    input.set({ moveY: 1 });
    run(sim, 1);
    expect(Math.hypot(sim.player.x - p0.x, sim.player.z - p0.z)).toBeGreaterThan(2);
  });

  it('streams parked cars in with their cell', async () => {
    const { sim } = await makeSim();
    await sim.teleport(1650, 1250); // The Flats
    run(sim, 1);
    const parked = [...sim.vehicles.all.values()].filter((v) => v.owner === 'npc');
    expect(parked.length).toBeGreaterThan(3);
    for (const v of parked.filter((p) => !p.isBoat && sim.streaming.isSolidAt(p.x, p.z))) {
      expect(v.y, `${v.profile.id} rests on the road`).toBeGreaterThan(0.2);
      expect(v.y).toBeLessThan(1.2);
    }
    await sim.teleport(300, 300); // far away, open country
    run(sim, 1);
    expect([...sim.vehicles.all.values()].filter((v) => v.owner === 'npc').length).toBeLessThan(parked.length);
  });

  it('time passes and weather changes grip', async () => {
    const { sim } = await makeSim();
    const h0 = sim.env.hour;
    run(sim, 4);
    expect(sim.env.hour).toBeGreaterThan(h0);
    expect(sim.env.grip()).toBe(1);
    sim.env.setWeather('storm', true);
    expect(sim.env.grip()).toBeLessThan(0.75);
    expect(sim.env.visibility()).toBeLessThan(70);
    expect(sim.bus.count('weather.changed')).toBe(1);
  });
});
