import type { EventBus } from '../core/EventBus';
import { hash2 } from '../core/rng';
import type { Environment } from '../environment/Environment';
import type { PoiDef, PoiType } from '../streaming/CellData';

export interface Inventory { repairKits: number; fuelCans: number; burnerPhones: number }

export interface EconomySnapshot {
  cash: number;
  inventory: Inventory;
  /** Point-of-interest ids of owned safehouses and businesses. */
  properties: string[];
  lastIncomeDay: number;
  earned: number;
  spent: number;
  outfit: { shirt: number; pants: number };
}

export const PRICES = {
  repairKit: 150, fuelCan: 60, burnerPhone: 90, meal: 25, outfit: 60, respray: 400, cover: 40,
  fuelPerPercent: 1.2, repairPerPoint: 9,
};

/** What an owned location costs and, for businesses, earns per in-game day. */
export function propertyTerms(poi: PoiDef): { price: number; income: number } {
  const h = hash2(Math.round(poi.x), Math.round(poi.z), 8101);
  if (poi.type === 'safehouse') return { price: poi.name === 'Navarro Salvage' ? 0 : Math.round((18000 + h * 30000) / 500) * 500, income: 0 };
  const price = Math.round((14000 + h * 52000) / 500) * 500;
  return { price, income: Math.round((price * (0.035 + h * 0.02)) / 10) * 10 };
}

/**
 * Money and ownership. Every purchase goes through `spend`, every payout through `earn`, and
 * the whole state is one serialisable snapshot, so the economy survives saving and loading.
 */
export class Economy {
  cash = 400;
  inventory: Inventory = { repairKits: 0, fuelCans: 0, burnerPhones: 0 };
  properties = new Set<string>();
  lastIncomeDay = 1;
  earned = 0;
  spent = 0;
  outfit = { shirt: 0x3d5a73, pants: 0x2b2d33 };
  /** Looks up a location by id; set by the game so income can be computed from the world. */
  poiLookup: (id: string) => PoiDef | undefined = () => undefined;

  constructor(private bus: EventBus, private env: Environment) {}

  canAfford(amount: number): boolean {
    return this.cash >= amount;
  }

  earn(amount: number, reason: string): void {
    if (amount <= 0) return;
    this.cash += amount;
    this.earned += amount;
    this.bus.emit('economy.cash', { amount: this.cash, delta: amount, reason });
  }

  /** Returns false, changing nothing, when the player cannot pay. */
  spend(amount: number, item: string): boolean {
    amount = Math.round(amount);
    if (amount < 0 || this.cash < amount) return false;
    this.cash -= amount;
    this.spent += amount;
    this.bus.emit('economy.cash', { amount: this.cash, delta: -amount, reason: item });
    this.bus.emit('economy.purchase', { item, cost: amount });
    return true;
  }

  /** Fines take what there is. Returns the amount actually paid. */
  fine(amount: number): number {
    const paid = Math.min(this.cash, Math.round(amount));
    this.cash -= paid;
    this.spent += paid;
    this.bus.emit('economy.cash', { amount: this.cash, delta: -paid, reason: 'fine' });
    return paid;
  }

  owns(poiId: string): boolean {
    return this.properties.has(poiId);
  }

  buyProperty(poi: PoiDef): boolean {
    if (this.owns(poi.id)) return false;
    const { price } = propertyTerms(poi);
    if (!this.spend(price, `property:${poi.name}`)) return false;
    this.properties.add(poi.id);
    return true;
  }

  dailyIncome(): number {
    let sum = 0;
    for (const id of this.properties) {
      const poi = this.poiLookup(id);
      if (poi) sum += propertyTerms(poi).income;
    }
    return sum;
  }

  /** Pays business income once for every in-game day that has passed. */
  update(): void {
    if (this.env.day <= this.lastIncomeDay) return;
    const days = this.env.day - this.lastIncomeDay;
    this.lastIncomeDay = this.env.day;
    const income = this.dailyIncome() * days;
    if (income > 0) {
      this.earn(income, 'business income');
      this.bus.emit('notify', { text: `Your businesses brought in $${income.toLocaleString('en-US')}.`, kind: 'good' });
    }
  }

  snapshot(): EconomySnapshot {
    return { cash: this.cash, inventory: { ...this.inventory }, properties: [...this.properties], lastIncomeDay: this.lastIncomeDay, earned: this.earned, spent: this.spent, outfit: { ...this.outfit } };
  }

  restore(s: EconomySnapshot): void {
    this.cash = s.cash; this.inventory = { ...s.inventory }; this.properties = new Set(s.properties);
    this.lastIncomeDay = s.lastIncomeDay; this.earned = s.earned; this.spent = s.spent; this.outfit = { ...s.outfit };
  }
}

export const POI_LABEL: Record<PoiType, string> = {
  safehouse: 'Safehouse', shop: 'Store', restaurant: 'Restaurant', garage: 'Garage', clothing: 'Clothing', dealership: 'Dealership',
  business: 'Business', fuel: 'Fuel', venue: 'Venue',
};
