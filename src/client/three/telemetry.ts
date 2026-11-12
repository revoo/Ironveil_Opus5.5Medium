// Debug performance telemetry for the 3D mission view (toggle: Telemetry binding, V by default).
//
// Timings are always recorded (a handful of numbers per frame); the GPU timer queries and the DOM
// only run while the panel is shown. Text refreshes 4x a second, the frame-time graph every frame.
import * as THREE from 'three';

const HISTORY = 240; // frames kept for the graph and the percentile
const FLUSH_MS = 250;
const HITCH_MS = 50; // a frame this long is a visible stutter
const GRAPH_W = 240;
const GRAPH_H = 44;
const GRAPH_MAX_MS = 50;

/** Shown state survives mission restarts within a page session. */
let shown = false;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface FrameCost {
  /** Simulation ticks run this frame and the time they took. */
  ticks: number;
  simMs: number;
  /** CPU time spent issuing the render passes (not GPU execution time). */
  renderMs: number;
  /** HUD and audio direction. */
  hudMs: number;
  /** Whole frame callback. */
  cpuMs: number;
}

export class Telemetry {
  readonly el: HTMLDivElement;
  private text: HTMLPreElement;
  private graph: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private frameMs = new Float32Array(HISTORY);
  private head = 0;
  private filled = 0;
  private prevNow = -1;
  /** Dynamic resolution scale, set by the view each frame. */
  resScale = 1;
  /** The playtest performance log is writing to the preview's database. */
  recording = false;
  private hitches = 0;
  private worstMs = 0;
  // window accumulators (reset on every flush)
  private win = { frames: 0, start: 0, cpu: 0, sim: 0, render: 0, hud: 0, ticks: 0, maxFrame: 0, gpu: 0, gpuN: 0 };
  private gl: WebGL2RenderingContext | null;
  private timer: TimerExt | null = null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private lastGpuMs = -1;
  private size = new THREE.Vector2();

  constructor(
    host: HTMLElement,
    private renderer: THREE.WebGLRenderer,
  ) {
    const gl = renderer.getContext();
    this.gl = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl : null;
    this.timer = (this.gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) ?? null;
    // A frame is several passes (shadows, scene, post): count them all, reset once per frame.
    renderer.info.autoReset = false;

    this.el = document.createElement('div');
    this.el.className = 'h3-telem';
    this.el.innerHTML = `<div class="hd"><span>Telemetry</span><kbd>V</kbd></div><canvas></canvas><pre></pre>`;
    this.text = this.el.querySelector('pre')!;
    this.graph = this.el.querySelector('canvas')!;
    this.graph.width = GRAPH_W * 2;
    this.graph.height = GRAPH_H * 2;
    this.graph.style.width = `${GRAPH_W}px`;
    this.graph.style.height = `${GRAPH_H}px`;
    this.g = this.graph.getContext('2d');
    host.appendChild(this.el);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.apply();
  }

  get visible(): boolean {
    return shown;
  }

  toggle(): void {
    shown = !shown;
    this.apply();
  }

  /** Keyboard hint shown in the header (the binding may have been remapped). */
  setKeyLabel(label: string): void {
    this.el.querySelector('kbd')!.textContent = label;
  }

  private apply(): void {
    this.el.classList.toggle('show', shown);
    this.el.parentElement?.classList.toggle('telem', shown);
    if (shown) {
      this.resetWindow(performance.now());
      if (!this.text.textContent) this.text.textContent = 'measuring…';
    } else this.dropQueries();
  }

  /** Call at the top of the frame with the rAF timestamp. */
  frameStart(now: number): void {
    this.renderer.info.reset();
    if (this.prevNow >= 0) {
      const ms = now - this.prevNow;
      this.frameMs[this.head] = ms;
      this.head = (this.head + 1) % HISTORY;
      this.filled = Math.min(HISTORY, this.filled + 1);
      if (ms > HITCH_MS) this.hitches++;
      if (ms > this.worstMs) this.worstMs = ms;
      if (ms > this.win.maxFrame) this.win.maxFrame = ms;
      this.win.frames++;
    }
    this.prevNow = now;
  }

  /** rAF stops while the tab is hidden; the gap on return is not a stutter. */
  private onVisibility = (): void => {
    this.prevNow = -1;
  };

  /** Wrap the GPU work of the frame (shadow maps, scene, post chain). */
  gpuBegin(): void {
    if (!shown || !this.gl || !this.timer || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  gpuEnd(): void {
    if (!this.gl || !this.timer || !this.active) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  frameEnd(now: number, cost: FrameCost): void {
    const w = this.win;
    w.cpu += cost.cpuMs;
    w.sim += cost.simMs;
    w.render += cost.renderMs;
    w.hud += cost.hudMs;
    w.ticks += cost.ticks;
    if (!shown) {
      if (now - w.start > 2000) this.resetWindow(now);
      return;
    }
    this.pollQueries();
    this.drawGraph();
    if (now - w.start >= FLUSH_MS) {
      this.flush(now);
      this.resetWindow(now);
    }
  }

  private pollQueries(): void {
    const gl = this.gl, t = this.timer;
    if (!gl || !t) return;
    const disjoint = gl.getParameter(t.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      this.pending.shift();
      if (disjoint) continue; // GPU clock changed mid-query: result is meaningless
      this.win.gpu += ns / 1e6;
      this.win.gpuN++;
    }
  }

  private dropQueries(): void {
    if (!this.gl) return;
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending = [];
  }

  private resetWindow(now: number): void {
    const w = this.win;
    w.frames = w.cpu = w.sim = w.render = w.hud = w.ticks = w.maxFrame = w.gpu = w.gpuN = 0;
    w.start = now;
  }

  /** 99th-percentile frame time over the history (the "1% low" frame rate's frame time). */
  private p99(): number {
    if (!this.filled) return 0;
    const a = Array.from(this.frameMs.subarray(0, this.filled)).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * 0.99))]!;
  }

  private flush(now: number): void {
    const w = this.win;
    const span = Math.max(1, now - w.start);
    const n = Math.max(1, w.frames);
    const fps = (w.frames * 1000) / span;
    const avg = w.frames ? span / w.frames : 0;
    const p99 = this.p99();
    if (w.gpuN) this.lastGpuMs = w.gpu / w.gpuN;
    const info = this.renderer.info;
    const size = this.renderer.getDrawingBufferSize(this.size);
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const gpu = !this.timer ? 'n/a (browser)' : this.lastGpuMs < 0 ? '…' : `${f1(this.lastGpuMs)} ms`;
    const rows = [
      `FPS      ${pad(fps.toFixed(fps < 10 ? 1 : 0), 5)}  1% low ${p99 ? (1000 / p99).toFixed(1000 / p99 < 10 ? 1 : 0) : "–"}`,
      `Frame    ${pad(f1(avg), 5)} ms  max ${f1(w.maxFrame)}`,
      `CPU      ${pad(f1(w.cpu / n), 5)} ms`,
      `  sim    ${pad(f1(w.sim / n), 5)} ms  ${((w.ticks * 1000) / span).toFixed(0)} ticks/s`,
      `  render ${pad(f1(w.render / n), 5)} ms  (submit)`,
      `  hud    ${pad(f1(w.hud / n), 5)} ms`,
      `GPU      ${gpu}`,
      `Draws    ${pad(String(info.render.calls), 5)}  tris ${kfmt(info.render.triangles)}`,
      `Shaders  ${pad(String(info.programs?.length ?? 0), 5)}  geo ${info.memory.geometries}  tex ${info.memory.textures}`,
      `Res      ${size.x}×${size.y}  @${this.renderer.getPixelRatio().toFixed(2)}x  dyn ${Math.round(this.resScale * 100)}%`,
      ...(this.recording ? ['● REC    perf log → preview database'] : []),
      `Hitches  ${pad(String(this.hitches), 5)}  worst ${f1(this.worstMs)} ms`,
    ];
    if (heap !== undefined) rows.push(`Heap     ${(heap / 1048576).toFixed(0)} MB`);
    this.text.textContent = rows.join('\n');
    this.el.dataset.s = p99 > 33.4 ? 'bad' : p99 > 17.5 ? 'warn' : 'ok';
    // Lets the decision card (same corner) sit above the panel.
    this.el.parentElement?.style.setProperty('--telem-h', `${this.el.offsetHeight}px`);
  }

  private drawGraph(): void {
    const g = this.g;
    if (!g) return;
    const W = this.graph.width, H = this.graph.height;
    g.clearRect(0, 0, W, H);
    const y = (ms: number) => H - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * H;
    // budget lines: 60 fps and 30 fps
    g.fillStyle = 'rgba(237,244,223,.18)';
    g.fillRect(0, Math.round(y(1000 / 60)), W, 1);
    g.fillStyle = 'rgba(255,145,119,.28)';
    g.fillRect(0, Math.round(y(1000 / 30)), W, 1);
    const bw = W / HISTORY;
    for (let i = 0; i < this.filled; i++) {
      const ms = this.frameMs[(this.head - this.filled + i + HISTORY) % HISTORY]!;
      g.fillStyle = ms > HITCH_MS ? '#ff5a3a' : ms > 1000 / 30 + 0.5 ? '#f1d09c' : 'rgba(165,216,160,.85)';
      const top = y(ms);
      g.fillRect(W - (this.filled - i) * bw, top, Math.max(1, bw - 0.5), H - top);
    }
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.dropQueries();
    this.renderer.info.autoReset = true;
    this.el.parentElement?.classList.remove('telem');
    this.el.remove();
  }
}

function f1(x: number): string {
  return x.toFixed(1);
}
function pad(s: string, n: number): string {
  return s.padStart(n);
}
function kfmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);
}
