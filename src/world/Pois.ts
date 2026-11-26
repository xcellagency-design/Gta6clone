import { hash2 } from '../core/rng';
import type { PoiDef, PoiType } from '../streaming/CellData';
import { BLOCK, BLOCKS_X, BLOCKS_Z, districtOfBlock, DISTRICTS, edgeClass, roadWidth, SALVAGE_BLOCK, type DistrictId } from './CityPlan';

/**
 * Interactive locations. Like everything else in the static world they are a pure function of
 * the block coordinates, so the map can list them without any cell being loaded.
 */

const MIX: Partial<Record<DistrictId, { chance: number; types: PoiType[] }>> = {
  downtown: { chance: 0.34, types: ['restaurant', 'shop', 'business', 'clothing', 'venue', 'business'] },
  neonmile: { chance: 0.6, types: ['venue', 'restaurant', 'venue', 'shop', 'business', 'clothing'] },
  paseo: { chance: 0.55, types: ['clothing', 'shop', 'restaurant', 'venue', 'dealership', 'shop'] },
  flats: { chance: 0.3, types: ['shop', 'restaurant', 'garage', 'shop', 'safehouse', 'business'] },
  crownshore: { chance: 0.25, types: ['restaurant', 'clothing', 'dealership', 'safehouse', 'business'] },
  cypress: { chance: 0.1, types: ['fuel', 'shop', 'garage', 'safehouse'] },
  saltgrass: { chance: 0.05, types: ['fuel', 'garage', 'business'] },
  port: { chance: 0.2, types: ['garage', 'fuel', 'business', 'restaurant'] },
  marina: { chance: 0.4, types: ['restaurant', 'business', 'shop', 'venue', 'dealership'] },
  beach: { chance: 0.3, types: ['restaurant', 'shop', 'venue', 'clothing'] },
  eastbank: { chance: 0.15, types: ['fuel', 'business', 'garage', 'shop'] },
};

const NAMES: Record<PoiType, string[]> = {
  safehouse: ['Walk-up on %s', 'Bayline Apartment', 'Rented Room, %s'],
  shop: ['Lucky Tern Market', 'Odile Corner Store', 'Half Moon Bodega', 'Gulfside Sundries', 'Pier Nine Liquor', 'Marlin Mart'],
  restaurant: ['Casa Pargo', 'The Brined Hen', 'Luz Diner', 'Tidewater Grill', 'Mama Lupe’s Counter', 'Noodle Harbor', 'Shrimp Shack 40'],
  garage: ['Ortega Body & Paint', 'Second Gear Auto', 'Wrench Works', 'Ironhook Auto Repair'],
  clothing: ['Paloma Threads', 'Strand & Stitch', 'North Quay Outfitters', 'Sunday Best'],
  dealership: ['Meridian Motors', 'Gulf Coast Auto Gallery', 'Bayline Pre-Owned'],
  business: ['Coin Laundry', 'Car Wash', 'Print Shop', 'Bait & Tackle', 'Storage Units', 'Taxi Depot', 'Ice House'],
  fuel: ['Pelican Fuel', 'Loop 9 Gas', 'Saltgrass Stop'],
  venue: ['Club Aurelia', 'The Low Tide Room', 'Cine Odile', 'Bowl-A-Rama', 'Jade Lantern Lounge', 'Paseo Arcade'],
};

export function poiForBlock(bx: number, bz: number): PoiDef | null {
  const d = districtOfBlock(bx, bz);
  const X0 = bx * BLOCK, Z0 = bz * BLOCK;
  const cn = edgeClass(false, bz, bx), cs = edgeClass(false, bz + 1, bx), cw = edgeClass(true, bx, bz), ce = edgeClass(true, bx + 1, bz);
  let type: PoiType | null = null;
  let name = '';
  if (bx === SALVAGE_BLOCK.bx && bz === SALVAGE_BLOCK.bz) {
    return { id: `poi_${bx}_${bz}`, type: 'safehouse', name: 'Navarro Salvage', x: X0 + 13.5, z: Z0 + 22.5, heading: 0, district: d };
  }
  const mixDef = MIX[d];
  if (!mixDef || cn + cs + cw + ce === 0) return null;
  if (hash2(bx, bz, 4242) >= mixDef.chance) return null;
  type = mixDef.types[Math.floor(hash2(bx, bz, 4243) * mixDef.types.length)];
  const list = NAMES[type];
  name = list[Math.floor(hash2(bx, bz, 4244) * list.length)].replace('%s', DISTRICTS[d].name);
  // Stand on the sidewalk of whichever side has a road, facing it.
  const t = 25 + hash2(bx, bz, 4245) * 50;
  let x = X0 + t, z = Z0 + roadWidth(cn) / 2 + 2.2, heading = Math.PI;
  if (cs) { z = Z0 + BLOCK - roadWidth(cs) / 2 - 2.2; heading = 0; }
  else if (cn) { /* default */ }
  else if (cw) { x = X0 + roadWidth(cw) / 2 + 2.2; z = Z0 + t; heading = -Math.PI / 2; }
  else { x = X0 + BLOCK - roadWidth(ce) / 2 - 2.2; z = Z0 + t; heading = Math.PI / 2; }
  return { id: `poi_${bx}_${bz}`, type, name, x, z, heading, district: d };
}

let cache: PoiDef[] | null = null;
export function allPois(): PoiDef[] {
  if (cache) return cache;
  cache = [];
  for (let bz = 0; bz < BLOCKS_Z; bz++) {
    for (let bx = 0; bx < BLOCKS_X; bx++) {
      const p = poiForBlock(bx, bz);
      if (p) cache.push(p);
    }
  }
  return cache;
}

export function poiById(id: string): PoiDef | undefined {
  return allPois().find((p) => p.id === id);
}
