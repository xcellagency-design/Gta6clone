import data from '../../data/vehicles/vehicles.json';

export type VehicleClass = 'sedan' | 'suv' | 'sports' | 'truck' | 'motorcycle' | 'boat';

export interface VehicleProfile {
  id: string;
  name: string;
  class: VehicleClass;
  mass: number;
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  wheelBase: number;
  track: number;
  /** Height of the chassis centre above the ground at rest. */
  rideHeight: number;
  suspRest: number;
  suspStiffness: number;
  suspDamping: number;
  maxSteer: number;
  /** Peak drive force in newtons, summed over the driven wheels, in first gear. */
  engineForce: number;
  /** Metres per second. */
  topSpeed: number;
  brake: number;
  grip: number;
  drive: 'fwd' | 'rwd' | 'awd';
  gears: number;
  price: number;
  colors: string[];
}

export const VEHICLE_PROFILES = data.profiles as VehicleProfile[];
const byId = new Map(VEHICLE_PROFILES.map((p) => [p.id, p]));

export function vehicleProfile(id: string): VehicleProfile {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown vehicle profile "${id}"`);
  return p;
}

/** Index used by the cell generator's parking slots. */
export const PARKING_PROFILES = ['sedan', 'suv', 'sports', 'truck', 'boat', 'motorcycle'] as const;
