// Street dressing that tells the setting (docs/SETTING.md): the Directorate's posters, banners,
// zone signs, notices and street signs on its buildings, and Vostravan resistance graffiti sprayed
// over them in Cyrillic. Everything is painted once into one 1024² canvas atlas and placed as small
// planes on the building faces the isometric camera sees (+x and +z), so all of it merges into a
// single static draw (alpha-tested, not transparent, so `mergeStatic` takes it).
//
// The Directorate's look is slate, ochre and paper with a gate-tower emblem; never eagles,
// black-white-red or blackletter.
import * as THREE from 'three';
import { canvasTexture, rand } from './models';

const SLATE = '#4c5358';
const SLATE_D = '#2c3134';
const OCHRE = '#c89b37';
const PAPER = '#d9d0b9';
const INK = '#1a1c1d';
const RED = '#b8261c';

const SANS = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Atlas regions (canvas pixels). */
export const TILES = {
  posterOrder: { x: 0, y: 0, w: 256, h: 360 },
  posterPapers: { x: 256, y: 0, w: 256, h: 360 },
  posterDefaced: { x: 512, y: 0, w: 256, h: 360 },
  banner: { x: 768, y: 0, w: 256, h: 1024 },
  zone: { x: 0, y: 368, w: 512, h: 160 },
  notice: { x: 512, y: 368, w: 256, h: 320 },
  shop: { x: 0, y: 536, w: 512, h: 128 },
  street: { x: 0, y: 672, w: 384, h: 112 },
  sprayHome: { x: 400, y: 696, w: 368, h: 92 },
  sprayLives: { x: 0, y: 792, w: 768, h: 140 },
} satisfies Record<string, Tile>;
export type SignKind = keyof typeof TILES;

/** Text squeezed horizontally to fit `maxW`, like condensed signage lettering. */
function fit(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, size: number, weight = 'bold'): void {
  ctx.font = `${weight} ${size}px ${SANS}`;
  const w = ctx.measureText(text).width;
  const sx = Math.min(1, maxW / Math.max(1, w));
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(sx, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** The Directorate's mark: a crenellated gate tower with an arch. */
function tower(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string, hole: string): void {
  ctx.fillStyle = color;
  const w = s, h = s * 1.15;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.fillRect(x, y + h * 0.18, w, h * 0.82);
  const m = w / 7;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 2 * m, y, m, h * 0.2);
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.2, y + h);
  ctx.lineTo(cx - w * 0.2, y + h * 0.62);
  ctx.arc(cx, y + h * 0.62, w * 0.2, Math.PI, 0);
  ctx.lineTo(cx + w * 0.2, y + h);
  ctx.fill();
}

/** Weathering: grime blotches, scuffs, a darker lower edge. */
function weather(ctx: CanvasRenderingContext2D, t: Tile, r: () => number, amount = 1): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.y, t.w, t.h);
  ctx.clip();
  for (let i = 0; i < 26 * amount; i++) {
    ctx.fillStyle = `rgba(30,26,20,${0.04 + r() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(t.x + r() * t.w, t.y + r() * t.h, 4 + r() * 22, 3 + r() * 14, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, t.y + t.h * 0.6, 0, t.y + t.h);
  g.addColorStop(0, 'rgba(20,18,14,0)');
  g.addColorStop(1, `rgba(20,18,14,${0.35 * amount})`);
  ctx.fillStyle = g;
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.restore();
}

/** A torn corner (cut to transparent, so the wall shows through). */
function tear(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  const cx = r() < 0.5 ? t.x : t.x + t.w;
  const cy = t.y + t.h;
  ctx.moveTo(cx, cy);
  const k = 40 + r() * 50;
  ctx.lineTo(cx + (cx === t.x ? k : -k), cy);
  for (let i = 0; i < 6; i++) ctx.lineTo(cx + (cx === t.x ? 1 : -1) * k * (1 - i / 6) * (0.6 + r() * 0.5), cy - (i / 6) * k * 1.1);
  ctx.lineTo(cx, cy - k);
  ctx.fill();
  ctx.restore();
}

/** Spray paint: a line of text with soft edges and drips. */
function spray(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, size: number, color: string, r: () => number): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  fit(ctx, text, cx, cy, maxW, size, '900');
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = cx - maxW / 2 + r() * maxW;
    const y = cy + size * 0.3;
    ctx.lineWidth = 1.5 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 2, y + 8 + r() * 28);
    ctx.stroke();
  }
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? rad * 0.4 : rad;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.fill();
}

function paintOrderPoster(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = SLATE;
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.fillStyle = OCHRE;
  ctx.fillRect(t.x, t.y + 222, t.w, 10);
  tower(ctx, t.x + t.w / 2, t.y + 118, 110, OCHRE, SLATE);
  ctx.fillStyle = PAPER;
  fit(ctx, 'ORDNUNG', t.x + t.w / 2, t.y + 268, t.w - 30, 52);
  fit(ctx, 'IST SICHERHEIT', t.x + t.w / 2, t.y + 312, t.w - 40, 30);
  ctx.fillStyle = OCHRE;
  fit(ctx, 'DAS DIREKTORAT', t.x + t.w / 2, t.y + 343, t.w - 80, 14);
  weather(ctx, t, r);
}

function paintPapersPoster(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(t.x, t.y, t.w, t.h);
  // a document, a stamp
  ctx.fillStyle = '#efe8d6';
  ctx.save();
  ctx.translate(t.x + t.w / 2, t.y + 120);
  ctx.rotate(-0.08);
  ctx.fillRect(-62, -82, 124, 164);
  ctx.fillStyle = '#9a9384';
  for (let i = 0; i < 9; i++) ctx.fillRect(-48, -60 + i * 14, i % 3 === 2 ? 60 : 96, 4);
  ctx.strokeStyle = OCHRE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(28, 46, 30, 0, Math.PI * 2);
  ctx.stroke();
  tower(ctx, 28, 46, 26, OCHRE, '#efe8d6');
  ctx.restore();
  ctx.fillStyle = INK;
  fit(ctx, 'PAPIERE', t.x + t.w / 2, t.y + 254, t.w - 30, 50);
  fit(ctx, 'BEREITHALTEN', t.x + t.w / 2, t.y + 298, t.w - 30, 34);
  ctx.fillStyle = SLATE;
  ctx.fillRect(t.x, t.y + 322, t.w, 38);
  ctx.fillStyle = PAPER;
  fit(ctx, 'KONTROLLE JEDERZEIT', t.x + t.w / 2, t.y + 341, t.w - 50, 18);
  weather(ctx, t, r);
}

function paintBanner(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = SLATE_D;
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.fillStyle = OCHRE;
  ctx.fillRect(t.x + 18, t.y, 14, t.h);
  ctx.fillRect(t.x + t.w - 32, t.y, 14, t.h);
  tower(ctx, t.x + t.w / 2, t.y + 300, 130, OCHRE, SLATE_D);
  ctx.fillStyle = PAPER;
  fit(ctx, 'DAS', t.x + t.w / 2, t.y + 520, t.w - 80, 44);
  fit(ctx, 'DIREKTORAT', t.x + t.w / 2, t.y + 580, t.w - 70, 44);
  fit(ctx, 'WACHT', t.x + t.w / 2, t.y + 640, t.w - 80, 44);
  // the swallowtail cut at the bottom
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(t.x, t.y + t.h);
  ctx.lineTo(t.x + t.w / 2, t.y + t.h - 110);
  ctx.lineTo(t.x + t.w, t.y + t.h);
  ctx.fill();
  ctx.restore();
  weather(ctx, t, r, 0.6);
}

function paintZone(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = '#e4e0d4';
  ctx.fillRect(t.x, t.y, t.w, t.h);
  for (let i = -2; i < t.w / 24 + 2; i++) {
    ctx.fillStyle = i % 2 ? INK : OCHRE;
    ctx.beginPath();
    ctx.moveTo(t.x + i * 24, t.y);
    ctx.lineTo(t.x + i * 24 + 24, t.y);
    ctx.lineTo(t.x + i * 24 + 4, t.y + 26);
    ctx.lineTo(t.x + i * 24 - 20, t.y + 26);
    ctx.fill();
  }
  ctx.fillStyle = INK;
  fit(ctx, 'GRENZZONE', t.x + t.w / 2, t.y + 74, t.w - 50, 62);
  ctx.fillStyle = RED;
  fit(ctx, 'BETRETEN VERBOTEN', t.x + t.w / 2, t.y + 128, t.w - 90, 34);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.strokeRect(t.x + 3, t.y + 3, t.w - 6, t.h - 6);
  weather(ctx, t, r, 0.7);
}

function paintNotice(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = '#ddd5c0';
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.fillStyle = INK;
  fit(ctx, 'BEKANNTMACHUNG', t.x + t.w / 2, t.y + 34, t.w - 30, 30);
  ctx.fillRect(t.x + 20, t.y + 56, t.w - 40, 3);
  ctx.fillStyle = '#6d685d';
  for (let i = 0; i < 15; i++) ctx.fillRect(t.x + 22, t.y + 74 + i * 13, (t.w - 44) * (i % 4 === 3 ? 0.55 : 0.92 + r() * 0.08), 4);
  ctx.strokeStyle = OCHRE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(t.x + t.w - 62, t.y + t.h - 52, 32, 0, Math.PI * 2);
  ctx.stroke();
  tower(ctx, t.x + t.w - 62, t.y + t.h - 52, 28, OCHRE, '#ddd5c0');
  weather(ctx, t, r);
  tear(ctx, t, r);
}

function paintShop(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = '#2b2f2d';
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.strokeStyle = '#8c8a80';
  ctx.lineWidth = 4;
  ctx.strokeRect(t.x + 8, t.y + 8, t.w - 16, t.h - 16);
  ctx.fillStyle = '#cfc8b4';
  fit(ctx, 'LEBENSMITTEL', t.x + t.w / 2, t.y + t.h / 2 + 2, t.w - 60, 72);
  // missing letters, rust runs
  ctx.fillStyle = '#2b2f2d';
  ctx.fillRect(t.x + t.w * 0.62, t.y + 26, 26, 76);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(120,62,30,${0.2 + r() * 0.3})`;
    ctx.fillRect(t.x + r() * t.w, t.y + t.h * 0.5, 3, t.h * 0.5);
  }
  weather(ctx, t, r, 0.5);
}

function paintStreet(ctx: CanvasRenderingContext2D, t: Tile, r: () => number): void {
  ctx.fillStyle = SLATE;
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 4;
  ctx.strokeRect(t.x + 7, t.y + 7, t.w - 14, t.h - 14);
  ctx.fillStyle = PAPER;
  fit(ctx, 'KANALSTRASSE', t.x + t.w / 2 + 20, t.y + 52, t.w - 110, 46);
  ctx.fillStyle = OCHRE;
  ctx.fillRect(t.x + 18, t.y + 20, 50, 72);
  ctx.fillStyle = SLATE;
  fit(ctx, '4', t.x + 43, t.y + 57, 40, 54);
  ctx.fillStyle = PAPER;
  fit(ctx, 'SEKTOR VIER', t.x + t.w / 2 + 20, t.y + 88, t.w - 150, 16);
  weather(ctx, t, r, 0.4);
}

/** Paint the atlas: Directorate dressing and the resistance's answer to it. */
function paintAtlas(ctx: CanvasRenderingContext2D): void {
  const r = rand(1945 + 79);
  ctx.clearRect(0, 0, 1024, 1024);
  paintOrderPoster(ctx, TILES.posterOrder, r);
  paintPapersPoster(ctx, TILES.posterPapers, r);
  // the same poster, answered: a red star over the tower and a slogan across it
  paintOrderPoster(ctx, TILES.posterDefaced, r);
  const d = TILES.posterDefaced;
  star(ctx, d.x + d.w / 2, d.y + 122, 70, 'rgba(184,38,28,0.92)');
  ctx.save();
  ctx.translate(d.x + d.w / 2, d.y + 262);
  ctx.rotate(-0.22);
  spray(ctx, 'ВОСТРАВА', 0, 0, d.w - 20, 54, 'rgba(184,38,28,0.95)', r);
  spray(ctx, 'ЖИВЁТ', 10, 52, d.w - 80, 44, 'rgba(184,38,28,0.95)', r);
  ctx.restore();
  tear(ctx, d, r);
  paintBanner(ctx, TILES.banner, r);
  paintZone(ctx, TILES.zone, r);
  paintNotice(ctx, TILES.notice, r);
  paintShop(ctx, TILES.shop, r);
  paintStreet(ctx, TILES.street, r);
  const h = TILES.sprayHome;
  star(ctx, h.x + 50, h.y + h.h / 2, 38, 'rgba(184,38,28,0.9)');
  spray(ctx, 'ДОМОЙ', h.x + 210, h.y + h.h / 2, 240, 72, 'rgba(184,38,28,0.9)', r);
  const l = TILES.sprayLives;
  spray(ctx, 'ВОСТРАВА ЖИВЁТ!', l.x + l.w / 2, l.y + 62, l.w - 40, 96, 'rgba(20,20,20,0.85)', r);
}

let atlasMat: THREE.MeshStandardMaterial | null = null;

/** One alpha-tested material for every sign (merges into one draw). */
export function signMaterial(): THREE.MeshStandardMaterial {
  if (atlasMat) return atlasMat;
  const tex = canvasTexture(1024, 1024, paintAtlas);
  // a little self-light: paper and paint catch what stray light there is, so they read at night
  atlasMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.82, alphaTest: 0.5, side: THREE.FrontSide });
  return atlasMat;
}

/** World size (width, height) of each sign. */
const SIZE: Record<SignKind, [number, number]> = {
  posterOrder: [32, 45],
  posterPapers: [32, 45],
  posterDefaced: [32, 45],
  banner: [36, 144],
  zone: [62, 19],
  notice: [28, 35],
  shop: [76, 19],
  street: [34, 10],
  sprayHome: [58, 14.5],
  sprayLives: [92, 17],
};

/**
 * A sign on a wall. (x, y, z) is the centre of the sign, `ny` the wall normal's yaw: 0 faces +z,
 * π/2 faces +x. `scale` shrinks a sign to fit (banners on low buildings).
 */
export function sign(parent: THREE.Object3D, kind: SignKind, x: number, y: number, z: number, yaw: number, scale = 1, tilt = 0): void {
  const t = TILES[kind];
  const [w, h] = SIZE[kind];
  const g = new THREE.PlaneGeometry(w * scale, h * scale);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (t.x + u * t.w) / 1024, 1 - (t.y + (1 - v) * t.h) / 1024);
  }
  const mesh = new THREE.Mesh(g, signMaterial());
  mesh.position.set(x, y, z);
  mesh.rotation.set(0, yaw, tilt);
  mesh.receiveShadow = true;
  parent.add(mesh);
}

const POSTERS: SignKind[] = ['posterOrder', 'posterPapers', 'posterDefaced', 'notice', 'posterOrder', 'posterPapers'];

/**
 * Dress one in-play building whose body spans w × d around (x, z) with height h. Only the two faces
 * the camera sees get anything.
 */
export function dressBuilding(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number, seed: number): void {
  const r = rand(seed * 13 + 5);
  const faces: { len: number; at: (along: number, off: number) => [number, number]; yaw: number }[] = [
    { len: w, at: (a, o) => [x + a, z + d / 2 + o], yaw: 0 },
    { len: d, at: (a, o) => [x + w / 2 + o, z - a], yaw: Math.PI / 2 },
  ];
  for (const f of faces) {
    if (f.len < 40) continue;
    const half = f.len / 2 - 14;
    // posters and notices at street level, pasted in little clusters
    if (r() < 0.75) {
      const n = 1 + Math.floor(r() * Math.min(3, f.len / 48));
      let a = -half + 14 + r() * Math.max(0, f.len - 70 - n * 36);
      for (let i = 0; i < n && a < half - 10; i++) {
        const kind = POSTERS[Math.floor(r() * POSTERS.length)]!;
        const [px, pz] = f.at(a, 0.45 + i * 0.02);
        sign(parent, kind, px, 28 + r() * 4, pz, f.yaw, 1, (r() - 0.5) * 0.05);
        a += 35 + r() * 6;
      }
    }
    // a banner hanging from the roofline of taller blocks
    if (h >= 96 && f.len >= 60 && r() < 0.4) {
      const s = Math.min(1, (h - 20) / 150);
      const [px, pz] = f.at((r() - 0.5) * (f.len - 50), 0.7);
      sign(parent, 'banner', px, h - 8 - (144 * s) / 2, pz, f.yaw, s);
    }
    // the resistance's reply, sprayed low on the wall
    if (r() < 0.3) {
      const kind: SignKind = r() < 0.5 ? 'sprayHome' : 'sprayLives';
      const [ww] = SIZE[kind];
      if (f.len > ww + 20) {
        const [px, pz] = f.at((r() - 0.5) * (f.len - ww - 20), 0.5);
        sign(parent, kind, px, 13 + r() * 5, pz, f.yaw, 1, (r() - 0.5) * 0.06);
      }
    }
    // shop sign over a ground floor, or a street-name plate near the corner
    if (r() < 0.25 && f.len > 80) {
      const [px, pz] = f.at((r() - 0.5) * (f.len - 80), 0.5);
      sign(parent, 'shop', px, 54, pz, f.yaw);
    } else if (r() < 0.35) {
      const [px, pz] = f.at(half - 4, 0.5);
      sign(parent, 'street', px, 58, pz, f.yaw);
    }
  }
}

/** A guard booth gets the border-zone sign on a visible face. */
export function dressBooth(parent: THREE.Object3D, x: number, z: number, w: number, d: number, seed: number): void {
  const r = rand(seed * 7 + 3);
  if (r() > 0.7) return;
  const front = r() < 0.5;
  if (front && w >= 30) sign(parent, 'zone', x, 22, z + d / 2 + 0.45, 0, Math.min(1, (w - 4) / 62));
  else if (d >= 30) sign(parent, 'zone', x + w / 2 + 0.45, 22, z, Math.PI / 2, Math.min(1, (d - 4) / 62));
}
