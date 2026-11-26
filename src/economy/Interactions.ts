import type { GameSim } from '../core/GameSim';
import type { PoiDef } from '../streaming/CellData';
import type { Vehicle } from '../vehicles/Vehicle';
import { vehicleProfile } from '../vehicles/VehicleProfile';
import { nearestRoadPoint } from '../world/CityPlan';
import { PRICES, propertyTerms } from './Economy';

export interface PoiAction {
  id: string;
  label: string;
  cost: number;
  enabled: boolean;
  /** Why it is disabled, or what it will do. */
  note: string;
  /** Performs the action and returns a line of feedback. Does nothing when disabled. */
  run(): string;
}

const OUTFITS: [number, number][] = [
  [0x3d5a73, 0x2b2d33], [0x7a1f1f, 0x23262b], [0xe9e2d0, 0x3a4658], [0x2f4f3f, 0x5a4a3a], [0xd9a441, 0x1f2328], [0x1c1c1f, 0x1c1c1f], [0x5fa8d3, 0x6f6a5c], [0xb5651d, 0x34404a],
];

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** The vehicle a garage or pump would work on: the one being driven, or the one just left nearby. */
function serviceVehicle(sim: GameSim, poi: PoiDef): Vehicle | null {
  const v = sim.playerVehicle ?? sim.lastVehicle;
  if (!v || !sim.vehicles.all.has(v.id)) return null;
  return Math.hypot(v.x - poi.x, v.z - poi.z) < 35 ? v : null;
}

/**
 * What can be done at a location. Every action changes real game state — cash, inventory,
 * vehicles, time, ownership, the wanted level — and reports what it did.
 */
export function poiActions(sim: GameSim, poi: PoiDef): PoiAction[] {
  const eco = sim.economy;
  const out: PoiAction[] = [];
  const add = (id: string, label: string, cost: number, ok: boolean, note: string, effect: () => string) => {
    const enabled = ok && eco.canAfford(cost);
    out.push({
      id, label, cost, enabled, note: !ok ? note : !eco.canAfford(cost) ? 'Not enough cash.' : note,
      run: () => (enabled && eco.spend(cost, `${poi.type}:${id}`) ? effect() : ''),
    });
  };
  const v = serviceVehicle(sim, poi);

  switch (poi.type) {
    case 'safehouse': {
      const terms = propertyTerms(poi);
      const owned = terms.price === 0 || eco.owns(poi.id);
      if (!owned) {
        add('buy', `Buy ${poi.name}`, terms.price, true, 'A place to save, sleep and keep vehicles.', () => { eco.properties.add(poi.id); return `${poi.name} is yours.`; });
        break;
      }
      for (const slot of ['slot1', 'slot2', 'slot3'] as const) {
        add('save_' + slot, `Save game — ${slot.replace('slot', 'slot ')}`, 0, !!sim.onSaveRequest && !sim.missions.active, sim.missions.active ? 'Finish or abandon the mission first.' : 'Writes your progress.', () => (sim.onSaveRequest!(slot) ? 'Game saved.' : 'Saving failed.'));
      }
      add('sleep', 'Sleep until morning', 0, sim.wanted.level === 0, sim.wanted.level ? 'Not while the police are looking for you.' : 'Advances the clock to 07:00.', () => {
        if (sim.env.hour >= 7) sim.env.day++;
        sim.env.hour = 7;
        sim.player.stamina = 1;
        sim.onSaveRequest?.('auto');
        return 'You slept. It is morning.';
      });
      const mine = v && v.owner === 'player' ? v : null;
      add('store', 'Put this vehicle in the garage', 0, !!mine && !mine!.occupied, 'Park an owned vehicle here and get out first.', () => {
        sim.vehicles.stored.push({ profile: mine!.profile.id, x: 0, y: 0, z: 0, heading: 0, color: mine!.color, health: mine!.health, fuel: mine!.fuel, owner: 'player', stored: true });
        if (sim.lastVehicle === mine) sim.lastVehicle = null;
        sim.vehicles.remove(mine!);
        return 'Vehicle stored.';
      });
      sim.vehicles.stored.forEach((sv, i) => {
        add('take_' + i, `Take out the ${vehicleProfile(sv.profile).name}`, 0, true, `Condition ${Math.round(sv.health)}%`, () => {
          const spot = nearestRoadPoint(poi.x, poi.z) ?? { x: poi.x + 6, z: poi.z, vertical: true };
          const nv = sim.vehicles.spawn(sv.profile, spot.x + (spot.vertical ? 2.2 : 0), sv.profile === 'boat' ? -0.6 : 0.15, spot.z + (spot.vertical ? 0 : 2.2), spot.vertical ? 0 : Math.PI / 2, sv.color);
          nv.owner = 'player'; nv.health = sv.health; nv.fuel = sv.fuel;
          sim.vehicles.persistent.add(nv);
          sim.vehicles.stored.splice(sim.vehicles.stored.indexOf(sv), 1);
          return 'Your vehicle is at the kerb.';
        });
      });
      break;
    }
    case 'shop':
      add('kit', 'Repair kit', PRICES.repairKit, true, `Restores 40% condition. You have ${eco.inventory.repairKits}.`, () => { eco.inventory.repairKits++; return 'Bought a repair kit.'; });
      add('fuel', 'Fuel can', PRICES.fuelCan, true, `Adds half a tank. You have ${eco.inventory.fuelCans}.`, () => { eco.inventory.fuelCans++; return 'Bought a fuel can.'; });
      add('phone', 'Burner phone', PRICES.burnerPhone, true, `A false tip sends a police search elsewhere. You have ${eco.inventory.burnerPhones}.`, () => { eco.inventory.burnerPhones++; return 'Bought a burner phone.'; });
      break;
    case 'restaurant':
      add('meal', 'Eat', PRICES.meal, true, 'Half an hour passes. Sprinting tires you half as fast for a while.', () => { sim.env.hour = (sim.env.hour + 0.5) % 24; sim.player.fed = 600; sim.player.stamina = 1; return 'That hit the spot.'; });
      break;
    case 'garage': {
      const cost = v ? Math.round((100 - v.health) * PRICES.repairPerPoint) : 0;
      add('repair', 'Repair vehicle', cost, !!v && v.health < 99.5, v ? 'Nothing to fix.' : 'Bring a vehicle.', () => { v!.repair(); return 'Good as new.'; });
      add('respray', 'Respray', PRICES.respray, !!v, v ? 'New colour, clean plates. Shakes off a search if nobody saw you come in.' : 'Bring a vehicle.', () => {
        const colors = v!.profile.colors.filter((c) => c !== v!.color);
        v!.color = colors[Math.floor(sim.time * 7) % colors.length] ?? v!.color;
        v!.hot = false;
        if (sim.wanted.level > 0 && !sim.wanted.seen) { sim.wanted.clearByPayment(); return 'Resprayed. The description they have no longer fits.'; }
        return 'Resprayed.';
      });
      break;
    }
    case 'clothing':
      add('outfit', 'New outfit', PRICES.outfit, true, 'Changes what Cass is wearing.', () => {
        const options = OUTFITS.filter((o) => o[0] !== eco.outfit.shirt);
        const o = options[Math.floor(sim.time * 3) % options.length];
        eco.outfit = { shirt: o[0], pants: o[1] };
        return 'Looking different.';
      });
      break;
    case 'dealership': {
      const stock = poi.district === 'marina' ? ['boat', 'sports', 'suv'] : ['sedan', 'suv', 'sports', 'motorcycle', 'truck'];
      for (const id of stock) {
        const p = vehicleProfile(id);
        add('buy_' + id, `${p.name}`, p.price, true, `${p.class}, top speed ${Math.round(p.topSpeed * 3.6)} km/h`, () => {
          const spot = nearestRoadPoint(poi.x, poi.z) ?? { x: poi.x + 6, z: poi.z, vertical: true };
          const nv = sim.vehicles.spawn(id, spot.x + (spot.vertical ? 2.4 : 0), id === 'boat' ? -0.6 : 0.15, spot.z + (spot.vertical ? 0 : 2.4), spot.vertical ? 0 : Math.PI / 2, p.colors[Math.floor(sim.time) % p.colors.length]);
          nv.owner = 'player';
          sim.vehicles.persistent.add(nv);
          return `The ${p.name} is yours. It is parked outside.`;
        });
      }
      break;
    }
    case 'business': {
      const terms = propertyTerms(poi);
      if (eco.owns(poi.id)) add('owned', `You own ${poi.name}`, 0, false, `Earns ${money(terms.income)} a day.`, () => '');
      else add('buy', `Buy ${poi.name}`, terms.price, true, `Earns ${money(terms.income)} every in-game day.`, () => { eco.properties.add(poi.id); return `${poi.name} is yours.`; });
      break;
    }
    case 'fuel': {
      const cost = v ? Math.ceil((1 - v.fuel) * 100 * PRICES.fuelPerPercent) : 0;
      add('fill', 'Fill the tank', cost, !!v && v.fuel < 0.98, v ? 'The tank is full.' : 'Bring a vehicle.', () => { v!.fuel = 1; return 'Tank filled.'; });
      break;
    }
    case 'venue':
      add('cover', 'Pay the cover and stay a while', PRICES.cover, true, 'Two hours pass. A good place to be while a search burns out.', () => {
        sim.env.hour = (sim.env.hour + 2) % 24;
        sim.wanted.layLow(25);
        return 'Two hours later, the street is quieter.';
      });
      break;
  }
  return out;
}

/** Items carried in the inventory, usable anywhere. Each returns feedback, or '' if it did nothing. */
export function useItem(sim: GameSim, item: 'repairKit' | 'fuelCan' | 'burnerPhone'): string {
  const inv = sim.economy.inventory;
  const v = sim.playerVehicle ?? (sim.lastVehicle && Math.hypot(sim.lastVehicle.x - sim.player.x, sim.lastVehicle.z - sim.player.z) < 6 ? sim.lastVehicle : null);
  if (item === 'repairKit') {
    if (!inv.repairKits || !v || v.health >= 99) return '';
    inv.repairKits--;
    v.destroyed = false;
    v.health = Math.min(100, v.health + 40);
    return 'Patched up.';
  }
  if (item === 'fuelCan') {
    if (!inv.fuelCans || !v || v.fuel > 0.95) return '';
    inv.fuelCans--;
    v.fuel = Math.min(1, v.fuel + 0.5);
    return 'Refuelled.';
  }
  if (!inv.burnerPhones) return '';
  // Point the search at the far side of the last known position.
  const lk = sim.wanted.lastKnown;
  if (!lk) return '';
  const dx = lk.x - sim.player.x, dz = lk.z - sim.player.z, d = Math.hypot(dx, dz) || 1;
  if (!sim.wanted.misdirect(lk.x + (dx / d) * 380, lk.z + (dz / d) * 380)) return '';
  inv.burnerPhones--;
  return 'Called in a sighting on the other side of town.';
}
