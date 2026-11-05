import { describe, it, expect } from 'vitest';
import { InputManager } from '../src/client/input';
import { defaultSettings } from '../src/client/settings';

function mk() {
  const s = defaultSettings();
  const im = new InputManager(s);
  const raw = im as unknown as { down(c: string): void; up(c: string): void };
  return { im, s, down: (c: string) => raw.down(c), up: (c: string) => raw.up(c) };
}
const aim = { x: 0, y: 0 };

describe('input edges and bindings', () => {
  it('Space is fire by default and Q is smoke', () => {
    const { s } = mk();
    expect(s.bindings.fire[0]).toBe('Space');
    expect(s.bindings.smoke).toContain('KeyQ');
    expect(s.bindings.cancel).toContain('Mouse2');
  });

  it('a quick tap between ticks is never lost', () => {
    const { im, down, up } = mk();
    down('Space');
    up('Space');
    const i = im.sample(aim);
    expect(i.firePressed).toBe(true);
    expect(i.fireReleased).toBe(true);
    expect(i.fireHeld).toBe(false);
    const j = im.sample(aim);
    expect(j.firePressed || j.fireReleased).toBe(false);
  });

  it('holding produces one press edge then a held state, release on letting go', () => {
    const { im, down, up } = mk();
    down('Space');
    expect(im.sample(aim)).toMatchObject({ firePressed: true, fireHeld: true });
    expect(im.sample(aim)).toMatchObject({ firePressed: false, fireHeld: true });
    up('Space');
    expect(im.sample(aim)).toMatchObject({ fireReleased: true, fireHeld: false });
  });

  it('two fire bindings act as one button', () => {
    const { im, down, up } = mk();
    down('Space');
    down('Mouse0');
    im.sample(aim);
    up('Mouse0');
    expect(im.sample(aim)).toMatchObject({ fireReleased: false, fireHeld: true });
    up('Space');
    expect(im.sample(aim).fireReleased).toBe(true);
  });

  it('focus loss cancels a held charge instead of firing it', () => {
    const { im, down } = mk();
    down('Space');
    im.sample(aim);
    im.releaseAll();
    const i = im.sample(aim);
    expect(i.fireReleased).toBe(false);
    expect(i.fireHeld).toBe(false);
    expect(i.cancel).toBe(true);
  });

  it('WASD gives a world-space direction; remapping is respected', () => {
    const { im, s, down, up } = mk();
    down('KeyD');
    down('KeyS');
    expect(im.sample(aim)).toMatchObject({ moveX: 1, moveY: 1 });
    up('KeyD');
    up('KeyS');
    s.bindings.smoke = ['KeyF'];
    down('KeyQ');
    expect(im.sample(aim).smoke).toBe(false);
    down('KeyF');
    expect(im.sample(aim).smoke).toBe(true);
  });
});
