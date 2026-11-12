// In-game HUD for the 3D mission view. Design: no boxed panels. Text floats over the scene on
// soft edge scrims, like subtitles and instrument markings, and the cannon state lives on the
// cursor, where the player is already looking.
//
//   top-left      operation title + objectives (completed ones fold away)
//   top-centre    detection: a slim meter that is nearly invisible while you are hidden
//   bottom-centre the comms panel (`comms.ts`, owned by the view): crew radio with portraits
//   bottom-left   a slim hull gauge with smoke / silent / brush chips
//   bottom-right  real-time decisions
//   cursor        reload / charge / hold ring; while charging the damage it will do, and LETHAL
//                 when that kills the enemy under the cursor
//   bottom-left   (beside the hull) the cannon gauge: charge, burst threshold, damage, state
//   over enemies  ? with a suspicion arc, ! in combat, ◆ for a boss; barks as callouts above them;
//                 a health bar once damaged (bright after a hit, with the lost chunk draining away)
//   cursor hits   a hit marker on every hit of ours, red and larger on a kill
import type { MissionSession } from '../../game/mission/session';
import type { Observation, TankView } from '../../sim/observation';
import { WEAPON_TICKS, shotStats } from '../../sim/weapon';
import { TUNING } from '../../sim/tuning';
import { displayName } from '../../content/lore';

const ICON = {
  smoke: '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 7 18z"/></svg>',
  silent: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6" fill="none"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M12 21c0-6 0-9-5-13 6 0 9 3 10 7 1-4 3-6 5-7-2 3-4 7-5 13z"/></svg>',
};

const RING = 2 * Math.PI * 17;
/** Circumference of the suspicion arc around an enemy's "?". */
const MARK_RING = 2 * Math.PI * 11;
/** How long a bark callout stays up (ticks), and its fade-out at the end. */
const BARK_TICKS = 30 * 2.8;
const BARK_FADE = 30 * 0.5;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class Hud3D {
  readonly root: HTMLDivElement;
  private q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
  /** Elements touched every frame, looked up once. */
  private el!: Record<'det' | 'detLbl' | 'detBar' | 'status' | 'hullNum' | 'smoke' | 'smokeEm' | 'silent' | 'brush' | 'cursor' | 'gun' | 'gunFill' | 'gunDmg' | 'gunSt' | 'cd' | 'choice' | 'markers' | 'barks' | 'hint', HTMLElement>;
  private arc!: SVGCircleElement;
  private objKey = '';
  private toastKey = '';
  private choiceKey = '';
  private hint = 0;
  private hullSegs: HTMLElement[] = [];
  private bubbles = new Map<number, HTMLElement>();
  /** Enemy markers, one element per enemy, rebuilt only when its kind changes (?, !, health bar). */
  private marks = new Map<number, { el: HTMLDivElement; shape: string; arc: SVGCircleElement | null; hp: HTMLElement | null; trail: HTMLElement | null; fill: HTMLElement | null }>();
  /** Per enemy: when we last saw it hit (performance.now ms) and the trailing "lost health" value. */
  private hits = new Map<number, { at: number; trail: number }>();

  constructor(host: HTMLElement, private session: MissionSession) {
    this.root = document.createElement('div');
    this.root.className = 'h3';
    this.root.innerHTML = `
      <div class="h3-scrim tl"></div><div class="h3-scrim bl"></div>
      <section class="h3-obj"><div class="h3-op">Operation</div><div class="h3-title"></div><ul></ul></section>
      <section class="h3-det"><div class="lbl">Hidden</div><div class="track"><i></i></div></section>
      <section class="h3-toasts"></section>
      <section class="h3-status">
        <div class="hull"><span class="cap">Hull</span><div class="segs">${'<b></b>'.repeat(10)}</div><span class="num">100</span></div>
        <div class="gun"><span class="cap">Cannon</span><div class="bar"><i class="fill"></i><i class="burst" style="left:${TUNING.cannon.splashFrom * 100}%"></i></div><span class="dmg"><b>22</b><small>dmg</small></span><span class="st">Ready</span></div>
        <div class="chips">
          <span class="chip smoke">${ICON.smoke}<em>Q</em></span>
          <span class="chip silent">${ICON.silent}<em>Silent</em></span>
          <span class="chip brush">${ICON.brush}<em>Concealed</em></span>
        </div>
      </section>
      <section class="h3-choice"></section>
      <section class="h3-markers"></section>
      <section class="h3-barks"></section>
      <div class="h3-cursor"><svg viewBox="-24 -24 48 48">
        <circle class="trk" r="17"/><circle class="arc" r="17" transform="rotate(-90)"/>
        <path class="tick" d="M0 -23v4M0 19v4M-23 0h4M19 0h4"/><circle class="dot" r="1.6"/>
        <path class="hitx" d="M-7 -7l-6 -6M7 -7l6 -6M-7 7l-6 6M7 7l6 6"/><circle class="full" r="22"/></svg><div class="cd"></div></div>
      <div class="h3-lost">Tank lost</div>
      <div class="h3-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</span><span><kbd>Mouse</kbd> aim</span><span><kbd>Space</kbd> hold to charge · release to fire</span><span><kbd>Q</kbd> smoke</span><span><kbd>Shift</kbd> silent</span><span><kbd>Wheel</kbd> zoom</span></div>`;
    host.appendChild(this.root);
    this.q<HTMLElement>('.h3-title').textContent = session.def.title.replace(/^Grey Box:\s*/i, '');
    this.hullSegs = [...this.root.querySelectorAll<HTMLElement>('.hull .segs b')];
    this.arc = this.q<SVGCircleElement>('.arc');
    this.arc.style.strokeDasharray = `${RING}`;
    const h = (sel: string) => this.q<HTMLElement>(sel);
    this.el = {
      det: h('.h3-det'), detLbl: h('.h3-det .lbl'), detBar: h('.h3-det .track i'),
      status: h('.h3-status'), hullNum: h('.hull .num'),
      smoke: h('.chip.smoke'), smokeEm: h('.chip.smoke em'), silent: h('.chip.silent'), brush: h('.chip.brush'),
      cursor: h('.h3-cursor'), gun: h('.h3-status .gun'), gunFill: h('.gun .fill'), gunDmg: h('.gun .dmg b'), gunSt: h('.gun .st'), cd: h('.h3-cursor .cd'),
      choice: h('.h3-choice'), markers: h('.h3-markers'), barks: h('.h3-barks'), hint: h('.h3-hint'),
    };
  }

  /** Write text only when it changed: an unchanged write still dirties layout. */
  private text(el: HTMLElement, s: string): void {
    if (el.textContent !== s) el.textContent = s;
  }

  dispose(): void {
    this.root.remove();
  }

  /** Flash the hit marker on the cursor; a kill makes it red and bigger. */
  hitMark(kill: boolean): void {
    const c = this.el.cursor;
    c.classList.remove('hit', 'kill');
    void c.offsetWidth; // restart the animation
    c.classList.add(kill ? 'kill' : 'hit');
  }

  /** An enemy took damage: its health bar lights up. */
  noteHit(id: number): void {
    const h = this.hits.get(id);
    this.hits.set(id, { at: performance.now(), trail: h?.trail ?? 1 });
  }

  update(cur: Observation, me: TankView | undefined, mouse: { x: number; y: number }, aim: { x: number; y: number }, project: (x: number, y: number, h: number) => { x: number; y: number; on: boolean }, dt: number): void {
    const s = this.session;
    const tick = cur.tick;
    this.root.classList.toggle('ended', !!s.outcome);

    // ---- objectives
    const objs = s.objectives();
    const ok = objs.map((o) => o.id + o.state).join('|');
    if (ok !== this.objKey) {
      this.objKey = ok;
      this.q('.h3-obj ul').innerHTML = objs
        .map((o) => `<li class="${o.state}"><i></i><span>${esc(o.text.replace(/\s*\(optional\)/i, ''))}</span>${/optional/i.test(o.text) ? '<small>optional</small>' : ''}</li>`)
        .join('');
    }

    // ---- detection
    const det = s.detection();
    const state = det >= 1 ? 'spotted' : det > 0.6 ? 'alert' : det > 0.05 ? 'suspicious' : 'hidden';
    const E = this.el;
    if (E.det.dataset.s !== state) {
      E.det.dataset.s = state;
      E.detLbl.textContent = { hidden: 'Hidden', suspicious: 'Suspicious', alert: 'Alert', spotted: 'Spotted' }[state];
    }
    E.detBar.style.transform = `scaleX(${det.toFixed(3)})`;

    // ---- toasts (checkpoint, objective changes)
    const toasts = s.notices.filter((n) => tick - n.tick < 30 * 3.5);
    const tk = toasts.map((n) => n.tick + n.text).join('|');
    if (tk !== this.toastKey) {
      this.toastKey = tk;
      this.q('.h3-toasts').innerHTML = toasts.map((n) => `<div class="toast">${esc(n.text)}</div>`).join('');
    }

    // ---- vehicle status
    const status = E.status;
    this.root.classList.toggle('dead', !me);
    if (me) {
      const hp = Math.max(0, me.hp);
      this.hullSegs.forEach((b, i) => b.classList.toggle('on', hp > i * 10));
      this.text(E.hullNum, String(Math.ceil(hp)));
      status.classList.toggle('low', hp <= 30);
      const smokeLeft = Math.max(0, (me.smokeReadyTick - tick) / 30);
      E.smoke.classList.toggle('ready', smokeLeft <= 0);
      this.text(E.smokeEm, smokeLeft > 0 ? `${Math.ceil(smokeLeft)}s` : 'Q');
      E.silent.classList.toggle('on', me.quiet);
      E.brush.classList.toggle('on', me.inBrush);
    }

    // ---- cursor: cannon ring
    const cur$ = E.cursor;
    cur$.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
    if (me) {
      let frac = 1;
      let mode = 'ready';
      if (me.phase === 'charging') {
        frac = me.charge;
        mode = me.hold !== null ? (me.hold < WEAPON_TICKS.hold * 0.35 ? 'venting' : 'hold') : 'charging';
      } else if (me.phase === 'reloading') {
        frac = 1 - me.weaponTimer / Math.max(1, me.reloadTicks);
        mode = 'reload';
      } else if (me.phase === 'vent' || me.phase === 'cancel') {
        frac = 1 - me.weaponTimer / (me.phase === 'vent' ? WEAPON_TICKS.vent : WEAPON_TICKS.cancel);
        mode = me.phase === 'vent' ? 'vented' : 'reload';
      }
      if (cur$.dataset.m !== mode) cur$.dataset.m = mode;
      this.arc.style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, frac))));

      // ---- cannon gauge and the shot's promise: damage, burst, and whether it kills what you aim at
      const charging = me.phase === 'charging';
      const c = charging ? me.charge : 0;
      const dmg = shotStats(c).damage;
      const burst = c >= TUNING.cannon.splashFrom;
      const gun = E.gun;
      if (gun.dataset.m !== mode) gun.dataset.m = mode;
      gun.classList.toggle('burst', burst);
      E.gunFill.style.transform = `scaleX(${(charging ? c : me.phase === 'ready' ? 0 : Math.max(0, Math.min(1, frac))).toFixed(3)})`;
      this.text(E.gunDmg, String(dmg));
      const holdLeft = me.hold !== null ? me.hold / 30 : 0;
      this.text(
        E.gunSt,
        mode === 'ready' ? 'Ready'
        : mode === 'charging' ? (burst ? 'Charging · burst' : 'Charging')
        : mode === 'hold' || mode === 'venting' ? `Full · release ${holdLeft.toFixed(1)}s`
        : mode === 'vented' ? 'Vented'
        : `Reloading ${(me.weaponTimer / 30).toFixed(1)}s`,
      );
      // the enemy under the cursor, if any
      let target: TankView | undefined;
      let best = 46;
      for (const t of cur.tanks) {
        if (t.team === cur.team || !t.alive) continue;
        const d = Math.hypot(t.x - aim.x, t.y - aim.y);
        if (d < best) [best, target] = [d, t];
      }
      const lethal = !!target && (charging || me.phase === 'ready') && dmg >= target.hp;
      cur$.classList.toggle('lethal', lethal);
      cur$.classList.toggle('charging', charging && c > 0.05);
      this.text(E.cd, lethal ? `LETHAL · ${dmg}` : charging && c > 0.05 ? `${dmg}${burst ? ' · burst' : ''}` : '');
    }

    // ---- decisions
    const c = s.choice;
    const ck = c ? c.prompt + c.startedTick : '';
    const choice = E.choice;
    if (ck !== this.choiceKey) {
      this.choiceKey = ck;
      choice.classList.toggle('show', !!c);
      this.root.classList.toggle('choosing', !!c);
      if (c)
        choice.innerHTML = `<div class="timer"><i></i></div>
          <div class="who"><b>Приказ</b>${esc(c.from ? displayName(c.from) : 'Crew')} · Decision</div>
          <div class="prompt">${esc(c.prompt)}</div>
          ${c.options.map((o, i) => `<div class="opt${i === c.defaultIndex ? ' def' : ''}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></div>`).join('')}`;
    }
    if (c) {
      const left = Math.max(0, (c.expiresTick - tick) / (c.expiresTick - c.startedTick));
      choice.querySelector<HTMLElement>('.timer i')!.style.transform = `scaleX(${left.toFixed(3)})`;
      choice.classList.toggle('urgent', left < 0.25);
    }

    // ---- markers over visible enemies
    const shown = new Set<number>();
    for (const t of cur.tanks) {
      if (t.team === cur.team || !t.alive) continue;
      const p = project(t.x, t.y, 64);
      if (!p.on) continue;
      const boss = !s.simple.has(t.id);
      const st = s.simple.state(t.id);
      const sus = s.simple.suspicion(t.id);
      let cls = '', glyph = '';
      if (boss) [cls, glyph] = ['boss', '◆'];
      else if (st === 'combat') [cls, glyph] = ['combat', '!'];
      else if (st === 'searching' || st === 'suspicious' || sus > 0.05) [cls, glyph] = ['sus', '?'];
      // health bar once damaged: bright for a few seconds after a hit, then a quiet reminder
      const frac = Math.max(0, t.hp / t.maxHp);
      const bar = frac < 1;
      if (!glyph && !bar) continue;
      shown.add(t.id);
      let m = this.marks.get(t.id);
      if (!m) {
        m = { el: document.createElement('div'), shape: '', arc: null, hp: null, trail: null, fill: null };
        E.markers.appendChild(m.el);
        this.marks.set(t.id, m);
      }
      const low = bar && frac <= 0.34;
      const shape = `${cls}|${glyph}|${bar ? (low ? 'low' : 'bar') : ''}`;
      if (m.shape !== shape) {
        m.shape = shape;
        m.el.className = `mk ${cls}`;
        const arc = cls === 'sus' ? `<svg viewBox="-14 -14 28 28"><circle r="11" class="t"/><circle r="11" class="a" transform="rotate(-90)" style="stroke-dasharray:${MARK_RING.toFixed(1)}"/></svg>` : '';
        m.el.innerHTML = `${glyph ? `${arc}<span>${glyph}</span>` : ''}${bar ? `<div class="hp${low ? ' low' : ''}"><i class="trail"></i><i class="fill"></i></div>` : ''}`;
        m.arc = m.el.querySelector<SVGCircleElement>('.a');
        m.hp = m.el.querySelector<HTMLElement>('.hp');
        m.trail = m.el.querySelector<HTMLElement>('.trail');
        m.fill = m.el.querySelector<HTMLElement>('.fill');
      }
      m.el.style.transform = `translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px)`;
      if (m.arc) m.arc.style.strokeDashoffset = (MARK_RING * (1 - sus)).toFixed(1);
      if (m.hp && m.trail && m.fill) {
        const h = this.hits.get(t.id) ?? { at: 0, trail: frac };
        h.trail = Math.max(frac, h.trail - dt * 0.6);
        this.hits.set(t.id, h);
        const since = (performance.now() - h.at) / 1000;
        m.hp.style.opacity = (since < 2.5 ? 1 : Math.max(0.4, 1 - (since - 2.5) / 1.5)).toFixed(2);
        m.trail.style.width = `${(h.trail * 100).toFixed(1)}%`;
        m.fill.style.width = `${(frac * 100).toFixed(1)}%`;
      }
    }
    for (const [id, m] of this.marks)
      if (!shown.has(id)) {
        m.el.remove();
        this.marks.delete(id);
      }

    // ---- barks: callouts over the enemy that spoke, only while that enemy is visible
    this.updateBarks(cur, project);

    // ---- first-seconds hint
    this.hint += dt;
    if (this.hint < 14) E.hint.style.opacity = String(this.hint < 12 ? 1 : Math.max(0, 1 - (this.hint - 12) / 1.5));
  }

  private updateBarks(cur: Observation, project: (x: number, y: number, h: number) => { x: number; y: number; on: boolean }): void {
    const tick = cur.tick;
    const latest = new Map<number, (typeof this.session.barks)[number]>();
    for (const b of this.session.barks) if (b.tick <= tick && tick - b.tick < BARK_TICKS) latest.set(b.unit, b);
    const host = this.el.barks;
    const seen = new Set<number>();
    for (const [unit, b] of latest) {
      // Observation only: a hidden or dead speaker shows nothing.
      const t = cur.tanks.find((v) => v.id === unit && v.alive && v.team !== cur.team);
      const p = t && project(t.x, t.y, 64);
      if (!t || !p || !p.on) continue;
      seen.add(unit);
      const key = `${b.tick}|${b.text}`;
      let el = this.bubbles.get(unit);
      if (!el || el.dataset.k !== key) {
        el?.remove(); // a fresh element restarts the pop-in
        el = document.createElement('div');
        el.className = `bark ${b.tone}`;
        el.dataset.k = key;
        el.innerHTML = `<div class="box"><span class="who">${esc(b.from)}</span><span class="say">${esc(b.text)}</span></div>`;
        host.appendChild(el);
        this.bubbles.set(unit, el);
      }
      const left = BARK_TICKS - (tick - b.tick);
      el.style.opacity = String(Math.min(1, left / BARK_FADE));
      el.style.transform = `translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px)`;
    }
    for (const [unit, el] of this.bubbles)
      if (!seen.has(unit)) {
        el.remove();
        this.bubbles.delete(unit);
      }
  }
}
