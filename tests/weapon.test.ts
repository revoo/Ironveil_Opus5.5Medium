import { describe, it, expect } from 'vitest';
import { stepWeapon, WEAPON_TICKS, shotStats, chargeFraction, chargeSpeedFactor, interruptCharge } from '../src/sim/weapon';
import { neutralInput, type TankInput, type WeaponState } from '../src/sim/types';
import { TUNING } from '../src/sim/tuning';

const W = (): WeaponState => ({ phase: 'ready', timer: 0, chargeTicks: 0, reloadTicks: 0 });
const inp = (p: Partial<TankInput>): TankInput => ({ ...neutralInput(), ...p });
const press = inp({ firePressed: true, fireHeld: true });
const hold = inp({ fireHeld: true });
const release = inp({ fireReleased: true });
const idle = inp({});

describe('weapon timing', () => {
  it('exposes effective durations rounded up to whole ticks', () => {
    expect(WEAPON_TICKS.charge).toBe(45);
    expect(WEAPON_TICKS.hold).toBe(45);
    expect(WEAPON_TICKS.reload).toBe(20); // 0.65 s * 30 = 19.5 -> 20
    expect(WEAPON_TICKS.cancel).toBe(8); // 7.5 -> 8
    expect(WEAPON_TICKS.vent).toBe(24);
  });

  it('a same-tick press and release fires minimum charge', () => {
    const w = W();
    const r = stepWeapon(w, inp({ firePressed: true, fireReleased: true, fireHeld: false }));
    expect(r.fired).toBe(0);
    expect(w.phase).toBe('reloading');
    expect(shotStats(0)).toEqual({ damage: TUNING.cannon.damageMin, speed: TUNING.cannon.speedMin });
  });

  it('holding for the full charge time fires full charge', () => {
    const w = W();
    stepWeapon(w, press);
    for (let i = 0; i < WEAPON_TICKS.charge; i++) stepWeapon(w, hold);
    expect(chargeFraction(w)).toBe(1);
    const r = stepWeapon(w, release);
    expect(r.fired).toBe(1);
    expect(shotStats(1)).toEqual({ damage: TUNING.cannon.damageMax, speed: TUNING.cannon.speedMax });
  });

  it('charge is linear and drives the speed factor', () => {
    const w = W();
    stepWeapon(w, press);
    for (let i = 0; i < 22; i++) stepWeapon(w, hold);
    const c = chargeFraction(w);
    expect(c).toBeCloseTo(22 / 45, 6);
    expect(chargeSpeedFactor(w)).toBeCloseTo(1 + (TUNING.movement.chargeSpeedFactor - 1) * c, 6);
    expect(chargeSpeedFactor(W())).toBe(1);
  });

  it('tap fire kills in five hits, full charge in two', () => {
    expect(Math.ceil(100 / shotStats(0).damage)).toBe(5);
    expect(Math.ceil(100 / shotStats(1).damage)).toBe(2);
  });

  it('cannot charge during reload and does not bank a held press', () => {
    const w = W();
    stepWeapon(w, inp({ firePressed: true, fireReleased: true }));
    // press again immediately and keep holding through reload
    expect(stepWeapon(w, press).fired).toBeNull();
    for (let i = 0; i < WEAPON_TICKS.reload + 5; i++) expect(stepWeapon(w, hold).fired).toBeNull();
    expect(w.phase).toBe('ready'); // held button does not start a charge
    // a fresh press does
    stepWeapon(w, press);
    expect(w.phase).toBe('charging');
  });

  it('right-click cancel enters cancel recovery and never fires', () => {
    const w = W();
    stepWeapon(w, press);
    for (let i = 0; i < 10; i++) stepWeapon(w, hold);
    const r = stepWeapon(w, inp({ fireHeld: true, cancel: true }));
    expect(r.canceled).toBe(true);
    expect(w.phase).toBe('cancel');
    expect(stepWeapon(w, release).fired).toBeNull();
    for (let i = 0; i < WEAPON_TICKS.cancel; i++) stepWeapon(w, idle);
    expect(w.phase).toBe('ready');
  });

  it('vents automatically after the hold allowance and loses the shot', () => {
    const w = W();
    stepWeapon(w, press);
    let vented = false;
    for (let i = 0; i < WEAPON_TICKS.charge + WEAPON_TICKS.hold + 2; i++) {
      const r = stepWeapon(w, hold);
      expect(r.fired).toBeNull();
      vented ||= r.vented;
    }
    expect(vented).toBe(true);
    expect(w.phase).toBe('vent');
    expect(stepWeapon(w, release).fired).toBeNull();
  });

  it('interruptCharge (smoke/death) cancels charging but keeps longer recovery', () => {
    const w = W();
    stepWeapon(w, press);
    interruptCharge(w);
    expect(w.phase).toBe('cancel');
    expect(w.timer).toBe(WEAPON_TICKS.cancel);
    const r: WeaponState = { phase: 'reloading', timer: 15, chargeTicks: 0, reloadTicks: 20 };
    interruptCharge(r);
    expect(r).toEqual({ phase: 'reloading', timer: 15, chargeTicks: 0, reloadTicks: 20 });
  });

  it('a release without a press does nothing', () => {
    const w = W();
    expect(stepWeapon(w, release).fired).toBeNull();
    expect(w.phase).toBe('ready');
  });
});
