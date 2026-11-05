// Chargeable cannon state machine: ready -> charging -> (fire -> reloading) | cancel | vent.
import { lerp } from './math';
import type { TankInput, WeaponState } from './types';
import { TUNING, ticks } from './tuning';

const C = TUNING.cannon;

/** Effective durations in whole ticks (rounded up). Exposed for diagnostics/HUD. */
export const WEAPON_TICKS = {
  charge: ticks(C.chargeTime),
  hold: ticks(C.holdAllowance),
  reload: ticks(C.reload),
  cancel: ticks(C.cancelRecovery),
  vent: ticks(C.ventRecovery),
} as const;

export interface WeaponStepResult {
  /** Charge fraction of the shot fired this tick, or null. */
  fired: number | null;
  vented: boolean;
  canceled: boolean;
}

export function chargeFraction(w: WeaponState): number {
  return w.phase === 'charging' ? Math.min(1, w.chargeTicks / WEAPON_TICKS.charge) : 0;
}

export function chargeSpeedFactor(w: WeaponState): number {
  return lerp(1, TUNING.movement.chargeSpeedFactor, chargeFraction(w));
}

export function shotStats(charge: number): { damage: number; speed: number } {
  return {
    damage: Math.round(lerp(C.damageMin, C.damageMax, charge)),
    speed: lerp(C.speedMin, C.speedMax, charge),
  };
}

/** Remaining hold-window ticks once fully charged (null if not fully charged). */
export function holdRemaining(w: WeaponState): number | null {
  if (w.phase !== 'charging' || w.chargeTicks < WEAPON_TICKS.charge) return null;
  return WEAPON_TICKS.charge + WEAPON_TICKS.hold - w.chargeTicks;
}

/** Smoke deployment or other interruptions: cancel an active charge (keeps longer recoveries). */
export function interruptCharge(w: WeaponState): boolean {
  if (w.phase === 'charging') {
    w.phase = 'cancel';
    w.timer = WEAPON_TICKS.cancel;
    w.chargeTicks = 0;
    return true;
  }
  if (w.phase === 'ready') return false;
  if (w.timer < WEAPON_TICKS.cancel && w.phase === 'cancel') w.timer = WEAPON_TICKS.cancel;
  return false;
}

export function resetWeapon(w: WeaponState): void {
  w.phase = 'ready';
  w.timer = 0;
  w.chargeTicks = 0;
}

export function stepWeapon(w: WeaponState, input: TankInput): WeaponStepResult {
  const res: WeaponStepResult = { fired: null, vented: false, canceled: false };
  switch (w.phase) {
    case 'reloading':
    case 'cancel':
    case 'vent':
      w.timer--;
      if (w.timer <= 0) {
        w.phase = 'ready';
        w.timer = 0;
      }
      // Presses during recovery are ignored; a fresh press is required afterwards.
      return res;
    case 'ready':
      if (!input.firePressed) return res;
      w.phase = 'charging';
      w.chargeTicks = 0;
      if (input.fireReleased && !input.fireHeld) return fire(w, res);
      if (input.cancel) return cancel(w, res);
      return res;
    case 'charging':
      if (input.cancel) return cancel(w, res);
      w.chargeTicks++;
      if (input.fireReleased || !input.fireHeld) return fire(w, res);
      if (w.chargeTicks >= WEAPON_TICKS.charge + WEAPON_TICKS.hold) {
        w.phase = 'vent';
        w.timer = WEAPON_TICKS.vent;
        w.chargeTicks = 0;
        res.vented = true;
      }
      return res;
  }
}

function fire(w: WeaponState, res: WeaponStepResult): WeaponStepResult {
  res.fired = chargeFraction(w);
  w.phase = 'reloading';
  w.timer = WEAPON_TICKS.reload;
  w.chargeTicks = 0;
  return res;
}

function cancel(w: WeaponState, res: WeaponStepResult): WeaponStepResult {
  w.phase = 'cancel';
  w.timer = WEAPON_TICKS.cancel;
  w.chargeTicks = 0;
  res.canceled = true;
  return res;
}
