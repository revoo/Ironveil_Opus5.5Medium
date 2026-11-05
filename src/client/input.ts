// Keyboard + mouse to TankInput, with remappable bindings and press/release edges that
// survive between simulation ticks (a quick tap is never lost).
import type { Vec } from '../sim/math';
import type { TankInput } from '../sim/types';
import type { Action, Settings } from './settings';

export class InputManager {
  private held = new Set<string>();
  private firePressed = false;
  private fireReleased = false;
  private cancelEdge = false;
  private smokeEdge = false;
  private listeners: (() => void)[] = [];
  onAction: (a: Action) => void = () => {};
  /** Capture the next key for rebinding. */
  captureNext: ((code: string) => void) | null = null;

  constructor(private settings: Settings) {}

  attach(canvasHost: HTMLElement): void {
    const kd = (e: KeyboardEvent) => {
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        return;
      }
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down(e.code);
    };
    const ku = (e: KeyboardEvent) => this.up(e.code);
    const md = (e: MouseEvent) => {
      if (this.captureNext) {
        const cb = this.captureNext;
        this.captureNext = null;
        cb(`Mouse${e.button}`);
        return;
      }
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
      this.down(`Mouse${e.button}`);
    };
    const mu = (e: MouseEvent) => this.up(`Mouse${e.button}`);
    const cm = (e: Event) => e.preventDefault();
    const blur = () => this.releaseAll();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    canvasHost.addEventListener('contextmenu', cm);
    window.addEventListener('blur', blur);
    this.listeners.push(
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
      () => window.removeEventListener('mousedown', md),
      () => window.removeEventListener('mouseup', mu),
      () => canvasHost.removeEventListener('contextmenu', cm),
      () => window.removeEventListener('blur', blur),
    );
  }

  detach(): void {
    for (const l of this.listeners) l();
    this.listeners = [];
  }

  private bound(a: Action, code: string): boolean {
    return this.settings.bindings[a].includes(code);
  }

  isDown(a: Action): boolean {
    for (const c of this.settings.bindings[a]) if (this.held.has(c)) return true;
    return false;
  }

  private down(code: string): void {
    const wasFire = this.isDown('fire');
    this.held.add(code);
    if (this.bound('fire', code) && !wasFire) this.firePressed = true;
    if (this.bound('cancel', code)) this.cancelEdge = true;
    if (this.bound('smoke', code)) this.smokeEdge = true;
    if (this.bound('pause', code)) this.onAction('pause');
    if (this.bound('scoreboard', code)) this.onAction('scoreboard');
  }

  private up(code: string): void {
    const wasFire = this.isDown('fire');
    this.held.delete(code);
    if (wasFire && !this.isDown('fire')) this.fireReleased = true;
  }

  /** Focus loss / pause: drop everything held. A held charge is released as a cancel, never a shot. */
  releaseAll(): void {
    const wasFire = this.isDown('fire');
    this.held.clear();
    this.firePressed = false;
    this.fireReleased = false;
    if (wasFire) this.cancelEdge = true;
    this.smokeEdge = false;
  }

  /** Called exactly once per simulation tick. */
  sample(aim: Vec): TankInput {
    let mx = 0;
    let my = 0;
    if (this.isDown('left')) mx -= 1;
    if (this.isDown('right')) mx += 1;
    if (this.isDown('up')) my -= 1;
    if (this.isDown('down')) my += 1;
    const inp: TankInput = {
      moveX: mx,
      moveY: my,
      aimX: aim.x,
      aimY: aim.y,
      fireHeld: this.isDown('fire'),
      firePressed: this.firePressed,
      fireReleased: this.fireReleased,
      cancel: this.cancelEdge,
      smoke: this.smokeEdge,
      silent: this.isDown('silent'),
    };
    this.firePressed = false;
    this.fireReleased = false;
    this.cancelEdge = false;
    this.smokeEdge = false;
    return inp;
  }
}
