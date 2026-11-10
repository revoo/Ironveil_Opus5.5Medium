import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIGHT_SKIP } from '../src/client/three/materials';

// materials.ts rewrites one three.js shader chunk so lights that don't reach a pixel skip the BRDF.
// It is a string replacement: if a three.js upgrade rewords the chunk, the patch would silently stop
// applying and every pixel would pay for all sixteen lights again. This fails instead.
describe('light early-out shader patch', () => {
  it('wraps the direct lighting of every light type', () => {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const wrapped = chunk.split(LIGHT_SKIP).length - 1;
    expect(wrapped).toBeGreaterThanOrEqual(3); // point, spot, directional (and sun, where three has it)
    expect(chunk.replaceAll(LIGHT_SKIP, '')).not.toContain('RE_Direct(');
  });
});
