// Screen-space HUD (1920x1080 logical). Reads only the player's team Observation.
import Phaser from 'phaser';
import type { Observation, TankView } from '../sim/observation';
import type { GameMap } from '../sim/map';
import type { Vec } from '../sim/math';
import type { LocalSession } from '../game/session';
import type { Settings } from './settings';
import { codeLabel } from './settings';
import { TUNING } from '../sim/tuning';
import { WEAPON_TICKS } from '../sim/weapon';
import { TEAM, UI } from './palette';

export interface HudModel {
  obs: Observation | null;
  map: GameMap | null;
  session: LocalSession | null;
  view: { x: number; y: number; w: number; h: number };
  aimWorld: Vec;
  selfWorld: Vec | null;
  dt: number;
  particles: number;
  elapsed: number;
  paused: boolean;
  showScoreboard: boolean;
  showDebug: boolean;
  hurtFlash: number;
  cues: { kind: string; sector: number; band: 'near' | 'far'; t: number }[];
  damageDirs: { angle: number; t: number; amount: number }[];
  hits: { t: number; amount: number; x: number; y: number }[];
  killfeed: { killer: string; victim: string; killerTeam: number; victimTeam: number; t: number; byUs: boolean }[];
  banner: { text: string; sub: string; t: number; color: string; small?: boolean } | null;
}

export function newHudModel(): HudModel {
  return {
    obs: null,
    map: null,
    session: null,
    view: { x: 0, y: 0, w: 960, h: 540 },
    aimWorld: { x: 0, y: 0 },
    selfWorld: null,
    dt: 0,
    particles: 0,
    elapsed: 0,
    paused: false,
    showScoreboard: false,
    showDebug: false,
    hurtFlash: 0,
    cues: [],
    damageDirs: [],
    hits: [],
    killfeed: [],
    banner: null,
  };
}

const CUE_COLORS: Record<string, number> = { shot: 0xff5a3a, charge: 0xffd23a, engine: 0xe8eef5, smoke: 0xa8b0bc, explosion: 0xff9a3a };
const FONT = 'Rajdhani, "Segoe UI", system-ui, sans-serif';
const TEAMC = [TEAM[0].ui, TEAM[1].ui];

export class HudScene extends Phaser.Scene {
  private m!: HudModel;
  private settings!: Settings;
  private g!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private mini!: Phaser.GameObjects.Image;
  private fpsAcc = { t: 0, n: 0, fps: 60, worst: 0, worstShown: 0 };
  private hint = 0;

  constructor() {
    super('hud');
  }

  init(data: { model: HudModel; settings: Settings }): void {
    this.m = data.model;
    this.settings = data.settings;
    this.texts = new Map();
  }

  create(): void {
    this.g = this.add.graphics();
    this.mini = this.add.image(1920 - 24, 24, 'minimap').setOrigin(1, 0).setAlpha(0.85);
    this.hint = 0;
  }

  private text(key: string, x: number, y: number, str: string, size: number, color = UI.text, origin: [number, number] = [0, 0], weight = '600'): Phaser.GameObjects.Text {
    let t = this.texts.get(key);
    const fs = `${Math.round(size * this.settings.textScale)}px`;
    if (!t) {
      t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: fs, color, fontStyle: weight, stroke: '#05070b', strokeThickness: 4 }).setOrigin(origin[0], origin[1]);
      this.texts.set(key, t);
    }
    if (t.text !== str) t.setText(str);
    if (t.style.fontSize !== fs) t.setFontSize(fs);
    t.setPosition(x, y).setColor(color).setOrigin(origin[0], origin[1]).setVisible(true);
    return t;
  }

  override update(_t: number, delta: number): void {
    const m = this.m;
    const g = this.g;
    g.clear();
    for (const t of this.texts.values()) t.setVisible(false);
    const obs = m.obs;
    if (!obs || !m.map) return;
    const dt = delta / 1000;
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    this.fpsAcc.worst = Math.max(this.fpsAcc.worst, delta);
    if (this.fpsAcc.t >= 0.5) {
      this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc.worstShown = this.fpsAcc.worst;
      this.fpsAcc.t = 0;
      this.fpsAcc.n = 0;
      this.fpsAcc.worst = 0;
    }
    const pid = m.session!.playerId;
    const me = obs.tanks.find((t) => t.id === pid);
    const toScreen = (p: Vec) => ({ x: (p.x - m.view.x) * 2, y: (p.y - m.view.y) * 2 });

    // ---- hurt vignette
    if (m.hurtFlash > 0) {
      m.hurtFlash = Math.max(0, m.hurtFlash - dt * 2.5);
      if (!this.settings.reducedMotion) {
        g.fillStyle(0xff2a10, 0.18 * m.hurtFlash).fillRect(0, 0, 1920, 1080);
      }
    }

    // ---- sound arcs around own tank (coarse sector + band only)
    if (me && me.alive && m.selfWorld) {
      const c = toScreen(m.selfWorld);
      m.cues = m.cues.filter((q) => (q.t += dt) < 1.6);
      for (const q of m.cues) {
        const a = (q.sector * Math.PI) / 4;
        const life = 1 - q.t / 1.6;
        const near = q.band === 'near';
        const r = near ? 92 : 118;
        g.lineStyle(near ? 9 : 5, CUE_COLORS[q.kind] ?? 0xffffff, 0.85 * life);
        g.beginPath();
        g.arc(c.x, c.y, r, a - 0.36, a + 0.36);
        g.strokePath();
        const lx = c.x + Math.cos(a) * (r + 22);
        const ly = c.y + Math.sin(a) * (r + 22);
        this.text(`cue${q.kind}${q.sector}`, lx, ly, q.kind.toUpperCase(), 15, '#' + (CUE_COLORS[q.kind] ?? 0xffffff).toString(16).padStart(6, '0'), [0.5, 0.5]).setAlpha(life);
      }
      // damage direction wedges at the screen edge
      m.damageDirs = m.damageDirs.filter((d) => (d.t += dt) < 1.5);
      for (const d of m.damageDirs) {
        const life = 1 - d.t / 1.5;
        g.lineStyle(14, 0xff3a20, 0.75 * life);
        g.beginPath();
        g.arc(c.x, c.y, 160, d.angle - 0.3, d.angle + 0.3);
        g.strokePath();
      }
    }

    // ---- hit markers
    m.hits = m.hits.filter((h) => (h.t += dt) < 0.7);
    for (const [i, h] of m.hits.entries()) {
      const p = toScreen(h);
      const life = 1 - h.t / 0.7;
      g.lineStyle(3, 0xffffff, life);
      const s = 14;
      g.lineBetween(p.x - s, p.y - s, p.x - 5, p.y - 5);
      g.lineBetween(p.x + s, p.y - s, p.x + 5, p.y - 5);
      g.lineBetween(p.x - s, p.y + s, p.x - 5, p.y + 5);
      g.lineBetween(p.x + s, p.y + s, p.x + 5, p.y + 5);
      this.text(`hit${i}`, p.x, p.y - 40 - h.t * 40, `-${h.amount}`, 26, '#ffe6a0', [0.5, 0.5], '700').setAlpha(life);
    }

    const training = m.session!.training;
    if (training) this.drawTraining(training);
    // ---- top bar: score and timer
    const [s0, s1] = obs.match.scores;
    const mine = obs.team;
    const tr = Math.max(0, obs.match.timeRemaining);
    if (!training) {
      g.fillStyle(UI.panel, 0.62).fillRoundedRect(960 - 230, 14, 460, 74, 12);
      this.text('s0', 960 - 70, 50, String(mine === 0 ? s0 : s1), 46, TEAMC[mine]!, [1, 0.5], '700');
      this.text('s1', 960 + 70, 50, String(mine === 0 ? s1 : s0), 46, TEAMC[1 - mine]!, [0, 0.5], '700');
      const mm = Math.floor(tr / 60);
      const ss = Math.floor(tr % 60);
      const phaseLabel = obs.match.phase === 'countdown' ? `${Math.ceil(tr)}` : obs.match.phase === 'suddenDeath' ? `SD ${Math.ceil(tr)}` : `${mm}:${String(ss).padStart(2, '0')}`;
      this.text('timer', 960, 40, phaseLabel, 30, obs.match.phase === 'suddenDeath' ? '#ff9a6a' : UI.text, [0.5, 0.5], '700');
      this.text('target', 960, 72, `FIRST TO ${obs.match.killTarget}`, 15, UI.muted, [0.5, 0.5]);
      this.text('t0', 960 - 215, 30, 'IRONVEIL', 14, TEAMC[0]!, [0, 0.5]);
      this.text('t1', 960 + 215, 30, 'RUSTGUARD', 14, TEAMC[1]!, [1, 0.5]);
    }

    // ---- countdown / banners
    if (obs.match.phase === 'countdown') this.text('cd', 960, 400, String(Math.ceil(tr)), 140, '#e8f4ff', [0.5, 0.5], '700');
    if (m.banner) {
      m.banner.t += dt;
      const life = m.banner.t < 2.2 ? 1 : Math.max(0, 1 - (m.banner.t - 2.2) / 0.6);
      if (life <= 0) m.banner = null;
      else {
        this.text('banner', 960, m.banner.small ? 300 : 360, m.banner.text, m.banner.small ? 44 : 96, m.banner.color, [0.5, 0.5], '700').setAlpha(life);
        if (m.banner.sub) this.text('bannersub', 960, m.banner.small ? 340 : 430, m.banner.sub, 26, '#c8d4e4', [0.5, 0.5]).setAlpha(life);
      }
    }

    // ---- kill feed (top-left)
    m.killfeed = m.killfeed.filter((k) => (k.t += dt) < 6).slice(-6);
    m.killfeed.forEach((k, i) => {
      const y = 24 + i * 32;
      const alpha = k.t > 5 ? 1 - (k.t - 5) : 1;
      g.fillStyle(UI.panel, 0.5 * alpha).fillRoundedRect(20, y - 2, 380, 28, 6);
      this.text(`kfk${i}`, 32, y + 12, k.killer, 20, TEAMC[k.killerTeam]!, [0, 0.5]).setAlpha(alpha);
      this.text(`kfx${i}`, 210, y + 12, '▸', 20, '#c0c8d4', [0.5, 0.5]).setAlpha(alpha);
      this.text(`kfv${i}`, 388, y + 12, k.victim, 20, TEAMC[k.victimTeam]!, [1, 0.5]).setAlpha(alpha);
    });

    // ---- radio (allied bot callouts)
    if (this.settings.showRadio && m.session) {
      const lines = m.session.radio.filter((r) => obs.tick - r.tick < 30 * 7).slice(-4);
      lines.forEach((r, i) => {
        const age = (obs.tick - r.tick) / 30;
        const alpha = age > 6 ? 1 - (age - 6) : 1;
        this.text(`radio${i}`, 28, 460 + i * 30, `${r.from}: ${r.text}`, 20, '#a8e6c8', [0, 0.5]).setAlpha(alpha);
      });
    }

    // ---- minimap
    this.drawMinimap(obs, me);

    // ---- bottom-left: vehicle state
    if (me) this.drawVehiclePanel(me, obs);

    // ---- death overlay
    if (me && !me.alive) {
      const left = me.respawnTick >= 0 ? Math.max(0, (me.respawnTick - obs.tick) / 30) : 0;
      g.fillStyle(0x000000, 0.35).fillRect(0, 0, 1920, 1080);
      this.text('dead', 960, 500, 'DESTROYED', 72, '#ff8a6a', [0.5, 0.5], '700');
      if (obs.match.phase !== 'ended') this.text('respawn', 960, 570, `Redeploying in ${left.toFixed(1)}s`, 28, '#e0e6ee', [0.5, 0.5]);
    }

    // ---- intro hint
    this.hint += dt;
    if (this.hint < 14 && me) {
      const b = this.settings.bindings;
      const k = (a: keyof typeof b) => codeLabel(b[a][0]!);
      const alpha = this.hint > 12 ? 1 - (this.hint - 12) / 2 : 1;
      this.text('hint', 1230, 1048, `${k('up')}${k('left')}${k('down')}${k('right')} drive · Mouse aim · hold ${k('fire')} to charge, release to fire · ${codeLabel(b.cancel[0]!)} cancel · ${k('smoke')} smoke · hold ${k('silent')} silent · ${k('scoreboard')} scores`, 22, '#c8d4e4', [0.5, 0.5]).setAlpha(alpha);
    }

    if (m.showScoreboard) this.drawScoreboard(obs);
    if (m.showDebug) {
      this.text('dbg', 1900, 1060, `${this.fpsAcc.fps.toFixed(0)} fps · worst ${this.fpsAcc.worstShown.toFixed(1)} ms · particles ${m.particles} · tick ${obs.tick}`, 16, UI.muted, [1, 1]);
    }
  }

  private drawTraining(tr: NonNullable<LocalSession['training']>): void {
    const g = this.g;
    const b = this.settings.bindings;
    const keys = (s: string) => s.replace(/{(fire|cancel|smoke|silent)}/g, (_, a: keyof typeof b) => codeLabel(b[a][0]!));
    const x = 1920 - 24 - 420;
    const y = 300;
    g.fillStyle(UI.panel, 0.7).fillRoundedRect(x, y, 420, 60 + tr.steps.length * 34 + 70, 12);
    this.text('trt', x + 20, y + 30, tr.complete ? 'TRAINING COMPLETE' : 'TRAINING', 26, tr.complete ? '#9ff0c8' : UI.text, [0, 0.5], '700');
    const cur = tr.current();
    tr.steps.forEach((s, i) => {
      const yy = y + 70 + i * 34;
      const active = cur?.id === s.id;
      this.text('trs' + i, x + 20, yy, (s.done ? '✔  ' : active ? '▶  ' : '•  ') + s.label, 20, s.done ? '#6fae8e' : active ? '#ffd27a' : '#a8b4c4', [0, 0.5], active ? '700' : '500');
    });
    const hint = tr.complete ? 'Esc → Quit to menu, then Deploy into a real match.' : keys(cur?.hint ?? '');
    this.text('trh', x + 20, y + 70 + tr.steps.length * 34 + 16, hint, 18, UI.text, [0, 0.5]).setWordWrapWidth(390);
  }

  private drawMinimap(obs: Observation, me: TankView | undefined): void {
    const g = this.g;
    const mapW = this.m.map!.width;
    const scale = 0.125 * 1.25;
    const w = mapW * scale;
    const h = this.m.map!.height * scale;
    const x0 = 1920 - 24 - w;
    const y0 = 24;
    this.mini.setScale(1.25).setPosition(1920 - 24, 24);
    g.lineStyle(2, 0x0a0e14, 0.9).strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
    const P = (x: number, y: number) => ({ x: x0 + x * scale, y: y0 + y * scale });
    // view rect
    const v = P(this.m.view.x, this.m.view.y);
    g.lineStyle(1, 0xffffff, 0.35).strokeRect(v.x, v.y, this.m.view.w * scale, this.m.view.h * scale);
    for (const s of obs.smokes) {
      const p = P(s.x, s.y);
      g.fillStyle(0xd0d4da, 0.55).fillCircle(p.x, p.y, s.radius * scale);
    }
    for (const lk of obs.lastKnown) {
      const p = P(lk.x, lk.y);
      const life = 1 - lk.age / (TUNING.vision.lastKnownMarker * 30);
      g.lineStyle(2, TEAM[1].uiHex, 0.3 + 0.6 * life).strokeCircle(p.x, p.y, 5);
    }
    for (const t of obs.tanks) {
      if (!t.alive) continue;
      const p = P(t.x, t.y);
      const friendly = t.team === obs.team;
      const col = friendly ? TEAM[0].uiHex : TEAM[1].uiHex;
      if (t.id === me?.id) {
        g.fillStyle(0xffffff, 1).fillTriangle(p.x + Math.cos(t.turret) * 8, p.y + Math.sin(t.turret) * 8, p.x + Math.cos(t.turret + 2.5) * 6, p.y + Math.sin(t.turret + 2.5) * 6, p.x + Math.cos(t.turret - 2.5) * 6, p.y + Math.sin(t.turret - 2.5) * 6);
      } else if (friendly) g.fillStyle(col, 1).fillCircle(p.x, p.y, 4);
      else g.fillStyle(col, 1).fillRect(p.x - 4, p.y - 4, 8, 8); // shape differs by team, not only colour
    }
    for (const l of this.m.map!.landmarks) {
      const p = P(l.x, l.y);
      this.text(`lm${l.name}`, p.x, p.y, l.name, 13, '#d8dee8', [0.5, 0.5]).setAlpha(0.75);
    }
  }

  private drawVehiclePanel(me: TankView, obs: Observation): void {
    const g = this.g;
    const x = 28;
    const y = 900;
    g.fillStyle(UI.panel, 0.62).fillRoundedRect(x - 8, y - 12, 520, 168, 12);
    // HP segmented
    const hp = me.hp / TUNING.tank.maxHp;
    this.text('hpl', x, y + 4, 'HULL', 16, UI.muted);
    for (let i = 0; i < 10; i++) {
      const on = hp * 10 > i + 0.01;
      g.fillStyle(on ? (hp < 0.35 ? 0xff6a4a : TEAM[0].uiHex) : UI.bar, 1).fillRect(x + 64 + i * 32, y, 28, 18);
    }
    this.text('hpv', x + 400, y + 9, `${Math.ceil(me.hp)}`, 24, hp < 0.35 ? '#ff8a6a' : UI.text, [0, 0.5], '700');

    // Weapon
    const wy = y + 44;
    this.text('wl', x, wy + 4, 'CANNON', 16, UI.muted);
    const bw = 330;
    g.fillStyle(UI.bar, 1).fillRect(x + 64, wy, bw, 20);
    let label = 'READY';
    let col = '#bff2ff';
    if (me.phase === 'charging') {
      const full = me.charge >= 1;
      g.fillStyle(full ? 0xffd27a : 0x6fd3ff, 1).fillRect(x + 64, wy, bw * me.charge, 20);
      if (full && me.hold !== null) {
        const f = me.hold / WEAPON_TICKS.hold;
        g.fillStyle(f < 0.33 ? 0xff5a3a : 0xffffff, 0.9).fillRect(x + 64, wy + 22, bw * f, 5);
        label = `FULL · ${(me.hold / 30).toFixed(1)}s`;
        col = f < 0.33 ? '#ff8a6a' : '#ffd27a';
      } else {
        label = `CHARGING ${Math.round(me.charge * 100)}%`;
        col = '#9fe8ff';
      }
      // tap/full markers
      g.fillStyle(0xffffff, 0.5).fillRect(x + 64 + bw - 2, wy - 3, 2, 26);
    } else if (me.phase === 'reloading') {
      const f = 1 - me.weaponTimer / Math.max(1, me.reloadTicks);
      g.fillStyle(0x4a5868, 1).fillRect(x + 64, wy, bw * f, 20);
      label = 'RELOADING';
      col = UI.muted;
    } else if (me.phase === 'vent' || me.phase === 'cancel') {
      const total = me.phase === 'vent' ? WEAPON_TICKS.vent : WEAPON_TICKS.cancel;
      g.fillStyle(0x3a4a58, 1).fillRect(x + 64, wy, bw * (1 - me.weaponTimer / total), 20);
      label = me.phase === 'vent' ? 'VENTING' : 'CANCELLED';
      col = '#9fdcff';
    } else {
      g.fillStyle(0x2c4a5a, 1).fillRect(x + 64, wy, bw, 20);
    }
    this.text('wv', x + 404, wy + 10, label, 20, col, [0, 0.5], '700');

    // Smoke, quiet and reveal states — facts about the player's own vehicle only.
    const sy = y + 92;
    const smokeLeft = Math.max(0, (me.smokeReadyTick - obs.tick) / 30);
    const sk = codeLabel(this.settings.bindings.smoke[0]!);
    g.fillStyle(UI.bar, 1).fillRoundedRect(x, sy, 130, 44, 8);
    if (smokeLeft > 0) g.fillStyle(0x4a5868, 1).fillRoundedRect(x, sy, 130 * (1 - smokeLeft / TUNING.smoke.cooldown), 44, 8);
    else g.fillStyle(0x6a7a8a, 1).fillRoundedRect(x, sy, 130, 44, 8);
    this.text('smk', x + 65, sy + 22, smokeLeft > 0 ? `SMOKE ${smokeLeft.toFixed(0)}s` : `SMOKE [${sk}]`, 18, smokeLeft > 0 ? UI.muted : '#f0f4f8', [0.5, 0.5], '700');
    const quiet = me.quiet;
    const silent = me.silent;
    g.fillStyle(quiet ? 0x1f5a44 : silent ? 0x5a5020 : UI.bar, 1).fillRoundedRect(x + 142, sy, 160, 44, 8);
    this.text('qt', x + 222, sy + 22, quiet ? 'QUIET MOVEMENT' : silent ? 'SLOWING…' : 'ENGINE AUDIBLE', 16, quiet ? '#9ff0c8' : silent ? '#f0e090' : UI.muted, [0.5, 0.5], '700');
    if (me.revealed) {
      g.fillStyle(0x6a2a1a, 1).fillRoundedRect(x + 314, sy, 180, 44, 8);
      this.text('rv', x + 404, sy + 22, 'FIRING REVEAL', 16, '#ffb090', [0.5, 0.5], '700');
    } else if (me.inBrush) {
      g.fillStyle(0x24401c, 1).fillRoundedRect(x + 314, sy, 180, 44, 8);
      this.text('rv', x + 404, sy + 22, 'IN BRUSH', 16, '#b8e8a0', [0.5, 0.5], '700');
    }
    if (me.protected) this.text('prot', x, y - 36, 'SPAWN PROTECTION', 18, '#bff2ff', [0, 0.5], '700');
  }

  private drawScoreboard(obs: Observation): void {
    const g = this.g;
    g.fillStyle(0x05070c, 0.85).fillRoundedRect(560, 200, 800, 560, 16);
    this.text('sbt', 960, 240, 'SCOREBOARD', 34, UI.text, [0.5, 0.5], '700');
    const cols = [0, 1];
    for (const team of cols) {
      const rows = obs.scoreboard.filter((r) => r.team === team).sort((a, b) => b.kills - a.kills);
      const x = team === 0 ? 600 : 980;
      this.text(`sbh${team}`, x, 290, team === 0 ? 'IRONVEIL' : 'RUSTGUARD', 24, TEAMC[team]!, [0, 0.5], '700');
      this.text(`sbk${team}`, x + 340, 290, 'K / D', 18, UI.muted, [1, 0.5]);
      rows.forEach((r, i) => {
        const y = 340 + i * 44;
        const persona = r.isBot ? this.m.session?.botInfo(r.id)?.persona : undefined;
        const showPersona = persona && (team === obs.team || obs.match.phase === 'ended');
        this.text(`sbn${team}${i}`, x, y, `${r.name}${showPersona ? `  · ${persona}` : r.isBot ? '' : '  (you)'}`, 22, r.isBot ? '#d8dee8' : '#ffffff', [0, 0.5]);
        this.text(`sbs${team}${i}`, x + 340, y, `${r.kills} / ${r.deaths}`, 22, UI.text, [1, 0.5], '700');
      });
    }
  }
}
