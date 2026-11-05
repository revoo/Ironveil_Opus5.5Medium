// Procedurally generated art (no external assets). Tanks face +x.
import Phaser from 'phaser';
import { Terrain, tileAt, type GameMap } from '../sim/map';
import { Rng } from '../sim/rng';

export const TEAM_COLORS = [
  { body: '#3f8fb5', dark: '#1f4f68', light: '#8fd6f2', accent: '#d8f6ff', hex: 0x57b6e0, name: 'Ironveil' },
  { body: '#c25a32', dark: '#6e2c14', light: '#f0a070', accent: '#ffe1c0', hex: 0xe8703f, name: 'Rustguard' },
] as const;

const S = 2; // supersampling for crisp sprites at camera zoom 2

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hull(team: 0 | 1, charred = false): HTMLCanvasElement {
  const W = 56 * S;
  const H = 46 * S;
  const [c, ctx] = canvas(W, H);
  ctx.scale(S, S);
  const col = charred ? { body: '#2b2724', dark: '#141210', light: '#4a3f36', accent: '#5a4a3a' } : TEAM_COLORS[team];
  // treads
  for (const y of [1, 35]) {
    ctx.fillStyle = '#1b1d1f';
    rr(ctx, 3, y, 50, 10, 3);
    ctx.fill();
    ctx.fillStyle = '#34383b';
    for (let x = 5; x < 52; x += 4) ctx.fillRect(x, y + 1, 2, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(4, y + 1, 48, 2);
  }
  // body
  const g = ctx.createLinearGradient(0, 8, 0, 38);
  g.addColorStop(0, col.light);
  g.addColorStop(0.45, col.body);
  g.addColorStop(1, col.dark);
  ctx.fillStyle = g;
  if (team === 0) {
    // angular chevron glacis
    ctx.beginPath();
    ctx.moveTo(6, 9);
    ctx.lineTo(42, 9);
    ctx.lineTo(53, 23);
    ctx.lineTo(42, 37);
    ctx.lineTo(6, 37);
    ctx.lineTo(3, 23);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // chevron marking
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(36, 14);
    ctx.lineTo(44, 23);
    ctx.lineTo(36, 32);
    ctx.stroke();
  } else {
    // boxy hull with side skirts
    rr(ctx, 4, 8, 48, 30, 3);
    ctx.fill();
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = col.dark;
    ctx.fillRect(8, 8, 36, 3);
    ctx.fillRect(8, 35, 36, 3);
    // bar markings
    ctx.fillStyle = col.accent;
    ctx.fillRect(40, 14, 3, 18);
    ctx.fillRect(45, 14, 3, 18);
  }
  // panel lines and engine deck
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(8, 14, 10, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 16; y < 31; y += 3) ctx.fillRect(9, y, 8, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(20, 11, 18, 2);
  return c;
}

function turretBody(team: 0 | 1, charred = false): HTMLCanvasElement {
  const W = 30 * S;
  const [c, ctx] = canvas(W, W);
  ctx.scale(S, S);
  const col = charred ? { body: '#2e2a26', dark: '#151311', light: '#4a4038' } : TEAM_COLORS[team];
  const g = ctx.createRadialGradient(12, 11, 2, 15, 15, 14);
  g.addColorStop(0, col.light);
  g.addColorStop(0.6, col.body);
  g.addColorStop(1, col.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  if (team === 0) ctx.arc(15, 15, 11, 0, Math.PI * 2);
  else for (let i = 0; i < 6; i++) ctx[i ? 'lineTo' : 'moveTo'](15 + Math.cos((i * Math.PI) / 3) * 12, 15 + Math.sin((i * Math.PI) / 3) * 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(11, 15, 3, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function barrel(): HTMLCanvasElement {
  const [c, ctx] = canvas(34 * S, 8 * S);
  ctx.scale(S, S);
  const g = ctx.createLinearGradient(0, 1, 0, 7);
  g.addColorStop(0, '#9aa0a6');
  g.addColorStop(0.5, '#4a4f55');
  g.addColorStop(1, '#202326');
  ctx.fillStyle = g;
  ctx.fillRect(0, 2, 30, 4);
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(28, 1, 6, 6); // muzzle brake
  ctx.fillStyle = '#15171a';
  ctx.fillRect(31, 2.5, 1, 3);
  return c;
}

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function smokePuff(seed: number): HTMLCanvasElement {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  const r = new Rng(seed);
  for (let i = 0; i < 22; i++) {
    const a = r.next() * Math.PI * 2;
    const d = r.next() * 30;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const rad = 18 + r.next() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const v = 200 + Math.floor(r.next() * 55);
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return c;
}

function spark(): HTMLCanvasElement {
  const [c, ctx] = canvas(24, 6);
  const g = ctx.createLinearGradient(0, 0, 24, 0);
  g.addColorStop(0, 'rgba(255,200,120,0)');
  g.addColorStop(0.6, 'rgba(255,230,170,0.9)');
  g.addColorStop(1, 'rgba(255,255,240,1)');
  ctx.fillStyle = g;
  rr(ctx, 0, 1, 24, 4, 2);
  ctx.fill();
  return c;
}

function shell(): HTMLCanvasElement {
  const [c, ctx] = canvas(40, 14);
  const g = ctx.createLinearGradient(0, 0, 40, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  rr(ctx, 0, 4, 40, 6, 3);
  ctx.fill();
  const r = ctx.createRadialGradient(33, 7, 0, 33, 7, 7);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(24, 0, 16, 14);
  return c;
}

function debris(seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(12, 12);
  const r = new Rng(seed);
  ctx.fillStyle = r.chance(0.5) ? '#4a4540' : '#6a625a';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const d = 3 + r.next() * 3;
    ctx[i ? 'lineTo' : 'moveTo'](6 + Math.cos(a) * d, 6 + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(4, 4, 2, 2);
  return c;
}

function track(): HTMLCanvasElement {
  const [c, ctx] = canvas(20, 44);
  ctx.fillStyle = 'rgba(40,26,14,0.75)';
  for (const x of [1, 13]) {
    for (let y = 2; y < 42; y += 5) ctx.fillRect(x, y, 6, 3);
  }
  return c;
}

function cone(): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 128);
  const g = ctx.createRadialGradient(0, 64, 0, 0, 64, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 64);
  ctx.lineTo(256, 0);
  ctx.lineTo(256, 128);
  ctx.closePath();
  ctx.fill();
  return c;
}

function flash(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 32);
  const g = ctx.createRadialGradient(8, 16, 0, 8, 16, 56);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.3, 'rgba(255,210,120,0.9)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.quadraticCurveTo(40, 0, 64, 16);
  ctx.quadraticCurveTo(40, 32, 0, 22);
  ctx.closePath();
  ctx.fill();
  return c;
}

function ring(): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

export function registerTextures(scene: Phaser.Scene): void {
  const add = (k: string, c: HTMLCanvasElement) => {
    if (!scene.textures.exists(k)) scene.textures.addCanvas(k, c);
  };
  add('hull0', hull(0));
  add('hull1', hull(1));
  add('hullX0', hull(0, true));
  add('hullX1', hull(1, true));
  add('turret0', turretBody(0));
  add('turret1', turretBody(1));
  add('turretX0', turretBody(0, true));
  add('turretX1', turretBody(1, true));
  add('barrel', barrel());
  add('glow', radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));
  add('soft', radial(64, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]));
  add('shadow', radial(64, [[0, 'rgba(0,0,0,0.6)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]));
  add('scorch', radial(64, [[0, 'rgba(10,8,6,0.8)'], [0.5, 'rgba(20,14,10,0.45)'], [1, 'rgba(0,0,0,0)']]));
  for (let i = 0; i < 4; i++) add(`puff${i}`, smokePuff(17 + i * 101));
  add('spark', spark());
  add('shell', shell());
  for (let i = 0; i < 3; i++) add(`debris${i}`, debris(5 + i * 13));
  add('track', track());
  add('cone', cone());
  add('flash', flash());
  add('ring', ring());
  add('px', radial(8, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,1)']]));
}

// ------------------------------------------------------------------ terrain

function themeAt(map: GameMap, x: number, y: number): string {
  let best = '';
  let bd = Infinity;
  for (const l of map.landmarks) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < bd) {
      bd = d;
      best = l.name;
    }
  }
  return bd < 420 ? best : 'field';
}

/** Ground (grass/road/mud/brush floor), wall shadows and wall blocks baked into one canvas. */
export function bakeTerrain(map: GameMap): { ground: HTMLCanvasElement; canopy: HTMLCanvasElement; mini: HTMLCanvasElement } {
  const W = map.width;
  const H = map.height;
  const ts = map.tile;
  const [ground, g] = canvas(W, H);
  const r = new Rng(1337);

  // Base per-pixel noise field (cheap value noise via ImageData)
  const img = g.createImageData(W, H);
  const d = img.data;
  const noise = new Float32Array(((W >> 3) + 2) * ((H >> 3) + 2));
  for (let i = 0; i < noise.length; i++) noise[i] = r.next();
  const nW = (W >> 3) + 2;
  const nH = (H >> 3) + 2;
  const sample = (x: number, y: number) => {
    const fx = x / 8;
    const fy = y / 8;
    const ix0 = Math.floor(fx);
    const iy0 = Math.floor(fy);
    const tx = fx - ix0;
    const ty = fy - iy0;
    const ix = ix0 % (nW - 1);
    const iy = iy0 % (nH - 1);
    const a = noise[iy * nW + ix]!;
    const b = noise[iy * nW + ix + 1]!;
    const c = noise[(iy + 1) * nW + ix]!;
    const e = noise[(iy + 1) * nW + ix + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = tileAt(map, Math.floor(x / ts), Math.floor(y / ts));
      const n = sample(x, y) * 0.6 + sample(x * 3.1, y * 3.1) * 0.4;
      const fine = r.next() * 0.08;
      let R = 0;
      let G = 0;
      let B = 0;
      switch (t) {
        case Terrain.Road: {
          const v = 78 + n * 22 + fine * 60;
          R = v;
          G = v - 2;
          B = v - 6;
          break;
        }
        case Terrain.Mud: {
          const wet = n > 0.62 ? 1 : 0;
          R = 74 + n * 26 - wet * 18;
          G = 54 + n * 18 - wet * 12;
          B = 34 + n * 10 - wet * 4;
          break;
        }
        case Terrain.Brush:
          R = 38 + n * 16;
          G = 64 + n * 22;
          B = 32 + n * 10;
          break;
        case Terrain.Wall:
          R = 50;
          G = 52;
          B = 54;
          break;
        default: {
          R = 70 + n * 26 + fine * 40;
          G = 98 + n * 34 + fine * 40;
          B = 52 + n * 14;
        }
      }
      const i = (y * W + x) * 4;
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = B;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Road markings and kerbs
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const t = tileAt(map, col, row);
      const x = col * ts;
      const y = row * ts;
      if (t === Terrain.Road) {
        g.fillStyle = 'rgba(30,30,32,0.35)';
        if (tileAt(map, col, row - 1) !== Terrain.Road) g.fillRect(x, y, ts, 3);
        if (tileAt(map, col, row + 1) !== Terrain.Road) g.fillRect(x, y + ts - 3, ts, 3);
        if (tileAt(map, col - 1, row) !== Terrain.Road) g.fillRect(x, y, 3, ts);
        if (tileAt(map, col + 1, row) !== Terrain.Road) g.fillRect(x + ts - 3, y, 3, ts);
        if (r.chance(0.12)) {
          g.fillStyle = 'rgba(20,20,20,0.25)';
          g.beginPath();
          g.ellipse(x + r.next() * ts, y + r.next() * ts, 3 + r.next() * 6, 2 + r.next() * 3, r.next() * 3, 0, Math.PI * 2);
          g.fill();
        }
      } else if (t === Terrain.Grass) {
        // grass tufts and pebbles
        for (let k = 0; k < 4; k++) {
          g.strokeStyle = r.chance(0.5) ? 'rgba(140,170,90,0.35)' : 'rgba(40,60,30,0.35)';
          g.lineWidth = 1;
          const gx = x + r.next() * ts;
          const gy = y + r.next() * ts;
          g.beginPath();
          g.moveTo(gx, gy);
          g.lineTo(gx + (r.next() - 0.5) * 4, gy - 3 - r.next() * 3);
          g.stroke();
        }
        if (r.chance(0.05)) {
          g.fillStyle = 'rgba(160,150,130,0.5)';
          g.fillRect(x + r.next() * ts, y + r.next() * ts, 2, 2);
        }
      } else if (t === Terrain.Mud) {
        if (r.chance(0.35)) {
          g.fillStyle = 'rgba(120,110,100,0.22)';
          g.beginPath();
          g.ellipse(x + r.next() * ts, y + r.next() * ts, 4 + r.next() * 8, 2 + r.next() * 4, r.next() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  // Wall shadows (cast toward south-east)
  g.fillStyle = 'rgba(0,0,0,0.38)';
  for (let row = 0; row < map.rows; row++)
    for (let col = 0; col < map.cols; col++)
      if (tileAt(map, col, row) === Terrain.Wall) g.fillRect(col * ts + 9, row * ts + 12, ts, ts);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let row = 0; row < map.rows; row++)
    for (let col = 0; col < map.cols; col++)
      if (tileAt(map, col, row) === Terrain.Wall) g.fillRect(col * ts + 16, row * ts + 20, ts, ts);

  // Wall blocks: top face + south face, themed by nearest landmark
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (tileAt(map, col, row) !== Terrain.Wall) continue;
      const x = col * ts;
      const y = row * ts;
      const theme = themeAt(map, x, y);
      const border = col === 0 || row === 0 || col === map.cols - 1 || row === map.rows - 1;
      let top = '#6d7074';
      let side = '#3c3e41';
      if (theme === 'Depot' || theme === 'Foundry') {
        top = '#7a6650';
        side = '#463626';
      } else if (theme === 'Radio Tower') {
        top = '#8a8e93';
        side = '#4a4d52';
      } else if (theme === 'Broken Bridge' || theme === 'Quarry Cut') {
        top = '#857a6a';
        side = '#4c4438';
      } else if (border) {
        top = '#4f5a4a';
        side = '#2c3329';
      }
      const southOpen = tileAt(map, col, row + 1) !== Terrain.Wall;
      g.fillStyle = side;
      g.fillRect(x, y, ts, ts);
      g.fillStyle = top;
      g.fillRect(x, y, ts, southOpen ? ts - 8 : ts);
      // bevel/highlights where edges are exposed
      g.fillStyle = 'rgba(255,255,255,0.12)';
      if (tileAt(map, col, row - 1) !== Terrain.Wall) g.fillRect(x, y, ts, 2);
      if (tileAt(map, col - 1, row) !== Terrain.Wall) g.fillRect(x, y, 2, southOpen ? ts - 8 : ts);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      if (tileAt(map, col + 1, row) !== Terrain.Wall) g.fillRect(x + ts - 2, y, 2, ts);
      // texture
      if (theme === 'Depot' || theme === 'Foundry') {
        g.fillStyle = 'rgba(0,0,0,0.14)';
        for (let k = 3; k < ts - 8; k += 5) g.fillRect(x, y + k, ts, 2); // corrugated roof
      } else if (border) {
        g.fillStyle = 'rgba(60,90,50,0.5)';
        for (let k = 0; k < 3; k++) g.fillRect(x + r.next() * ts, y + r.next() * (ts - 8), 3, 3);
      } else {
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.lineWidth = 1;
        g.beginPath();
        const cx = x + r.next() * ts;
        g.moveTo(cx, y + 2);
        g.lineTo(cx + (r.next() - 0.5) * 10, y + ts - 10);
        g.stroke();
      }
    }
  }

  // Radio tower mast on its block
  const tower = map.landmarks.find((l) => l.name === 'Radio Tower');
  if (tower) {
    const cx = 37 * ts + 16;
    const cy = 25 * ts;
    g.strokeStyle = 'rgba(30,30,34,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 20, cy + 30);
    g.lineTo(cx, cy - 40);
    g.lineTo(cx + 20, cy + 30);
    g.stroke();
    g.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.moveTo(cx - 18 + k * 3.5, cy + 24 - k * 14);
      g.lineTo(cx + 18 - k * 3.5, cy + 24 - k * 14);
      g.stroke();
    }
    g.fillStyle = '#ff4a3a';
    g.beginPath();
    g.arc(cx, cy - 42, 3, 0, Math.PI * 2);
    g.fill();
  }

  // Canopy (drawn above tanks): leafy clumps over brush tiles, spilling slightly outside.
  const [canopy, cg] = canvas(W, H);
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (tileAt(map, col, row) !== Terrain.Brush) continue;
      const x = col * ts;
      const y = row * ts;
      for (let k = 0; k < 9; k++) {
        const px = x + r.next() * ts;
        const py = y + r.next() * ts;
        const rad = 6 + r.next() * 9;
        const shade = Math.floor(r.next() * 40);
        const gr = cg.createRadialGradient(px - 2, py - 2, 1, px, py, rad);
        gr.addColorStop(0, `rgba(${70 + shade},${120 + shade},${50 + shade / 2},0.95)`);
        gr.addColorStop(0.8, `rgba(${30 + shade / 2},${70 + shade / 2},${30},0.9)`);
        gr.addColorStop(1, 'rgba(20,40,20,0)');
        cg.fillStyle = gr;
        cg.beginPath();
        cg.arc(px, py, rad, 0, Math.PI * 2);
        cg.fill();
      }
    }
  }

  // Minimap (1 px = 8 world px)
  const mw = Math.ceil(W / 8);
  const mh = Math.ceil(H / 8);
  const [mini, mg] = canvas(mw, mh);
  const colors: Record<number, string> = {
    [Terrain.Grass]: '#3d5a32',
    [Terrain.Road]: '#5c5c5c',
    [Terrain.Mud]: '#5a4430',
    [Terrain.Brush]: '#2c4a24',
    [Terrain.Wall]: '#b8bcc2',
  };
  for (let row = 0; row < map.rows; row++)
    for (let col = 0; col < map.cols; col++) {
      mg.fillStyle = colors[tileAt(map, col, row)]!;
      mg.fillRect(col * 4, row * 4, 4, 4);
    }
  return { ground, canopy, mini };
}
