import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture boundaries', () => {
  for (const pkg of ['src/sim', 'src/ai', 'src/game', 'src/level']) {
    it(`${pkg} imports no presentation, DOM or client code`, () => {
      for (const f of files(pkg)) {
        const src = readFileSync(f, 'utf8');
        expect(src, f).not.toMatch(/from ['"]phaser['"]/);
        expect(src, f).not.toMatch(/from ['"][./]*client\//);
        expect(src, f).not.toMatch(/\b(window|document|localStorage|requestAnimationFrame)\./);
      }
    });
  }
  it('AI never imports the authoritative world module', () => {
    for (const f of files('src/ai')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"][./]*sim\/world['"]/);
    }
  });
});
