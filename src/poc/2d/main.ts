// 2D rendering proof of concept: raw WebGL2, four passes.
//   1. SDF bake      scene distance field + heights -> half-res RGBA16F texture
//   2. Lighting      materials, height-derived normals, soft SDF shadows, fake volumetrics, smoke -> HDR
//   3. Bloom         bright-pass + separable Gaussian blur at 1/4 and 1/8 resolution
//   4. Composite     tone mapping (ACES), split-tone grade, vignette, grain -> screen
import { CONTROLS_HINT, HUD_CSS, Hud, Input, LAMPS, LAMP_HEIGHT, RECTS, Sandbox, YARD, gpuName, smokeAlpha, smokeRadius } from '../shared';
import { BLUR_FS, BRIGHT_FS, COMPOSITE_FS, FULLSCREEN_VS, LIGHT_FS, SDF_FS } from './shaders';

const style = document.createElement('style');
style.textContent = HUD_CSS + 'canvas{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}';
document.head.appendChild(style);

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' })!;
if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
  document.body.innerHTML = '<p style="color:#eee;padding:2em">This demo needs WebGL2 with float render targets.</p>';
  throw new Error('WebGL2 / EXT_color_buffer_float unavailable');
}

function compile(fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, FULLSCREEN_VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
function target(w: number, h: number, old?: Target): Target {
  if (old) {
    gl.deleteFramebuffer(old.fb);
    gl.deleteTexture(old.tex);
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fb, tex, w, h };
}

const P = { sdf: compile(SDF_FS), light: compile(LIGHT_FS), bright: compile(BRIGHT_FS), blur: compile(BLUR_FS), comp: compile(COMPOSITE_FS) };
const locCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
function loc(p: WebGLProgram, n: string): WebGLUniformLocation | null {
  let m = locCache.get(p);
  if (!m) locCache.set(p, (m = new Map()));
  if (!m.has(n)) m.set(n, gl.getUniformLocation(p, n));
  return m.get(n)!;
}

function draw(prog: WebGLProgram, out: Target | null, inputs: [string, WebGLTexture][], set: (u: (n: string) => WebGLUniformLocation | null) => void): void {
  gl.useProgram(prog);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
  gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
  inputs.forEach(([name, tex], i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc(prog, name), i);
  });
  set((n) => loc(prog, n));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const boxes = new Float32Array(16 * 4);
const boxInfo = new Float32Array(16 * 2);
RECTS.forEach((r, i) => {
  boxes.set([r.x, r.y, r.w, r.h], i * 4);
  boxInfo.set([r.height, r.kind === 'wall' ? 1 : r.kind === 'building' ? 2 : 3], i * 2);
});
const lampArr = new Float32Array(LAMPS.flatMap((l) => [l.x, l.y]));

function sceneUniforms(u: (n: string) => WebGLUniformLocation | null, sb: Sandbox): void {
  gl.uniform2f(u('uYard'), YARD.w, YARD.h);
  gl.uniform4fv(u('uBox'), boxes);
  gl.uniform2fv(u('uBoxInfo'), boxInfo);
  gl.uniform1i(u('uBoxCount'), RECTS.length);
  gl.uniform4fv(u('uTank'), sb.tanks.flatMap((t) => [t.x, t.y, t.hull, t.turret]));
  gl.uniform1fv(u('uRecoil'), sb.tanks.map((t) => t.recoil));
}

const input = new Input(canvas);
const sb = new Sandbox();
const hud = new Hud(
  'Ironveil · 2D (SDF lighting)',
  [
    { key: '1', label: 'normal maps (height → slope)', on: true, help: 'Per-pixel surface direction derived from a height function' },
    { key: '2', label: 'SDF soft shadows', on: true, help: 'Sphere-trace the distance field toward each light' },
    { key: '3', label: 'volumetric scatter (fake)', on: true, help: 'Haze glow reusing the ground shadow, so walls carve light shafts' },
    { key: '4', label: 'contact shadows / AO', on: true, help: 'Darken ground near taller objects using the SDF' },
    { key: '5', label: 'bloom', on: true, help: 'Bright-pass + blurred mip chain added back' },
    { key: '6', label: 'tone map + grade', on: true, help: 'ACES, split toning, vignette, grain' },
  ],
  gpuName(gl),
  `${CONTROLS_HINT} · V debug view`,
);
const VIEWS = ['final', 'albedo only', 'normals', 'distance field', 'lighting only'];
let view = 0;

let hdr: Target | undefined, sdf: Target | undefined, bA: Target | undefined, bA2: Target | undefined, bB: Target | undefined, bB2: Target | undefined;
let cssW = 0, cssH = 0, scale = -1;

function resize(): void {
  const aspect = YARD.w / YARD.h;
  let w = innerWidth, h = innerWidth / aspect;
  if (h > innerHeight) {
    h = innerHeight;
    w = h * aspect;
  }
  if (Math.round(w) === cssW && Math.round(h) === cssH && scale === hud.renderScale) return;
  cssW = Math.round(w);
  cssH = Math.round(h);
  scale = hud.renderScale;
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const rw = canvas.width * scale, rh = canvas.height * scale;
  hdr = target(rw, rh, hdr);
  sdf ??= target(YARD.w / 2, YARD.h / 2);
  bA = target(rw / 4, rh / 4, bA);
  bA2 = target(rw / 4, rh / 4, bA2);
  bB = target(rw / 8, rh / 8, bB);
  bB2 = target(rw / 8, rh / 8, bB2);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  hud.handle(input);
  if (input.take('KeyV')) view = (view + 1) % VIEWS.length;
  resize();
  sb.update(dt, input, (input.mouseX / cssW) * YARD.w, (input.mouseY / cssH) * YARD.h);
  input.endFrame();

  // Lights for this frame: streetlamps, headlights (cones), shells and flashes.
  const L: number[] = [], C: number[] = [];
  const add = (x: number, y: number, z: number, r: number, col: [number, number, number], k: number, cone = -9) => {
    if (L.length >= 64) return;
    L.push(x, y, z, r);
    C.push(col[0] * k, col[1] * k, col[2] * k, cone);
  };
  const flick = 0.95 + Math.sin(now / 900) * 0.03;
  for (const l of LAMPS) add(l.x, l.y, LAMP_HEIGHT, 380, [1.0, 0.6, 0.25], 2.2 * flick);
  for (const t of sb.tanks) add(t.x + Math.cos(t.hull) * 24, t.y + Math.sin(t.hull) * 24, 26, 340, [1.0, 0.93, 0.8], 2.0, t.hull);
  for (const s of sb.shells) add(s.x, s.y, 20, 140, [1.0, 0.55, 0.2], 1.6);
  for (const f of sb.flashes) {
    const k = 1 - f.t / f.dur;
    add(f.x, f.y, 24, f.big ? 320 : 230, [1.0, 0.65, 0.3], (f.big ? 7 : 5) * k * k);
  }
  const smokes = sb.smokes.slice(-4).flatMap((s) => [s.x, s.y, smokeRadius(s), smokeAlpha(s)]);
  const shells = sb.shells.slice(-8).flatMap((s) => [s.x, s.y, s.vx, s.vy]);

  draw(P.sdf, sdf!, [], (u) => sceneUniforms(u, sb));
  draw(P.light, hdr!, [['uSdf', sdf!.tex]], (u) => {
    sceneUniforms(u, sb);
    gl.uniform4fv(u('uLight'), new Float32Array(64).fill(0).map((_, i) => L[i] ?? 0));
    gl.uniform4fv(u('uLightCol'), new Float32Array(64).fill(0).map((_, i) => C[i] ?? 0));
    gl.uniform1i(u('uLightCount'), L.length / 4);
    gl.uniform4fv(u('uSmoke'), new Float32Array(16).map((_, i) => smokes[i] ?? 0));
    gl.uniform1i(u('uSmokeCount'), smokes.length / 4);
    gl.uniform4fv(u('uShell'), new Float32Array(32).map((_, i) => shells[i] ?? 0));
    gl.uniform1i(u('uShellCount'), shells.length / 4);
    gl.uniform2fv(u('uLamps'), new Float32Array(16).map((_, i) => lampArr[i] ?? 0));
    gl.uniform1i(u('uLampCount'), LAMPS.length);
    gl.uniform1f(u('uTime'), sb.time);
    gl.uniform1i(u('uView'), view);
    gl.uniform4i(u('uFx'), +hud.get('1'), +hud.get('2'), +hud.get('3'), +hud.get('4'));
  });
  const bloom = hud.get('5') && view === 0;
  if (bloom) {
    draw(P.bright, bA!, [['uTex', hdr!.tex]], (u) => gl.uniform2f(u('uTexel'), 1 / hdr!.w, 1 / hdr!.h));
    draw(P.blur, bA2!, [['uTex', bA!.tex]], (u) => gl.uniform2f(u('uDir'), 1 / bA!.w, 0));
    draw(P.blur, bA!, [['uTex', bA2!.tex]], (u) => gl.uniform2f(u('uDir'), 0, 1 / bA!.h));
    draw(P.blur, bB2!, [['uTex', bA!.tex]], (u) => gl.uniform2f(u('uDir'), 2 / bA!.w, 0));
    draw(P.blur, bB!, [['uTex', bB2!.tex]], (u) => gl.uniform2f(u('uDir'), 0, 1 / bB!.h));
  }
  draw(P.comp, null, [['uHdr', hdr!.tex], ['uBloomA', bA!.tex], ['uBloomB', bB!.tex]], (u) => {
    gl.uniform1i(u('uBloom'), +bloom);
    gl.uniform1i(u('uGrade'), +(hud.get('6') && view === 0));
    gl.uniform1f(u('uTime'), now / 1000);
  });

  hud.extra = `view: <b>${VIEWS[view]}</b> · ${hdr!.w}×${hdr!.h} · ${L.length / 4} lights`;
  hud.frame(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
