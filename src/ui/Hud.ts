import type { GameSim } from '../core/GameSim';
import { districtAt, DISTRICTS } from '../world/CityPlan';
import { el } from './dom';

export interface HudExtras {
  cash?: number;
  wanted?: number;
  objective?: string | null;
  prompt?: { key: string; text: string } | null;
}

/** Minimal, cinematic HUD: only what the moment needs is on screen. */
export class Hud {
  readonly root = el('div.hud');
  private district = el('div.hud-district');
  private clock = el('div.hud-clock');
  private cash = el('div.hud-cash');
  private wanted = el('div.hud-wanted');
  private objective = el('div.hud-objective.hidden');
  private prompt = el('div.hud-prompt.hidden');
  private veh = el('div.hud-br.hidden');
  private speed = el('div.veh-speed', '0');
  private gear = el('div.veh-gear', 'N');
  private rpm = el('i');
  private fuel = el('i');
  private dmg = el('i');
  private toasts = el('div.toasts');
  private loading = el('div.loading-note.hidden', 'STREAMING…');
  readonly mapSlot = el('div.hud-bl');
  extras: HudExtras = {};
  private last = '';

  constructor(parent: HTMLElement, sim: GameSim) {
    this.veh.append(
      el('div.veh', el('div', this.speed, el('div.veh-unit', 'KM/H')), this.gear),
      el('div.bar.rpm', this.rpm), el('div.bar-label', 'ENGINE'),
      el('div.bar.fuel', this.fuel), el('div.bar-label', 'FUEL'),
      el('div.bar.dmg', this.dmg), el('div.bar-label', 'CONDITION'),
    );
    this.root.append(
      el('div.hud-tl', this.district, this.clock),
      el('div.hud-tr', this.cash, this.wanted),
      this.objective, this.prompt, this.veh, this.toasts, this.loading, this.mapSlot,
    );
    parent.append(this.root);
    sim.bus.on('notify', (n) => this.toast(n.text, n.kind));
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const t = el(`div.toast.${kind}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), 5200);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(sim: GameSim): void {
    const p = sim.player;
    const d = DISTRICTS[districtAt(p.x, p.z)];
    const v = sim.playerVehicle;
    const x = this.extras;
    // Rebuild only when something visible changed.
    const key = [d.id, sim.env.clock(), sim.env.weather, x.cash, x.wanted, x.objective, x.prompt?.text, v ? `${Math.round(Math.abs(v.speed) * 3.6)}|${v.gear}|${Math.round(v.rpm * 40)}|${Math.round(v.fuel * 100)}|${Math.round(v.health)}` : '', sim.waitingForWorld].join('~');
    if (key === this.last) return;
    this.last = key;
    this.district.textContent = d.name;
    this.clock.textContent = `${sim.env.clock()}  ·  ${sim.env.weather}`;
    this.cash.textContent = x.cash === undefined ? '' : '$' + Math.floor(x.cash).toLocaleString('en-US');
    const w = x.wanted ?? 0;
    this.wanted.innerHTML = w > 0 ? '★'.repeat(w) + `<span class="off">${'★'.repeat(5 - w)}</span>` : '';
    this.objective.classList.toggle('hidden', !x.objective);
    if (x.objective) this.objective.textContent = x.objective;
    this.prompt.classList.toggle('hidden', !x.prompt);
    if (x.prompt) this.prompt.innerHTML = `<b>${x.prompt.key}</b>${x.prompt.text}`;
    this.veh.classList.toggle('hidden', !v);
    if (v) {
      this.speed.textContent = String(Math.round(Math.abs(v.speed) * 3.6));
      this.gear.textContent = v.isBoat ? '⚓' : v.speed < -0.5 ? 'R' : Math.abs(v.speed) < 0.3 && v.throttle === 0 ? 'N' : String(v.gear);
      this.rpm.style.width = `${Math.round(v.rpm * 100)}%`;
      this.fuel.style.width = `${Math.round(v.fuel * 100)}%`;
      this.dmg.style.width = `${Math.round(v.health)}%`;
      this.dmg.style.background = v.health > 50 ? 'var(--good)' : v.health > 25 ? 'var(--accent)' : 'var(--bad)';
    }
    this.loading.classList.toggle('hidden', !sim.waitingForWorld);
  }
}
