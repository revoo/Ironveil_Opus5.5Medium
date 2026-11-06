// Shared bits for the two rendering proofs of concept (poc/2d.html, poc/3d.html):
// one small "Relay Yard"-style lot, a drivable tank, shells, smoke, input and a HUD.
// Deliberately tiny and independent of the real game so both renderers draw exactly the same scene.

export const YARD = { w: 1600, h: 900 };

export interface Rect { x: number; y: number; w: number; h: number; height: number; kind: 'wall' | 'building' | 'crate' }

export const RECTS: Rect[] = [
  // Berlin-style concrete wall run with a gap
  { x: 180, y: 290, w: 420, h: 26, height: 70, kind: 'wall' },
  { x: 700, y: 290, w: 360, h: 26, height: 70, kind: 'wall' },
  { x: 1150, y: 420, w: 26, h: 480, height: 70, kind: 'wall' },
  // buildings
  { x: 1260, y: 70, w: 270, h: 190, height: 150, kind: 'building' },
  { x: 90, y: 590, w: 230, h: 190, height: 130, kind: 'building' },
  // crates / barriers
  { x: 620, y: 560, w: 64, h: 64, height: 34, kind: 'crate' },
  { x: 790, y: 640, w: 40, h: 96, height: 34, kind: 'crate' },
  { x: 900, y: 470, w: 96, h: 40, height: 34, kind: 'crate' },
  { x: 980, y: 730, w: 72, h: 72, height: 34, kind: 'crate' },
  { x: 430, y: 120, w: 70, h: 44, height: 34, kind: 'crate' },
];

export const LAMPS: { x: number; y: number }[] = [
  { x: 400, y: 250 },
  { x: 880, y: 250 },
  { x: 520, y: 470 },
  { x: 1080, y: 600 },
  { x: 1320, y: 380 },
  { x: 380, y: 840 },
];

export const LAMP_HEIGHT = 120;

export interface Tank { x: number; y: number; vx: number; vy: number; hull: number; turret: number; team: 0 | 1; r: number; recoil: number }

export interface Shell { x: number; y: number; vx: number; vy: number; life: number }
export interface Flash { x: number; y: number; t: number; dur: number; big: boolean }
export interface Smoke { x: number; y: number; t: number; seed: number }

export const SMOKE_LIFE = 8;

export function smokeRadius(s: Smoke): number {
  return 40 + 80 * Math.min(1, s.t / 1.2);
}
export function smokeAlpha(s: Smoke): number {
  return Math.min(1, s.t / 0.4) * Math.min(1, (SMOKE_LIFE - s.t) / 2);
}

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  fire = false;
  constructor(target: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    target.addEventListener('mousemove', (e) => {
      const r = target.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fire = true;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  /** True once per key press. */
  take(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }
  endFrame(): void {
    this.pressed.clear();
    this.fire = false;
  }
}

function circleRect(t: { x: number; y: number }, r: number, b: Rect): void {
  const cx = Math.max(b.x, Math.min(t.x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(t.y, b.y + b.h));
  const dx = t.x - cx;
  const dy = t.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    t.x = cx + (dx / d) * r;
    t.y = cy + (dy / d) * r;
  } else {
    // centre inside: push out along the shallowest axis
    const l = t.x - b.x, ri = b.x + b.w - t.x, u = t.y - b.y, dn = b.y + b.h - t.y;
    const m = Math.min(l, ri, u, dn);
    if (m === l) t.x = b.x - r;
    else if (m === ri) t.x = b.x + b.w + r;
    else if (m === u) t.y = b.y - r;
    else t.y = b.y + b.h + r;
  }
}

function inRect(x: number, y: number, b: Rect): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The tiny gameplay layer both demos share. Rendering-agnostic. */
export class Sandbox {
  player: Tank = { x: 300, y: 450, vx: 0, vy: 0, hull: 0, turret: 0, team: 0, r: 22, recoil: 0 };
  enemy: Tank = { x: 1340, y: 700, vx: 0, vy: 0, hull: Math.PI * 0.8, turret: Math.PI * 0.95, team: 1, r: 22, recoil: 0 };
  shells: Shell[] = [];
  flashes: Flash[] = [];
  smokes: Smoke[] = [];
  time = 0;
  private cooldown = 0;
  private smokeCd = 0;

  get tanks(): Tank[] {
    return [this.player, this.enemy];
  }

  update(dt: number, input: Input, aimX: number, aimY: number): void {
    this.time += dt;
    const p = this.player;
    let ix = 0, iy = 0;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) iy -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) iy += 1;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) ix -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) ix += 1;
    const il = Math.hypot(ix, iy) || 1;
    p.vx += (ix / il) * 900 * dt;
    p.vy += (iy / il) * 900 * dt;
    const drag = Math.exp(-dt * (ix || iy ? 2.2 : 3.5));
    p.vx *= drag;
    p.vy *= drag;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 260) {
      p.vx *= 260 / sp;
      p.vy *= 260 / sp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (sp > 20) p.hull += wrap(Math.atan2(p.vy, p.vx) - p.hull) * Math.min(1, dt * 6);
    for (const b of RECTS) circleRect(p, p.r, b);
    for (const o of [this.enemy]) {
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), m = p.r + o.r;
      if (d < m && d > 0) {
        p.x = o.x + (dx / d) * m;
        p.y = o.y + (dy / d) * m;
      }
    }
    p.x = Math.max(p.r, Math.min(YARD.w - p.r, p.x));
    p.y = Math.max(p.r, Math.min(YARD.h - p.r, p.y));
    p.turret += wrap(Math.atan2(aimY - p.y, aimX - p.x) - p.turret) * Math.min(1, dt * 10);
    p.recoil = Math.max(0, p.recoil - dt * 4);
    // enemy turret idles around
    this.enemy.turret = Math.PI * 0.95 + Math.sin(this.time * 0.5) * 0.6;

    this.cooldown -= dt;
    this.smokeCd -= dt;
    if (input.fire && this.cooldown <= 0) {
      this.cooldown = 0.5;
      const c = Math.cos(p.turret), s = Math.sin(p.turret);
      const mx = p.x + c * 40, my = p.y + s * 40;
      this.shells.push({ x: mx, y: my, vx: c * 1100, vy: s * 1100, life: 1.2 });
      this.flashes.push({ x: mx, y: my, t: 0, dur: 0.12, big: false });
      p.recoil = 1;
    }
    if (input.take('KeyQ') && this.smokeCd <= 0) {
      this.smokeCd = 1.5;
      this.smokes.push({ x: p.x, y: p.y, t: 0, seed: Math.random() * 100 });
    }

    for (const sh of this.shells) {
      const steps = 4;
      for (let i = 0; i < steps && sh.life > 0; i++) {
        sh.x += (sh.vx * dt) / steps;
        sh.y += (sh.vy * dt) / steps;
        const hitTank = Math.hypot(sh.x - this.enemy.x, sh.y - this.enemy.y) < this.enemy.r;
        if (hitTank || RECTS.some((b) => inRect(sh.x, sh.y, b)) || sh.x < 0 || sh.y < 0 || sh.x > YARD.w || sh.y > YARD.h) {
          sh.life = 0;
          this.flashes.push({ x: sh.x - sh.vx * 0.006, y: sh.y - sh.vy * 0.006, t: 0, dur: 0.35, big: true });
        }
      }
      sh.life -= dt;
    }
    this.shells = this.shells.filter((s) => s.life > 0);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
    for (const s of this.smokes) s.t += dt;
    this.smokes = this.smokes.filter((s) => s.t < SMOKE_LIFE);
  }
}

export interface Toggle { key: string; label: string; on: boolean; help: string }

/** Minimal overlay: FPS, frame time, GPU, technique toggles and render scale. */
export class Hud {
  private el: HTMLDivElement;
  private frames: number[] = [];
  private last = 0;
  /** Internal resolution multiplier; start value from ?scale=0.5 in the URL. */
  renderScale = Math.min(2, Math.max(0.25, Number(new URLSearchParams(location.search).get('scale')) || 1));
  extra = '';

  constructor(private title: string, readonly toggles: Toggle[], private gpu: string, private hint: string) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    document.body.appendChild(this.el);
    if (history.length > 1) {
      const back = document.createElement('button');
      back.className = 'back';
      back.textContent = '← All demos';
      back.onclick = () => history.back();
      document.body.appendChild(back);
    }
  }

  get(key: string): boolean {
    return this.toggles.find((t) => t.key === key)!.on;
  }

  handle(input: Input): boolean {
    let changed = false;
    for (const t of this.toggles) {
      if (input.take(`Digit${t.key}`)) {
        t.on = !t.on;
        changed = true;
      }
    }
    if (input.take('BracketLeft')) {
      this.renderScale = Math.max(0.25, +(this.renderScale - 0.125).toFixed(3));
      changed = true;
    }
    if (input.take('BracketRight')) {
      this.renderScale = Math.min(2, +(this.renderScale + 0.125).toFixed(3));
      changed = true;
    }
    return changed;
  }

  frame(now: number): void {
    if (this.last) this.frames.push(now - this.last);
    this.last = now;
    if (this.frames.length > 60) this.frames.shift();
    if (this.frames.length % 10 !== 0) return;
    const avg = this.frames.reduce((a, b) => a + b, 0) / Math.max(1, this.frames.length);
    const worst = Math.max(...this.frames, 0);
    const rows = this.toggles
      .map((t) => `<div class="row ${t.on ? 'on' : 'off'}" title="${t.help}"><b>${t.key}</b> ${t.label}<span>${t.on ? 'ON' : 'off'}</span></div>`)
      .join('');
    this.el.innerHTML = `<h1>${this.title}</h1>
      <div class="perf"><b>${(1000 / avg).toFixed(0)}</b> fps · ${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} ms worst</div>
      <div class="gpu">${this.gpu}</div>
      ${rows}
      <div class="row"><b>[ ]</b> render scale<span>${Math.round(this.renderScale * 100)}%</span></div>
      ${this.extra ? `<div class="extra">${this.extra}</div>` : ''}
      <div class="hint">${this.hint}</div>`;
  }
}

export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name).replace(/ANGLE \((.*)\)/, '$1');
}

export const HUD_CSS = `
html,body{margin:0;height:100%;background:#070b09;overflow:hidden;font-family:Rajdhani,system-ui,sans-serif;color:#edf4df}
canvas{display:block}
.hud{position:fixed;top:10px;left:10px;width:270px;background:rgba(16,27,23,.82);border:1px solid #2c4236;padding:10px 12px;font-size:14px;line-height:1.35;user-select:none;pointer-events:none}
.hud h1{font-size:15px;margin:0 0 4px;letter-spacing:.08em;text-transform:uppercase;color:#f1d09c}
.hud .perf b{font-size:20px;color:#a5d8a0}
.hud .gpu{color:#a4b6a4;font-size:12px;margin-bottom:6px;word-break:break-word}
.hud .row{display:flex;gap:6px}.hud .row b{width:28px;color:#f1d09c}.hud .row span{margin-left:auto}
.hud .row.off{color:#7f8f80}.hud .extra{margin-top:6px;color:#87c9e8}
.hud .hint{margin-top:8px;color:#a4b6a4;font-size:12px}
.back{position:fixed;left:10px;bottom:10px;font:600 14px Rajdhani,system-ui,sans-serif;color:#edf4df;background:rgba(16,27,23,.82);border:1px solid #2c4236;padding:6px 12px;cursor:pointer}
.back:hover,.back:focus-visible{border-color:#87c9e8;outline:none}
`;

export const CONTROLS_HINT = 'WASD drive · mouse aim · click fire · Q smoke';
