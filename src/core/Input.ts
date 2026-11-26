/** Abstract controls. The keyboard, a gamepad and scripted tests all produce the same state. */
export interface InputState {
  /** −1 (left) … 1 (right). */
  moveX: number;
  /** −1 (back / brake) … 1 (forward / throttle). */
  moveY: number;
  sprint: boolean;
  walk: boolean;
  jump: boolean;
  crouch: boolean;
  handbrake: boolean;
  /** Edge-triggered actions, true for one simulation step. */
  interact: boolean;
  enterExit: boolean;
  horn: boolean;
  lookX: number;
  lookY: number;
}

export function emptyInput(): InputState {
  return { moveX: 0, moveY: 0, sprint: false, walk: false, jump: false, crouch: false, handbrake: false, interact: false, enterExit: false, horn: false, lookX: 0, lookY: 0 };
}

export interface InputSource {
  /** Returns the controls for the next simulation step and clears one-shot actions. */
  sample(): InputState;
}

/** Deterministic input for tests and the self-test: a state that holds until changed. */
export class ScriptedInput implements InputSource {
  state = emptyInput();
  private pulses: Partial<InputState> = {};
  set(partial: Partial<InputState>): void {
    Object.assign(this.state, partial);
  }
  pulse(action: 'interact' | 'enterExit' | 'jump' | 'horn'): void {
    this.pulses[action] = true;
  }
  sample(): InputState {
    const s = { ...this.state, ...this.pulses };
    this.pulses = {};
    return s;
  }
}

/** Keyboard and mouse (pointer lock), plus the first connected gamepad. */
export class BrowserInput implements InputSource {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  enabled = true;
  onKey: ((code: string) => void) | null = null;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || (e.buttons & 1)) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
  }

  releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  sample(): InputState {
    const k = this.keys;
    const s = emptyInput();
    if (!this.enabled) {
      this.pressed.clear();
      this.lookX = this.lookY = 0;
      return s;
    }
    s.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.moveY = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    s.walk = k.has('AltLeft');
    s.crouch = k.has('KeyC') || k.has('ControlLeft');
    s.handbrake = k.has('Space');
    s.jump = this.pressed.has('Space');
    s.interact = this.pressed.has('KeyE');
    s.enterExit = this.pressed.has('KeyF');
    s.horn = k.has('KeyH');
    s.lookX = this.lookX;
    s.lookY = this.lookY;
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      s.moveX += dz(pad.axes[0] ?? 0);
      const trig = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      s.moveY += Math.abs(trig) > 0.05 ? trig : -dz(pad.axes[1] ?? 0);
      s.lookX += dz(pad.axes[2] ?? 0) * 14;
      s.lookY += dz(pad.axes[3] ?? 0) * 10;
      s.sprint ||= !!pad.buttons[0]?.pressed;
      s.handbrake ||= !!pad.buttons[5]?.pressed;
      s.moveX = Math.max(-1, Math.min(1, s.moveX));
      s.moveY = Math.max(-1, Math.min(1, s.moveY));
    }
    this.pressed.clear();
    this.lookX = this.lookY = 0;
    return s;
  }
}
