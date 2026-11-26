/** Tunable constants and quality presets. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const WORLD_SEED = 0x0d11e;

export interface QualitySettings {
  name: string;
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  /** Streaming radii in cells for LOD 0..3. */
  lodRadius: [number, number, number, number];
  maxTraffic: number;
  maxPedestrians: number;
  bloom: boolean;
  envMap: boolean;
  drawDistance: number;
}

export const QUALITY: Record<string, QualitySettings> = {
  low: {
    name: 'low', pixelRatio: 0.75, shadowMapSize: 1024, shadows: false,
    lodRadius: [1.2, 2.2, 4.5, 9], maxTraffic: 14, maxPedestrians: 18, bloom: false, envMap: false, drawDistance: 2400,
  },
  medium: {
    name: 'medium', pixelRatio: 1, shadowMapSize: 2048, shadows: true,
    lodRadius: [1.6, 3.0, 6.5, 14], maxTraffic: 26, maxPedestrians: 36, bloom: false, envMap: true, drawDistance: 3600,
  },
  high: {
    name: 'high', pixelRatio: 1.5, shadowMapSize: 4096, shadows: true,
    lodRadius: [2.0, 4.0, 9, 20], maxTraffic: 40, maxPedestrians: 60, bloom: true, envMap: true, drawDistance: 5200,
  },
};

export const STREAMING = {
  /** Seconds of travel the streamer looks ahead along the velocity vector. */
  lookaheadSeconds: 3.5,
  maxLookahead: 420,
  /** Main-thread milliseconds per frame for instantiating and disposing cells. */
  frameBudgetMs: 4,
  /** Unload happens this many cells beyond the load radius (hysteresis). */
  unloadMargin: 1.25,
  /** A LOD only drops to a coarser tier after the distance exceeds its radius by this factor. */
  lodHysteresis: 1.15,
  cacheBudgetBytes: 192 * 1024 * 1024,
  fadeSeconds: 0.45,
  workers: 3,
};
