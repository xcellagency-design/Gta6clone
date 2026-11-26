/**
 * Narrative data model. The JSON files in data/narrative/ conform to these types.
 * Everything here is plain data so the same files drive the game, the tests and the dev tools.
 */

/** A boolean expression over narrative state. */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { var: string; gte?: number; lte?: number; gt?: number; lt?: number; eq?: number }
  | { flag: string; is?: boolean }
  | { const: boolean };

/** A change to narrative state. Numeric variables are clamped to their declared range. */
export type Effect =
  | { var: string; add: number }
  | { var: string; set: number }
  | { flag: string; set: boolean };

export interface VariableDef {
  id: string;
  min: number;
  max: number;
  initial: number;
  desc: string;
}

export interface FlagDef {
  id: string;
  initial: boolean;
  desc: string;
}

export interface Branch {
  /** Omitted on the last branch, which is the default. */
  if?: Condition;
  goto: string;
}

export interface Choice {
  id: string;
  label: string;
  description?: string;
  /** The choice is offered only when this holds. */
  requires?: Condition;
  effects: Effect[];
  /** Next node id, or an ordered list of conditional branches (first match wins). */
  next: string | Branch[];
}

/** One step of an open-world mission, executed by the mission runner. */
export type MissionStep =
  | { type: 'goto'; district: string; label: string }
  | { type: 'drive_to'; district: string; label: string }
  | { type: 'timed_drive'; district: string; seconds: number; label: string }
  | { type: 'steal_vehicle'; vehicleClass?: string; label: string }
  | { type: 'deliver_vehicle'; district: string; label: string; maxDamage?: number }
  | { type: 'evade_police'; stars: number; label: string }
  | { type: 'collect'; district: string; count: number; label: string }
  | { type: 'wait'; seconds: number; label: string }
  | { type: 'talk'; character: string; lines: string[]; label: string }
  | { type: 'boat_to'; district: string; label: string };

export interface MissionDef {
  giver: string;
  startDistrict: string;
  kind: 'story' | 'driving' | 'delivery' | 'pursuit' | 'investigation' | 'character' | 'business' | 'event';
  steps: MissionStep[];
  rewardCash: number;
}

export interface GraphNode {
  id: string;
  type: 'mission' | 'decision' | 'finale';
  act: number;
  title: string;
  summary: string;
  mission?: MissionDef;
  /** Empty for finale nodes. */
  choices: Choice[];
}

export interface DecisionGraph {
  version: number;
  start: string;
  variables: VariableDef[];
  flags: FlagDef[];
  nodes: GraphNode[];
}

export interface CinematicShot {
  text: string;
  duration: number;
}

export interface EndingDef {
  id: string;
  name: string;
  /** Higher priority endings are tested first. Ties break on id. */
  priority: number;
  requirements: Condition;
  tone: string;
  summary: string;
  characterOutcomes: Record<string, string>;
  consequences: string[];
  finalSequence: { id: string; description: string };
  cinematic: {
    district: string;
    timeOfDay: number;
    weather: 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
    camera: 'orbit' | 'crane' | 'dolly' | 'static' | 'chase' | 'flyover';
    music: string;
    shots: CinematicShot[];
  };
}

export interface EndingRegistry {
  version: number;
  fallback: string;
  endings: EndingDef[];
}

/** Mutable narrative state. Serialisable as-is into a save file. */
export interface NarrativeSnapshot {
  node: string;
  vars: Record<string, number>;
  flags: Record<string, boolean>;
  /** Choice ids in the order they were taken. */
  history: string[];
  ending: string | null;
}
