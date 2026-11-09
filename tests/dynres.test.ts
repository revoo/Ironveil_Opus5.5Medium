import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/client/three/dynres';

const run = (d: DynamicResolution, ms: number, seconds: number) => {
  for (let t = 0; t < seconds * 1000; t += ms) d.update(ms);
};

describe('dynamic resolution', () => {
  it('stays at full scale when frames hold 60 fps', () => {
    const d = new DynamicResolution();
    run(d, 16.7, 20);
    expect(d.scale).toBe(1);
  });

  it('steps down under load, but not below the floor', () => {
    const d = new DynamicResolution(0.6);
    run(d, 40, 2);
    expect(d.scale).toBeLessThan(1);
    run(d, 40, 30);
    expect(d.scale).toBe(0.6);
  });

  it('probes back up once frames are steady again', () => {
    const d = new DynamicResolution();
    run(d, 30, 1);
    const low = d.scale;
    run(d, 16.7, 10);
    expect(d.scale).toBeGreaterThan(low);
  });

  it('backs off: a scale the machine cannot hold is retried less and less often', () => {
    const d = new DynamicResolution();
    // a GPU that holds 60 fps only at scale <= 0.8
    const frame = () => (d.scale > 0.8 ? 25 : 16.7);
    let changes = 0;
    for (let t = 0; t < 120_000; ) {
      const ms = frame();
      if (d.update(ms)) changes++;
      t += ms;
    }
    expect(d.scale).toBeLessThanOrEqual(0.9);
    expect(changes).toBeLessThan(20); // waits 3, 6, 12, 24... seconds between probes
  });

  it('ignores one-off stalls', () => {
    const d = new DynamicResolution();
    d.update(1500);
    run(d, 16.7, 1);
    expect(d.scale).toBe(1);
  });
});
