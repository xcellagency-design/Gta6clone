import type { EventBus } from '../core/EventBus';
import { Rng } from '../core/rng';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

interface WeatherDef { cloud: number; rain: number; fog: number; wind: number; minutes: [number, number]; next: [Weather, number][] }

const WEATHER: Record<Weather, WeatherDef> = {
  clear: { cloud: 0.15, rain: 0, fog: 0.0, wind: 0.25, minutes: [180, 420], next: [['cloudy', 0.75], ['fog', 0.25]] },
  cloudy: { cloud: 0.62, rain: 0, fog: 0.08, wind: 0.45, minutes: [90, 240], next: [['clear', 0.5], ['rain', 0.4], ['fog', 0.1]] },
  rain: { cloud: 0.92, rain: 0.6, fog: 0.3, wind: 0.6, minutes: [60, 180], next: [['cloudy', 0.6], ['storm', 0.25], ['clear', 0.15]] },
  storm: { cloud: 1.0, rain: 1.0, fog: 0.45, wind: 1.0, minutes: [40, 110], next: [['rain', 0.7], ['cloudy', 0.3]] },
  fog: { cloud: 0.5, rain: 0, fog: 1.0, wind: 0.1, minutes: [60, 150], next: [['clear', 0.6], ['cloudy', 0.4]] },
};

/** Game minutes that pass per real second (a full day takes 48 real minutes). */
export const TIME_SCALE = 0.5;

/**
 * Time of day and weather. Everything visual and every gameplay effect of the environment
 * (tyre grip, visibility, how many people are out) is derived from this state.
 */
export class Environment {
  /** Hours, 0 … 24. */
  hour = 9.5;
  day = 1;
  weather: Weather = 'clear';
  /** Smoothed values the renderer and gameplay read. */
  cloud = 0.15;
  rain = 0;
  fog = 0;
  wind = 0.25;
  /** How wet the ground is, 0 … 1. Rises quickly in rain and dries slowly. */
  wetness = 0;
  timeScale = TIME_SCALE;
  private minutesLeft = 300;
  private rng: Rng;

  constructor(seed: number, private bus?: EventBus) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  update(dt: number): void {
    const minutes = dt * this.timeScale;
    this.hour += minutes / 60;
    if (this.hour >= 24) { this.hour -= 24; this.day++; }
    this.minutesLeft -= minutes;
    if (this.minutesLeft <= 0) {
      const def = WEATHER[this.weather];
      let r = this.rng.next();
      let next = def.next[0][0];
      for (const [w, p] of def.next) { if (r < p) { next = w; break; } r -= p; }
      this.setWeather(next);
    }
    const t = WEATHER[this.weather];
    const k = Math.min(1, dt * 0.25);
    this.cloud += (t.cloud - this.cloud) * k;
    this.rain += (t.rain - this.rain) * k;
    this.fog += (t.fog - this.fog) * k;
    this.wind += (t.wind - this.wind) * k;
    if (this.rain > 0.05) this.wetness = Math.min(1, this.wetness + this.rain * dt * 0.08);
    else this.wetness = Math.max(0, this.wetness - dt * (0.004 + 0.01 * this.daylight()));
  }

  setWeather(w: Weather, instant = false): void {
    if (w !== this.weather) this.bus?.emit('weather.changed', { weather: w });
    this.weather = w;
    const def = WEATHER[w];
    this.minutesLeft = this.rng.range(def.minutes[0], def.minutes[1]);
    if (instant) {
      this.cloud = def.cloud; this.rain = def.rain; this.fog = def.fog; this.wind = def.wind;
      this.wetness = def.rain > 0 ? 1 : 0;
    }
  }

  /** Sun elevation in radians (negative below the horizon). Sunrise ≈ 06:15, sunset ≈ 19:45. */
  sunElevation(): number {
    return Math.sin(((this.hour - 6.25) / 13.5) * Math.PI) * (this.hour >= 6.25 && this.hour <= 19.75 ? 1.12 : 0.55) - 0.02;
  }

  sunAzimuth(): number {
    return ((this.hour - 6.25) / 13.5) * Math.PI - Math.PI / 2;
  }

  /** 0 at night, 1 in full daylight, with soft dawn and dusk. */
  daylight(): number {
    const e = this.sunElevation();
    return Math.max(0, Math.min(1, (e + 0.1) / 0.32));
  }

  /** 1 at night, 0 by day: drives lamps and lit windows. */
  night(): number {
    return 1 - this.daylight();
  }

  /** Tyre grip multiplier. */
  grip(): number {
    return 1 - 0.32 * this.wetness;
  }

  /** How far characters can see, metres: shorter at night, in fog and in rain. */
  visibility(): number {
    return 95 * (1 - 0.5 * this.night()) * (1 - 0.55 * this.fog) * (1 - 0.25 * this.rain);
  }

  /** Scales how many pedestrians are out. */
  streetLife(): number {
    const h = this.hour;
    const byHour = h < 5 ? 0.15 : h < 8 ? 0.5 : h < 20 ? 1 : h < 23 ? 0.7 : 0.3;
    return byHour * (1 - 0.6 * this.rain);
  }

  clock(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  snapshot() {
    return { hour: this.hour, day: this.day, weather: this.weather, wetness: this.wetness, minutesLeft: this.minutesLeft };
  }

  restore(s: { hour: number; day: number; weather: Weather; wetness: number; minutesLeft: number }): void {
    this.hour = s.hour; this.day = s.day;
    this.setWeather(s.weather, true);
    this.wetness = s.wetness; this.minutesLeft = s.minutesLeft;
  }
}
