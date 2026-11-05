// World presentation. Renders ONLY the player's team Observation, interpolated between the two
// most recent fixed ticks (prevObs -> obs by session.alpha), so motion is smooth at any frame rate.
import Phaser from 'phaser';
import { LocalSession, type SessionConfig } from '../game/session';
import type { Observation, ObsEvent, TankView, SmokeView } from '../sim/observation';
import { lerp, lerpAngle, type Vec } from '../sim/math';
import { raycastWalls, terrainAt, Terrain } from '../sim/map';
import { DT, TUNING } from '../sim/tuning';
import { WEAPON_TICKS } from '../sim/weapon';
import { bakeTerrain, registerTextures, TEAM_COLORS } from './textures';
import { DEPTH, FxSystem, Spring } from './fx';
import type { InputManager } from './input';
import type { AudioEngine } from './audio';
import type { Settings } from './settings';
import type { HudModel } from './hud';
import { CanvasLayer, rgba } from './canvasLayer';

const VIEW_W = 960;
const VIEW_H = 540;
const ZOOM = 2;

interface TankSprites {
  shadow: Phaser.GameObjects.Image;
  hull: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image;
  barrel: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  ghost: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  recoil: Spring;
  kickX: Spring;
  kickY: Spring;
  lastDust: number;
  lastSpeed: number;
  x: number;
  y: number;
}

interface ShellSprite {
  img: Phaser.GameObjects.Image;
  trail: Vec[];
  team: 0 | 1;
  charge: number;
  seen: number;
}

interface SmokeSprite {
  id: number;
  x: number;
  y: number;
  radius: number;
  puffs: { img: Phaser.GameObjects.Image; ox: number; oy: number; ph: number; vr: number; base: number }[];
  ring: Phaser.GameObjects.Image;
  born: number;
  fading: number;
}

interface Wreck {
  hull: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image;
  x: number;
  y: number;
  age: number;
  tvx: number;
  tvy: number;
  tvr: number;
  tx: number;
  ty: number;
}

export interface GameSceneData {
  cfg: SessionConfig;
  settings: Settings;
  input: InputManager;
  audio: AudioEngine;
  hud: HudModel;
  onEnd: (obs: Observation, session: LocalSession) => void;
}

export class GameScene extends Phaser.Scene {
  session!: LocalSession;
  private d!: GameSceneData;
  private fx!: FxSystem;
  private tanks = new Map<number, TankSprites>();
  private shells = new Map<number, ShellSprite>();
  private deadTrails: { trail: Vec[]; team: 0 | 1; charge: number; t: number }[] = [];
  private smokes = new Map<number, SmokeSprite>();
  private tracks = new Map<number, Phaser.GameObjects.Image>();
  private ghosts: Phaser.GameObjects.Image[] = [];
  private scorches: { img: Phaser.GameObjects.Image; t: number }[] = [];
  private wrecks: Wreck[] = [];
  private lightL!: CanvasLayer;
  private bloomL!: CanvasLayer;
  private fogL!: CanvasLayer;
  private trailG!: Phaser.GameObjects.Graphics;
  private overlayG!: Phaser.GameObjects.Graphics;
  private reticle!: Phaser.GameObjects.Image;
  private barrelMark!: Phaser.GameObjects.Image;
  private cam = { x: 0, y: 0 };
  private camKick = { x: new Spring(220, 18), y: new Spring(220, 18) };
  private ended = false;
  private time0 = 0;
  private lastHoldBeep = -1;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.d = data;
    this.tanks = new Map();
    this.shells = new Map();
    this.smokes = new Map();
    this.tracks = new Map();
    this.ghosts = [];
    this.scorches = [];
    this.wrecks = [];
    this.deadTrails = [];
    this.ended = false;
  }

  create(): void {
    registerTextures(this);
    this.session = new LocalSession(this.d.cfg);
    const map = this.session.map;
    const key = `ground:${map.id}:${map.version}`;
    if (!this.textures.exists(key)) {
      const baked = bakeTerrain(map);
      this.textures.addCanvas(key, baked.ground);
      this.textures.addCanvas(`canopy:${map.id}:${map.version}`, baked.canopy);
      this.textures.addCanvas('minimap', baked.mini);
    }
    this.add.image(0, 0, key).setOrigin(0).setDepth(DEPTH.ground);
    this.add.image(0, 0, `canopy:${map.id}:${map.version}`).setOrigin(0).setDepth(DEPTH.canopy).setAlpha(0.93);

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBackgroundColor(0x0b0e14);
    this.fx = new FxSystem(this, this.d.settings.lowEffects, this.d.settings.reducedMotion);

    this.lightL = new CanvasLayer(this, 'lightmap', VIEW_W / 3, VIEW_H / 3, 3, DEPTH.light, Phaser.BlendModes.MULTIPLY);
    this.bloomL = new CanvasLayer(this, 'bloommap', VIEW_W / 4, VIEW_H / 4, 4, DEPTH.bloom, Phaser.BlendModes.ADD);
    this.fogL = new CanvasLayer(this, 'fogmap', VIEW_W / 4, VIEW_H / 4, 4, DEPTH.fog, Phaser.BlendModes.NORMAL);
    this.trailG = this.add.graphics().setDepth(DEPTH.emissive).setBlendMode(Phaser.BlendModes.ADD);
    this.overlayG = this.add.graphics().setDepth(DEPTH.overlay);
    this.reticle = this.add.image(0, 0, 'ring').setDepth(DEPTH.reticle).setScale(0.12).setAlpha(0.8);
    this.barrelMark = this.add.image(0, 0, 'ring').setDepth(DEPTH.reticle).setScale(0.07).setTint(0xffd27a).setAlpha(0.9);

    const me = this.session.world.tank(this.session.playerId);
    this.cam = { x: me.pos.x, y: me.pos.y };
    this.time0 = this.time.now;
    this.d.hud.map = map;
    this.d.hud.session = this.session;
    this.input.setDefaultCursor('none');
  }

  setPaused(p: boolean): void {
    if (p) this.session.pause();
    else this.session.resume();
    this.d.hud.paused = p;
  }

  restartMatch(): void {
    this.scene.restart(this.d);
  }

  applySettings(): void {
    this.fx.setQuality(this.d.settings.lowEffects, this.d.settings.reducedMotion);
  }

  // -------------------------------------------------------------- frame
  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    const s = this.session;
    const ptr = this.input.activePointer;
    const aim = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    s.advance(dt, () => this.d.input.sample({ x: aim.x, y: aim.y }));

    for (const { event } of s.drainEvents()) this.onEvent(event);
    for (const { cue } of s.drainCues()) {
      this.d.audio.cue(cue.kind, cue.sector, cue.band === 'near');
      this.d.hud.cues.push({ ...cue, t: 0 });
    }

    const a = s.alpha;
    const prev = s.prevObs;
    const cur = s.obs;
    this.renderTracks(cur);
    const selfPos = this.renderTanks(prev, cur, a, dt);
    this.renderShells(cur, a, dt);
    this.renderSmokes(cur, dt);
    this.renderGhosts(cur);
    this.renderWrecks(dt);
    this.fx.update(dt);

    // camera: follow interpolated own tank + bounded aim lead, smoothed independently of aim maths
    if (selfPos) {
      const lx = aim.x - selfPos.x;
      const ly = aim.y - selfPos.y;
      const ll = Math.hypot(lx, ly);
      const lead = Math.min(80, ll * 0.22);
      const tx = selfPos.x + (ll > 1 ? (lx / ll) * lead : 0);
      const ty = selfPos.y + (ll > 1 ? (ly / ll) * lead : 0);
      const k = 1 - Math.exp(-dt * 9);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    this.camKick.x.step(dt);
    this.camKick.y.step(dt);
    const map = s.map;
    const sh = this.fx.shakeOffset();
    const cx = Phaser.Math.Clamp(this.cam.x, VIEW_W / 2, map.width - VIEW_W / 2) + this.camKick.x.x + sh.x;
    const cy = Phaser.Math.Clamp(this.cam.y, VIEW_H / 2, map.height - VIEW_H / 2) + this.camKick.y.x + sh.y;
    this.cameras.main.centerOn(cx, cy);
    const vx = cx - VIEW_W / 2;
    const vy = cy - VIEW_H / 2;

    this.renderLighting(vx, vy, cur, a, prev);
    this.renderFog(vx, vy, prev, cur, a);
    this.renderReticles(aim, selfPos, cur);
    this.updateAudio(cur);
    this.updateHud(cur, aim, vx, vy, selfPos, dt);

    if (cur.match.phase === 'ended' && !this.ended) {
      this.ended = true;
      this.time.delayedCall(2600, () => this.d.onEnd(cur, s));
    }
  }

  // -------------------------------------------------------------- events
  private screenPan(x: number): number {
    return Phaser.Math.Clamp((x - this.cam.x) / (VIEW_W / 2), -1, 1);
  }

  private distVol(x: number, y: number, range = 900): number {
    const d = Math.hypot(x - this.cam.x, y - this.cam.y);
    return Math.max(0, 1 - d / range);
  }

  private onEvent(e: ObsEvent): void {
    const pid = this.session.playerId;
    const hud = this.d.hud;
    const reduced = this.d.settings.reducedMotion;
    switch (e.type) {
      case 'shot': {
        const team = this.session.obs.tanks.find((t) => t.id === e.tank)?.team ?? 1;
        this.fx.muzzle(e.x, e.y, e.angle, e.charge, team);
        const ts = this.tanks.get(e.tank);
        if (ts) {
          // Inertial, charge-scaled cosmetic recoil with spring settling.
          ts.recoil.kick(-(140 + 360 * e.charge) * (reduced ? 0.5 : 1));
          if (!reduced) {
            const k = 40 + 150 * e.charge;
            ts.kickX.kick(-Math.cos(e.angle) * k);
            ts.kickY.kick(-Math.sin(e.angle) * k);
          }
        }
        if (e.tank === pid && !reduced) {
          const k = 30 + 160 * e.charge;
          this.camKick.x.kick(-Math.cos(e.angle) * k);
          this.camKick.y.kick(-Math.sin(e.angle) * k);
          if (e.charge > 0.5) this.fx.shake(1.5 * e.charge, 0.15);
        }
        this.d.audio.shot(e.charge, this.screenPan(e.x), e.tank === pid ? 0.9 : 0.75 * this.distVol(e.x, e.y, 1100));
        break;
      }
      case 'impact': {
        this.fx.impact(e.x, e.y, e.angle, e.kind, e.charge);
        if (e.kind !== 'tank' && this.scorches.length < 40) {
          const img = this.add.image(e.x, e.y, 'scorch').setDepth(DEPTH.decals).setScale(0.35 + e.charge * 0.35).setRotation(Math.random() * 6);
          this.scorches.push({ img, t: 0 });
        }
        const sh = this.shells.get(e.projectile);
        if (sh) {
          this.deadTrails.push({ trail: [...sh.trail, { x: e.x, y: e.y }], team: sh.team, charge: sh.charge, t: 0 });
          sh.img.destroy();
          this.shells.delete(e.projectile);
        }
        this.d.audio.impact(e.kind, e.charge, this.screenPan(e.x), this.distVol(e.x, e.y));
        break;
      }
      case 'damage':
        if (e.target === pid) {
          hud.damageDirs.push({ angle: Math.atan2(e.fromY - this.cam.y, e.fromX - this.cam.x), t: 0, amount: e.amount });
          this.fx.shake(2 + e.charge * 4, 0.25);
          hud.hurtFlash = 1;
        } else if (e.byUs) {
          hud.hits.push({ t: 0, amount: e.amount, x: this.session.obs.tanks.find((t) => t.id === e.target)?.x ?? 0, y: this.session.obs.tanks.find((t) => t.id === e.target)?.y ?? 0 });
          this.d.audio.hitConfirm();
        }
        break;
      case 'death': {
        this.fx.explosion(e.x, e.y);
        this.fx.shake(6 * this.distVol(e.x, e.y, 700), 0.45);
        const hull = this.add.image(e.x, e.y, `hullX${e.team}`).setScale(0.5).setRotation(e.hull).setDepth(DEPTH.wrecks);
        const ta = Math.random() * Math.PI * 2;
        const turret = this.add.image(e.x, e.y, `turretX${e.team}`).setScale(0.5).setRotation(e.turret).setDepth(DEPTH.wrecks + 0.1);
        this.wrecks.push({ hull, turret, x: e.x, y: e.y, age: 0, tvx: Math.cos(ta) * 120, tvy: Math.sin(ta) * 120, tvr: (Math.random() - 0.5) * 18, tx: e.x, ty: e.y });
        this.d.audio.explosion(this.screenPan(e.x), Math.max(0.25, this.distVol(e.x, e.y, 1400)));
        const ts = this.tanks.get(e.tank);
        if (ts) this.hideTank(ts);
        break;
      }
      case 'kill': {
        const ours = e.killerTeam === this.session.obs.team;
        hud.killfeed.push({ killer: e.killer, victim: e.victim, killerTeam: e.killerTeam, victimTeam: e.victimTeam, t: 0, byUs: ours });
        break;
      }
      case 'smoke': {
        this.fx.smokeBurst(e.x, e.y, TUNING.smoke.radius);
        this.d.audio.smoke(this.screenPan(e.x), this.distVol(e.x, e.y));
        break;
      }
      case 'vent': {
        const t = this.session.obs.tanks.find((x) => x.id === e.tank);
        if (t) this.fx.vent(t.x, t.y, t.turret);
        this.d.audio.vent(t ? this.screenPan(t.x) : 0, t ? this.distVol(t.x, t.y) : 0.5);
        if (e.tank === pid) hud.banner = { text: 'VENTED', sub: 'Held too long — shot lost', t: 0, color: '#9fdcff', small: true };
        break;
      }
      case 'spawn':
        if (e.tank === pid) {
          this.cam = { x: e.x, y: e.y };
        }
        break;
      case 'match':
        if (e.phase === 'live') hud.banner = { text: 'ENGAGE', sub: `First to ${this.session.obs.match.killTarget} kills`, t: 0, color: '#e8f4ff' };
        if (e.phase === 'suddenDeath') hud.banner = { text: 'SUDDEN DEATH', sub: 'Next kill wins', t: 0, color: '#ff9a6a' };
        if (e.phase === 'ended') {
          const w = e.winner;
          hud.banner = { text: w === 'draw' ? 'DRAW' : w === this.session.obs.team ? 'VICTORY' : 'DEFEAT', sub: '', t: 0, color: w === this.session.obs.team ? '#8fe3ff' : '#ff8a6a' };
        }
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------- tanks
  private tankSprites(t: TankView): TankSprites {
    let s = this.tanks.get(t.id);
    if (s) return s;
    const tex = t.team;
    const label = this.add
      .text(0, 0, t.name, { fontFamily: 'Rajdhani, Segoe UI, sans-serif', fontSize: '9px', color: t.team === this.session.obs.team ? '#cfeeff' : '#ffc4b0', stroke: '#000', strokeThickness: 2 })
      .setOrigin(0.5, 0)
      .setResolution(3)
      .setDepth(DEPTH.overlay);
    s = {
      shadow: this.add.image(0, 0, 'shadow').setDepth(DEPTH.shadows).setScale(1.05, 0.9).setAlpha(0.8),
      hull: this.add.image(0, 0, `hull${tex}`).setScale(0.5).setDepth(DEPTH.tanks),
      barrel: this.add.image(0, 0, 'barrel').setScale(0.5).setOrigin(0.05, 0.5).setDepth(DEPTH.tanks + 0.1),
      turret: this.add.image(0, 0, `turret${tex}`).setScale(0.5).setDepth(DEPTH.tanks + 0.2),
      glow: this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.emissive).setVisible(false),
      ghost: this.add.image(0, 0, `hull${tex}`).setScale(0.5).setDepth(DEPTH.overlay).setAlpha(0.35).setTintFill(t.team === 0 ? 0x9fe3ff : 0xffb08a).setVisible(false),
      label,
      recoil: new Spring(420, 20),
      kickX: new Spring(260, 16),
      kickY: new Spring(260, 16),
      lastDust: 0,
      lastSpeed: 0,
      x: t.x,
      y: t.y,
    };
    this.tanks.set(t.id, s);
    return s;
  }

  private hideTank(s: TankSprites): void {
    for (const o of [s.shadow, s.hull, s.turret, s.barrel, s.glow, s.ghost, s.label]) o.setVisible(false);
  }

  private renderTanks(prev: Observation, cur: Observation, a: number, dt: number): Vec | null {
    const prevMap = new Map(prev.tanks.map((t) => [t.id, t]));
    const seen = new Set<number>();
    let selfPos: Vec | null = null;
    const myTeam = cur.team;
    const now = this.time.now / 1000;
    const g = this.overlayG;
    g.clear();
    for (const t of cur.tanks) {
      if (!t.alive) continue;
      seen.add(t.id);
      const s = this.tankSprites(t);
      const p = prevMap.get(t.id);
      // A newly revealed enemy starts from its newly authorised state (no lerp from stale data).
      const interp = p && p.alive && Math.hypot(p.x - t.x, p.y - t.y) < 60;
      const x = interp ? lerp(p.x, t.x, a) : t.x;
      const y = interp ? lerp(p.y, t.y, a) : t.y;
      const hullA = interp ? lerpAngle(p.hull, t.hull, a) : t.hull;
      const turA = interp ? lerpAngle(p.turret, t.turret, a) : t.turret;
      s.x = x;
      s.y = y;
      s.recoil.step(dt);
      s.kickX.step(dt);
      s.kickY.step(dt);
      const kx = x + s.kickX.x * 0.06;
      const ky = y + s.kickY.x * 0.06;
      const bx = Math.cos(turA);
      const by = Math.sin(turA);
      const rec = Math.max(-9, s.recoil.x * 0.03);
      s.shadow.setVisible(true).setPosition(kx + 4, ky + 6).setRotation(hullA);
      s.hull.setVisible(true).setPosition(kx, ky).setRotation(hullA);
      s.turret.setVisible(true).setPosition(kx, ky).setRotation(turA);
      s.barrel.setVisible(true).setPosition(kx + bx * (4 + rec), ky + by * (4 + rec)).setRotation(turA);
      if (t.id === this.session.playerId) selfPos = { x, y };
      // protection shimmer, brush/smoke ghost for friendlies
      const friendly = t.team === myTeam;
      const inSmoke = cur.smokes.some((sm) => Math.hypot(sm.x - x, sm.y - y) < sm.radius);
      s.ghost.setVisible(friendly && (t.inBrush || inSmoke)).setPosition(kx, ky).setRotation(hullA);
      s.label.setVisible(friendly && t.id !== this.session.playerId).setPosition(x, y + 22);
      if (t.protected) s.hull.setAlpha(0.6 + 0.4 * Math.sin(now * 20));
      else s.hull.setAlpha(1);
      // charge glow at the muzzle
      if (t.phase === 'charging') {
        const mx = kx + bx * 30;
        const my = ky + by * 30;
        const full = t.charge >= 1;
        const pulse = full ? 0.75 + 0.25 * Math.sin(now * 18) : 1;
        s.glow.setVisible(true).setPosition(mx, my).setScale((0.08 + t.charge * 0.22) * pulse).setTint(t.team === 0 ? 0x9fe8ff : 0xffb070).setAlpha(0.9);
        if (Math.random() < t.charge * 0.8) this.fx.chargeMote(mx, my, t.team === 0 ? 0xbff2ff : 0xffd0a0);
      } else s.glow.setVisible(false);
      // health bar
      const hpw = 30;
      const hpFrac = t.hp / TUNING.tank.maxHp;
      g.fillStyle(0x000000, 0.55).fillRect(x - hpw / 2 - 1, y - 30, hpw + 2, 4);
      g.fillStyle(friendly ? 0x6fd3ff : 0xff7a5a, 0.95).fillRect(x - hpw / 2, y - 29, hpw * hpFrac, 2);
      if (!friendly && t.inBrush) g.lineStyle(1, 0xff7a5a, 0.8).strokeCircle(x, y, 24);
      // ground FX: dust & drift spray (visible tanks only)
      const sp = Math.hypot(t.vx, t.vy);
      if (!this.d.settings.lowEffects && sp > 50 && now - s.lastDust > 0.05) {
        s.lastDust = now;
        const terr = terrainAt(this.session.map, x, y);
        const hx = Math.cos(hullA);
        const hy = Math.sin(hullA);
        const lateral = Math.abs(t.vx * -hy + t.vy * hx);
        const drift = Math.min(1, lateral / 120);
        const tint = terr === Terrain.Mud ? 0x5a4028 : terr === Terrain.Road ? 0x9a968e : terr === Terrain.Brush ? 0x4a6a32 : 0xa8a078;
        const alpha = (terr === Terrain.Road ? 0.25 : 0.4) + drift * 0.3;
        for (const side of [-1, 1]) {
          const px = x - hx * 16 + -hy * 14 * side;
          const py = y - hy * 16 + hx * 14 * side;
          if (Math.random() < 0.6 + drift) this.fx.dust(px, py, -t.vx, -t.vy, tint, 1 + drift * 0.8, alpha);
        }
        if (sp > s.lastSpeed + 2 && Math.random() < 0.4) this.fx.dust(x - hx * 26, y - hy * 26, -hx * 40, -hy * 40, 0x2a2a2a, 0.8, 0.35);
      }
      s.lastSpeed = sp;
    }
    for (const [id, s] of this.tanks) if (!seen.has(id)) this.hideTank(s);
    return selfPos;
  }

  // -------------------------------------------------------------- shells
  private renderShells(cur: Observation, a: number, dt: number): void {
    const seen = new Set<number>();
    for (const p of cur.projectiles) {
      seen.add(p.id);
      let s = this.shells.get(p.id);
      const own = p.team === cur.team;
      if (!s) {
        s = {
          img: this.add.image(0, 0, 'shell').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.emissive + 0.1),
          trail: [],
          team: p.team,
          charge: p.charge,
          seen: 0,
        };
        this.shells.set(p.id, s);
      }
      // Exact for linear flight: back-project from the latest authorised state.
      const x = p.x - p.vx * DT * (1 - a);
      const y = p.y - p.vy * DT * (1 - a);
      s.img.setPosition(x, y).setRotation(Math.atan2(p.vy, p.vx)).setScale(0.55 + p.charge * 0.55, 0.6 + p.charge * 0.6).setTint(own ? 0xc8f4ff : 0xff6a48);
      s.trail.push({ x, y });
      if (s.trail.length > 10) s.trail.shift();
      s.seen += dt;
    }
    for (const [id, s] of this.shells) {
      if (!seen.has(id)) {
        s.img.destroy();
        this.deadTrails.push({ trail: s.trail, team: s.team, charge: s.charge, t: 0 });
        this.shells.delete(id);
      }
    }
    const g = this.trailG;
    g.clear();
    const drawTrail = (trail: Vec[], team: 0 | 1, charge: number, fade: number) => {
      const color = team === cur.team ? 0x9fe8ff : 0xff6a3a;
      for (let i = 1; i < trail.length; i++) {
        const f = (i / trail.length) * fade;
        g.lineStyle((1 + charge * 3) * f + 0.5, color, 0.55 * f);
        g.lineBetween(trail[i - 1]!.x, trail[i - 1]!.y, trail[i]!.x, trail[i]!.y);
      }
    };
    for (const s of this.shells.values()) drawTrail(s.trail, s.team, s.charge, 1);
    this.deadTrails = this.deadTrails.filter((t) => (t.t += dt) < 0.18);
    for (const t of this.deadTrails) drawTrail(t.trail, t.team, t.charge, 1 - t.t / 0.18);
  }

  // -------------------------------------------------------------- tracks, ghosts, smoke
  private renderTracks(cur: Observation): void {
    const seen = new Set<number>();
    for (const tr of cur.tracks) {
      seen.add(tr.id);
      let img = this.tracks.get(tr.id);
      if (!img) {
        img = this.add.image(tr.x, tr.y, 'track').setDepth(DEPTH.tracks).setScale(0.5).setRotation(tr.axis - Math.PI / 2);
        this.tracks.set(tr.id, img);
      }
      img.setAlpha((tr.stage / TUNING.tracks.fadeStages) * 0.85);
    }
    for (const [id, img] of this.tracks) {
      if (!seen.has(id)) {
        img.destroy();
        this.tracks.delete(id);
      }
    }
  }

  private renderGhosts(cur: Observation): void {
    let i = 0;
    for (const lk of cur.lastKnown) {
      let gimg = this.ghosts[i];
      if (!gimg) {
        gimg = this.add.image(0, 0, 'hull1').setScale(0.5).setDepth(DEPTH.overlay).setTintFill(0xff7a5a);
        this.ghosts.push(gimg);
      }
      const life = 1 - lk.age / (TUNING.vision.lastKnownMarker * 30);
      gimg.setVisible(true).setPosition(lk.x, lk.y).setAlpha(0.12 + 0.3 * life);
      this.overlayG.lineStyle(1, 0xff7a5a, 0.5 * life).strokeCircle(lk.x, lk.y, 26 + (1 - life) * 10);
      i++;
    }
    for (; i < this.ghosts.length; i++) this.ghosts[i]!.setVisible(false);
  }

  private renderSmokes(cur: Observation, dt: number): void {
    const now = this.time.now / 1000;
    const seen = new Set<number>();
    for (const sm of cur.smokes) {
      seen.add(sm.id);
      let s = this.smokes.get(sm.id);
      if (!s) s = this.makeSmoke(sm, now);
      s.fading = 0;
      this.animateSmoke(s, now, 1);
    }
    for (const [id, s] of this.smokes) {
      if (seen.has(id)) continue;
      // Gameplay occlusion has ended; only now may the visual dissipate.
      s.fading += dt;
      const f = 1 - s.fading / 0.9;
      if (f <= 0) {
        for (const p of s.puffs) p.img.destroy();
        s.ring.destroy();
        this.smokes.delete(id);
        continue;
      }
      this.animateSmoke(s, now, f);
    }
  }

  private makeSmoke(sm: SmokeView, now: number): SmokeSprite {
    const n = this.d.settings.lowEffects ? 8 : 18;
    const puffs: SmokeSprite['puffs'] = [];
    for (let k = 0; k < n; k++) {
      const ang = k * 2.39996;
      const rr = Math.sqrt((k + 0.5) / n) * sm.radius * 0.64;
      const shade = 150 + Math.floor(Math.random() * 50);
      const img = this.add
        .image(sm.x, sm.y, `puff${k % 4}`)
        .setDepth(DEPTH.smoke + (k % 3) * 0.01)
        .setTint(Phaser.Display.Color.GetColor(shade, shade + 4, shade + 10))
        .setRotation(Math.random() * 6);
      puffs.push({ img, ox: Math.cos(ang) * rr, oy: Math.sin(ang) * rr, ph: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, base: (sm.radius * 0.95) / 64 });
    }
    const ring = this.add.image(sm.x, sm.y, 'ring').setDepth(DEPTH.smoke + 0.05).setScale((sm.radius * 2) / 128).setAlpha(0.35);
    const s: SmokeSprite = { id: sm.id, x: sm.x, y: sm.y, radius: sm.radius, puffs, ring, born: now, fading: 0 };
    this.smokes.set(sm.id, s);
    return s;
  }

  private animateSmoke(s: SmokeSprite, now: number, f: number): void {
    const age = now - s.born;
    const grow = Math.min(1, 0.75 + age * 1.2);
    const still = this.d.settings.reducedMotion ? 0.2 : 1;
    for (const p of s.puffs) {
      const wob = Math.sin(now * 0.7 + p.ph) * 5 * still;
      const drift = (1 - f) * 30;
      p.img
        .setPosition(s.x + p.ox * (1 + drift / 60) + wob, s.y + p.oy * (1 + drift / 60) + Math.cos(now * 0.6 + p.ph) * 5 * still)
        .setScale(p.base * grow * (1 + 0.05 * Math.sin(now * 0.9 + p.ph) * still) * (1 + (1 - f) * 0.3))
        .setRotation(p.img.rotation + p.vr * 0.016 * still)
        .setAlpha(0.95 * f);
    }
    s.ring.setAlpha(Math.max(0, 0.35 - age * 0.4) * f);
  }

  private renderWrecks(dt: number): void {
    this.wrecks = this.wrecks.filter((w) => {
      w.age += dt;
      if (w.age < 0.8) {
        // turret pops off and tumbles
        w.tx += w.tvx * dt;
        w.ty += w.tvy * dt;
        w.tvx *= 1 - 3 * dt;
        w.tvy *= 1 - 3 * dt;
        w.turret.setPosition(w.tx, w.ty).setRotation(w.turret.rotation + w.tvr * dt).setScale(0.5 + Math.sin((w.age / 0.8) * Math.PI) * 0.25);
      }
      const burn = w.age < 9 ? 1 : Math.max(0, 1 - (w.age - 9) / 4);
      if (burn > 0) {
        this.fx.fireTick(w.x, w.y, burn, dt);
        this.fx.light(w.x, w.y, 110 * burn, 0xff7a2a, 0.55 + Math.random() * 0.25, dt * 1.5, 1);
      }
      const fade = w.age < 14 ? 1 : Math.max(0, 1 - (w.age - 14) / 2);
      w.hull.setAlpha(fade);
      w.turret.setAlpha(fade);
      if (fade <= 0) {
        w.hull.destroy();
        w.turret.destroy();
        return false;
      }
      return true;
    });
    this.scorches = this.scorches.filter((s) => {
      s.t += dt;
      s.img.setAlpha(Math.max(0, 1 - s.t / 8));
      if (s.t > 8) {
        s.img.destroy();
        return false;
      }
      return true;
    });
  }

  // -------------------------------------------------------------- lighting & fog
  private renderLighting(vx: number, vy: number, cur: Observation, a: number, prev: Observation): void {
    const low = this.d.settings.lowEffects;
    const L = this.lightL;
    const B = this.bloomL;
    L.place(vx, vy);
    B.place(vx, vy);
    B.image.setVisible(!low);
    const lc = L.ctx;
    const bc = B.ctx;
    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = '#a7aec8';
    lc.fillRect(0, 0, L.w, L.h);
    lc.globalCompositeOperation = 'lighter';
    bc.globalCompositeOperation = 'source-over';
    bc.clearRect(0, 0, B.w, B.h);
    bc.globalCompositeOperation = 'lighter';
    const glow = (ctx: CanvasRenderingContext2D, s: number, x: number, y: number, radius: number, color: number, intensity: number) => {
      const lx = (x - vx) / s;
      const ly = (y - vy) / s;
      const r = radius / s;
      if (lx < -r || ly < -r || lx > VIEW_W / s + r || ly > VIEW_H / s + r || intensity <= 0.01) return;
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, rgba(color, intensity));
      g.addColorStop(0.3, rgba(color, intensity * 0.55));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    };
    const light = (x: number, y: number, radius: number, color: number, intensity: number) => {
      glow(lc, 3, x, y, radius, color, intensity);
      if (!low) glow(bc, 4, x, y, radius * 0.7, color, intensity * 0.28);
    };
    const cone = (x: number, y: number, ang: number, len: number, color: number, intensity: number) => {
      const lx = (x - vx) / 3;
      const ly = (y - vy) / 3;
      const r = len / 3;
      if (lx < -r || ly < -r || lx > VIEW_W / 3 + r || ly > VIEW_H / 3 + r) return;
      const g = lc.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, rgba(color, intensity));
      g.addColorStop(1, rgba(color, 0));
      lc.fillStyle = g;
      lc.beginPath();
      lc.moveTo(lx, ly);
      lc.arc(lx, ly, r, ang - 0.42, ang + 0.42);
      lc.closePath();
      lc.fill();
    };
    for (const l of this.fx.lights) {
      const t = l.life / l.maxLife;
      const fl = l.flicker ? 0.85 + Math.random() * 0.3 : 1;
      light(l.x, l.y, l.radius, l.color, l.intensity * (1 - t) * fl);
    }
    const prevMap = new Map(prev.tanks.map((t) => [t.id, t]));
    for (const t of cur.tanks) {
      if (!t.alive) continue;
      const s = this.tanks.get(t.id);
      const x = s?.x ?? t.x;
      const y = s?.y ?? t.y;
      const p = prevMap.get(t.id);
      const hull = p ? lerpAngle(p.hull, t.hull, a) : t.hull;
      glow(lc, 3, x, y, t.id === this.session.playerId ? 150 : 90, 0xb8c4ee, 0.3);
      if (!low) cone(x + Math.cos(hull) * 18, y + Math.sin(hull) * 18, hull, 190, 0xfff0d0, 0.32);
      if (t.phase === 'charging') light(x + Math.cos(t.turret) * 30, y + Math.sin(t.turret) * 30, 40 + 80 * t.charge, t.team === 0 ? 0x9fe8ff : 0xffa060, 0.45 + 0.5 * t.charge);
    }
    for (const p of cur.projectiles) light(p.x, p.y, 50 + 50 * p.charge, p.team === cur.team ? 0xbfefff : 0xff7050, 0.75);
    if (this.session.map.landmarks.some((l) => l.name === 'Radio Tower')) light(37 * 32 + 16, 25 * 32 - 42, 60, 0xff4a3a, 0.5 + 0.4 * Math.sin(this.time.now / 300));
    L.commit();
    if (!low) B.commit();
  }

  /** Cosmetic fog: darkens what the team cannot see. Authority already filtered the data. */
  private renderFog(vx: number, vy: number, prev: Observation, cur: Observation, a: number): void {
    const F = this.fogL;
    F.place(vx, vy);
    const ctx = F.ctx;
    const sc = 4;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, F.w, F.h);
    ctx.fillStyle = 'rgba(6,9,16,0.5)';
    ctx.fillRect(0, 0, F.w, F.h);
    ctx.globalCompositeOperation = 'destination-out';
    const map = this.session.map;
    const rays = this.d.settings.lowEffects ? 96 : 180;
    const R = TUNING.vision.radius;
    const prevMap = new Map(prev.tanks.map((t) => [t.id, t]));
    const smokes = cur.smokes;
    for (const t of cur.tanks) {
      if (t.team !== cur.team || !t.alive) continue;
      const p = prevMap.get(t.id);
      const ox = p && p.alive ? lerp(p.x, t.x, a) : t.x;
      const oy = p && p.alive ? lerp(p.y, t.y, a) : t.y;
      if (ox < vx - R - 50 || oy < vy - R - 50 || ox > vx + VIEW_W + R + 50 || oy > vy + VIEW_H + R + 50) continue;
      const inSmoke = smokes.some((s) => Math.hypot(s.x - ox, s.y - oy) < s.radius);
      ctx.beginPath();
      for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        let len = inSmoke ? 34 : R;
        if (!inSmoke) {
          const tw = raycastWalls(map, ox, oy, ox + dx * R, oy + dy * R);
          if (tw !== Infinity) len = Math.min(R, tw * R + 10);
          for (const s of smokes) {
            const fx = ox - s.x;
            const fy = oy - s.y;
            const b = fx * dx + fy * dy;
            const c = fx * fx + fy * fy - s.radius * s.radius;
            const disc = b * b - c;
            if (disc < 0) continue;
            const tt = -b - Math.sqrt(disc);
            if (tt > 0 && tt < len) len = tt + 20;
          }
        }
        const px = (ox + dx * len - vx) / sc;
        const py = (oy + dy * len - vy) / sc;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
    F.commit();
  }

  private renderReticles(aim: Phaser.Math.Vector2, selfPos: Vec | null, cur: Observation): void {
    this.reticle.setPosition(aim.x, aim.y);
    const me = cur.tanks.find((t) => t.id === this.session.playerId);
    if (me && me.alive && selfPos) {
      const d = Math.hypot(aim.x - selfPos.x, aim.y - selfPos.y);
      const s = this.tanks.get(me.id);
      const tur = s ? s.turret.rotation : me.turret;
      this.barrelMark.setVisible(true).setPosition(selfPos.x + Math.cos(tur) * d, selfPos.y + Math.sin(tur) * d);
      const g = this.overlayG;
      g.lineStyle(1, 0xffd27a, 0.18);
      g.lineBetween(selfPos.x + Math.cos(tur) * 34, selfPos.y + Math.sin(tur) * 34, selfPos.x + Math.cos(tur) * Math.min(d, 900), selfPos.y + Math.sin(tur) * Math.min(d, 900));
      // full-charge hold window ring
      if (me.phase === 'charging' && me.hold !== null) {
        const frac = me.hold / WEAPON_TICKS.hold;
        g.lineStyle(2, frac < 0.33 ? 0xff5a3a : 0x9fe8ff, 0.9);
        g.beginPath();
        g.arc(selfPos.x, selfPos.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        g.strokePath();
        if (frac < 0.33 && me.hold !== this.lastHoldBeep && me.hold % 6 === 0) {
          this.lastHoldBeep = me.hold;
          this.d.audio.holdWarning();
        }
      }
    } else this.barrelMark.setVisible(false);
  }

  private updateAudio(cur: Observation): void {
    const me = cur.tanks.find((t) => t.id === this.session.playerId);
    const paused = this.session.paused;
    this.d.audio.setEngine(me ? Math.hypot(me.vx, me.vy) : 0, !!me?.alive && !paused, !!me?.quiet);
    this.d.audio.setChargeHum(me && me.phase === 'charging' && !paused ? me.charge : 0);
  }

  private updateHud(cur: Observation, aim: Phaser.Math.Vector2, vx: number, vy: number, selfPos: Vec | null, dt: number): void {
    const h = this.d.hud;
    h.obs = cur;
    h.view = { x: vx, y: vy, w: VIEW_W, h: VIEW_H };
    h.aimWorld = { x: aim.x, y: aim.y };
    h.selfWorld = selfPos;
    h.dt = dt;
    h.particles = this.fx.count;
    h.elapsed = (this.time.now - this.time0) / 1000;
  }
}

export { TEAM_COLORS };
