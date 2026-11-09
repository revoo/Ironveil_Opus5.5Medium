// Playtest performance log: when the game runs as the owner's claude.ai preview artifact, it records
// compact performance samples into that artifact's private database, so they can be read back after
// a session instead of copied from the `V` overlay by hand.
//
// It only runs where the artifact's `db` capability is available *and* the viewer can edit the
// artifact (the owner): anywhere else (local dev, a shared view) it does nothing. It records numbers
// about frames and the machine, nothing about the person.
//
// Layout: perf/<sid> holds the machine, settings and a running summary; perf/<sid>/chunks/<n> holds
// 2-second samples (columns in `SAMPLE_KEYS`) and stutters, written every 30 s.

const SAMPLE_S = 2;
const FLUSH_S = 30;
const STUTTER_MS = 100;

export const SAMPLE_KEYS = ['t', 'fps', 'avgMs', 'p95Ms', 'maxMs', 'slow', 'cpuMs', 'draws', 'ktris', 'bufW', 'bufH', 'dyn', 'combat', 'foes'] as const;

export interface FrameInfo {
  frameMs: number;
  cpuMs: number;
  draws: number;
  tris: number;
  bufW: number;
  bufH: number;
  dyn: number;
  combat: boolean;
  foes: number;
}

interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
}
interface Db {
  doc(path: string): DocRef;
}
interface ClaudeUse {
  use(name: string): Promise<unknown>;
}

function round(x: number, d = 1): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

function gpuName(gl: WebGL2RenderingContext | null): string {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return '';
  }
}

export class PerfLog {
  private db: Db | null = null;
  private sid = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
  private t = 0;
  private win: number[] = [];
  private acc = { cpu: 0, draws: 0, tris: 0 };
  private samples: number[][] = [];
  private stutters: { t: number; ms: number; combat: boolean }[] = [];
  private sinceFlush = 0;
  private chunk = 0;
  private writing = false;
  private total = { frames: 0, time: 0, slow: 0, worst: 0 };
  private last: FrameInfo | null = null;
  /** True once recording is confirmed (shown in the overlay). */
  recording = false;

  constructor(
    private meta: { mission: string; low: boolean },
    gl: WebGL2RenderingContext | null,
  ) {
    const gpu = gpuName(gl);
    void this.connect(gpu);
  }

  private async connect(gpu: string): Promise<void> {
    const claude = (window as unknown as { claude?: ClaudeUse }).claude;
    if (!claude?.use) return;
    try {
      const [db, user] = (await Promise.all([claude.use('db'), claude.use('user')])) as [Db | null, { canEdit(): Promise<boolean> } | null];
      if (!db || !user || !(await user.canEdit())) return;
      await db.doc(`perf/${this.sid}`).set({
        startedAt: new Date().toISOString(),
        build: import.meta.url.split('/').pop() ?? '',
        mission: this.meta.mission,
        lowEffects: this.meta.low,
        gpu,
        ua: navigator.userAgent,
        screen: [screen.width, screen.height],
        window: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        cores: navigator.hardwareConcurrency ?? 0,
        sampleKeys: [...SAMPLE_KEYS],
        sampleSeconds: SAMPLE_S,
        chunks: 0,
      });
      this.db = db;
      this.recording = true;
    } catch {
      this.db = null;
    }
  }

  setLow(low: boolean): void {
    this.meta.low = low;
  }

  frame(f: FrameInfo): void {
    if (f.frameMs <= 0 || f.frameMs > 2000) return; // first frame, or the tab was hidden
    this.last = f;
    const s = f.frameMs / 1000;
    this.t += s;
    this.win.push(f.frameMs);
    this.acc.cpu += f.cpuMs;
    this.acc.draws += f.draws;
    this.acc.tris += f.tris;
    this.total.frames++;
    this.total.time += s;
    if (f.frameMs > 1000 / 50) this.total.slow++;
    this.total.worst = Math.max(this.total.worst, f.frameMs);
    if (f.frameMs > STUTTER_MS && this.stutters.length < 200) this.stutters.push({ t: round(this.t), ms: Math.round(f.frameMs), combat: f.combat });
    const span = this.win.reduce((a, b) => a + b, 0);
    if (span >= SAMPLE_S * 1000) this.sample(span);
    this.sinceFlush += s;
    if (this.sinceFlush >= FLUSH_S) void this.flush();
  }

  private sample(span: number): void {
    const n = this.win.length;
    const sorted = [...this.win].sort((a, b) => a - b);
    const f = this.last!;
    this.samples.push([
      round(this.t),
      round((n * 1000) / span),
      round(span / n),
      round(sorted[Math.min(n - 1, Math.floor(n * 0.95))]!),
      round(sorted[n - 1]!),
      this.win.filter((ms) => ms > 1000 / 50).length,
      round(this.acc.cpu / n, 2),
      Math.round(this.acc.draws / n),
      Math.round(this.acc.tris / n / 1000),
      f.bufW,
      f.bufH,
      round(f.dyn, 2),
      f.combat ? 1 : 0,
      f.foes,
    ]);
    this.win = [];
    this.acc = { cpu: 0, draws: 0, tris: 0 };
  }

  /** Write what has been collected (also call when the mission ends). */
  async flush(): Promise<void> {
    this.sinceFlush = 0;
    if (!this.db || this.writing || (!this.samples.length && !this.stutters.length)) return;
    this.writing = true;
    const samples = this.samples, stutters = this.stutters;
    this.samples = [];
    this.stutters = [];
    const n = this.chunk++;
    try {
      await this.db.doc(`perf/${this.sid}/chunks/${String(n).padStart(3, '0')}`).set({ samples, stutters });
      const T = this.total;
      await this.db.doc(`perf/${this.sid}`).update({
        chunks: this.chunk,
        updatedAt: new Date().toISOString(),
        lowEffects: this.meta.low,
        summary: { seconds: Math.round(T.time), avgFps: round(T.frames / Math.max(1e-3, T.time)), under50Pct: round((100 * T.slow) / Math.max(1, T.frames)), worstMs: Math.round(T.worst) },
      });
    } catch {
      // a refused or rate-limited write loses one chunk, never the game
    } finally {
      this.writing = false;
    }
  }
}
