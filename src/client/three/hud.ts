// In-game HUD for the 3D mission view. Design: no boxed panels. Text floats over the scene on
// soft edge scrims, like subtitles and instrument markings, and the cannon state lives on the
// cursor, where the player is already looking.
//
//   top-left      operation title + objectives (completed ones fold away)
//   top-centre    detection: a slim meter that is nearly invisible while you are hidden
//   top-right     minimap (owned by the view)
//   bottom-left   radio as subtitles, then a slim hull gauge with smoke / silent / brush chips
//   bottom-right  real-time decisions
//   cursor        reload / charge / hold ring
//   over enemies  ? with a suspicion arc, ! in combat, ◆ for a boss
import type { MissionSession } from '../../game/mission/session';
import type { Observation, TankView } from '../../sim/observation';
import { WEAPON_TICKS } from '../../sim/weapon';

const ICON = {
  smoke: '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 7 18z"/></svg>',
  silent: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6" fill="none"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M12 21c0-6 0-9-5-13 6 0 9 3 10 7 1-4 3-6 5-7-2 3-4 7-5 13z"/></svg>',
};

const RING = 2 * Math.PI * 17;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class Hud3D {
  readonly root: HTMLDivElement;
  private q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
  private objKey = '';
  private radioKey = '';
  private toastKey = '';
  private choiceKey = '';
  private markerKey = '';
  private hint = 0;
  private hullSegs: HTMLElement[] = [];

  constructor(host: HTMLElement, private session: MissionSession) {
    this.root = document.createElement('div');
    this.root.className = 'h3';
    this.root.innerHTML = `
      <div class="h3-scrim tl"></div><div class="h3-scrim bl"></div>
      <section class="h3-obj"><div class="h3-op">Operation</div><div class="h3-title"></div><ul></ul></section>
      <section class="h3-det"><div class="lbl">Hidden</div><div class="track"><i></i></div></section>
      <section class="h3-toasts"></section>
      <section class="h3-radio"></section>
      <section class="h3-status">
        <div class="hull"><span class="cap">Hull</span><div class="segs">${'<b></b>'.repeat(10)}</div><span class="num">100</span></div>
        <div class="chips">
          <span class="chip smoke">${ICON.smoke}<em>Q</em></span>
          <span class="chip silent">${ICON.silent}<em>Silent</em></span>
          <span class="chip brush">${ICON.brush}<em>Concealed</em></span>
        </div>
      </section>
      <section class="h3-choice"></section>
      <section class="h3-markers"></section>
      <div class="h3-cursor"><svg viewBox="-24 -24 48 48">
        <circle class="trk" r="17"/><circle class="arc" r="17" transform="rotate(-90)"/>
        <path class="tick" d="M0 -23v4M0 19v4M-23 0h4M19 0h4"/><circle class="dot" r="1.6"/></svg></div>
      <div class="h3-lost">Tank lost</div>
      <div class="h3-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</span><span><kbd>Mouse</kbd> aim</span><span><kbd>Space</kbd> hold to charge · release to fire</span><span><kbd>Q</kbd> smoke</span><span><kbd>Shift</kbd> silent</span><span><kbd>Wheel</kbd> zoom</span></div>`;
    host.appendChild(this.root);
    this.q<HTMLElement>('.h3-title').textContent = session.def.title.replace(/^Grey Box:\s*/i, '');
    this.hullSegs = [...this.root.querySelectorAll<HTMLElement>('.hull .segs b')];
    (this.q<SVGCircleElement>('.arc') as SVGCircleElement).style.strokeDasharray = `${RING}`;
  }

  dispose(): void {
    this.root.remove();
  }

  update(cur: Observation, me: TankView | undefined, mouse: { x: number; y: number }, project: (x: number, y: number, h: number) => { x: number; y: number; on: boolean }, dt: number): void {
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
    const detEl = this.q<HTMLElement>('.h3-det');
    if (detEl.dataset.s !== state) {
      detEl.dataset.s = state;
      this.q('.h3-det .lbl').textContent = { hidden: 'Hidden', suspicious: 'Suspicious', alert: 'Alert', spotted: 'Spotted' }[state];
    }
    this.q<HTMLElement>('.h3-det .track i').style.transform = `scaleX(${det.toFixed(3)})`;

    // ---- toasts (checkpoint, objective changes)
    const toasts = s.notices.filter((n) => tick - n.tick < 30 * 3.5);
    const tk = toasts.map((n) => n.tick + n.text).join('|');
    if (tk !== this.toastKey) {
      this.toastKey = tk;
      this.q('.h3-toasts').innerHTML = toasts.map((n) => `<div class="toast">${esc(n.text)}</div>`).join('');
    }

    // ---- radio as subtitles
    const lines = s.radio.filter((r) => tick - r.tick < 30 * 8).slice(-4);
    const rk = lines.map((r) => r.tick + r.from + r.text).join('|');
    if (rk !== this.radioKey) {
      this.radioKey = rk;
      this.q('.h3-radio').innerHTML = lines
        .map((r) => {
          const enemy = r.from.endsWith('(enemy)');
          return enemy
            ? `<p class="int" data-t="${r.tick}"><span class="who">Intercept · ${esc(r.from.replace(' (enemy)', ''))}</span>${esc(r.text)}</p>`
            : `<p class="crew" data-t="${r.tick}"><span class="who">${esc(r.from)}</span>${esc(r.text)}</p>`;
        })
        .join('');
    }
    this.root.querySelectorAll<HTMLElement>('.h3-radio p').forEach((p) => {
      const age = (tick - Number(p.dataset.t)) / 30;
      p.style.opacity = String(age > 7 ? Math.max(0, 1 - (age - 7)) : 1);
    });

    // ---- vehicle status
    const status = this.q<HTMLElement>('.h3-status');
    this.root.classList.toggle('dead', !me);
    if (me) {
      const hp = Math.max(0, me.hp);
      this.hullSegs.forEach((b, i) => b.classList.toggle('on', hp > i * 10));
      this.q('.hull .num').textContent = String(Math.ceil(hp));
      status.classList.toggle('low', hp <= 30);
      const smokeLeft = Math.max(0, (me.smokeReadyTick - tick) / 30);
      const sm = this.q<HTMLElement>('.chip.smoke');
      sm.classList.toggle('ready', smokeLeft <= 0);
      sm.querySelector('em')!.textContent = smokeLeft > 0 ? `${Math.ceil(smokeLeft)}s` : 'Q';
      this.q<HTMLElement>('.chip.silent').classList.toggle('on', me.quiet);
      this.q<HTMLElement>('.chip.brush').classList.toggle('on', me.inBrush);
    }

    // ---- cursor: cannon ring
    const cur$ = this.q<HTMLElement>('.h3-cursor');
    cur$.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
    if (me) {
      let frac = 1;
      let mode = 'ready';
      if (me.phase === 'charging') {
        frac = me.charge;
        mode = me.hold !== null ? (me.hold < WEAPON_TICKS.hold * 0.35 ? 'venting' : 'hold') : 'charging';
      } else if (me.phase === 'reloading') {
        frac = 1 - me.weaponTimer / WEAPON_TICKS.reload;
        mode = 'reload';
      } else if (me.phase === 'vent' || me.phase === 'cancel') {
        frac = 1 - me.weaponTimer / (me.phase === 'vent' ? WEAPON_TICKS.vent : WEAPON_TICKS.cancel);
        mode = me.phase === 'vent' ? 'vented' : 'reload';
      }
      cur$.dataset.m = mode;
      (cur$.querySelector('.arc') as SVGCircleElement).style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, frac))));
    }

    // ---- decisions
    const c = s.choice;
    const ck = c ? c.prompt + c.startedTick : '';
    const choice = this.q<HTMLElement>('.h3-choice');
    if (ck !== this.choiceKey) {
      this.choiceKey = ck;
      choice.classList.toggle('show', !!c);
      if (c)
        choice.innerHTML = `<div class="timer"><i></i></div>
          <div class="who">${esc(c.from ?? 'Crew')} · Decision</div>
          <div class="prompt">${esc(c.prompt)}</div>
          ${c.options.map((o, i) => `<div class="opt${i === c.defaultIndex ? ' def' : ''}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></div>`).join('')}`;
    }
    if (c) {
      const left = Math.max(0, (c.expiresTick - tick) / (c.expiresTick - c.startedTick));
      choice.querySelector<HTMLElement>('.timer i')!.style.transform = `scaleX(${left.toFixed(3)})`;
      choice.classList.toggle('urgent', left < 0.25);
    }

    // ---- markers over visible enemies
    let mk = '';
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
      if (!glyph) continue;
      const arc = cls === 'sus' ? `<svg viewBox="-14 -14 28 28"><circle r="11" class="t"/><circle r="11" class="a" transform="rotate(-90)" style="stroke-dasharray:${(2 * Math.PI * 11).toFixed(1)};stroke-dashoffset:${(2 * Math.PI * 11 * (1 - sus)).toFixed(1)}"/></svg>` : '';
      mk += `<div class="mk ${cls}" style="transform:translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px)">${arc}<span>${glyph}</span></div>`;
    }
    if (mk !== this.markerKey) {
      this.markerKey = mk;
      this.q('.h3-markers').innerHTML = mk;
    }

    // ---- first-seconds hint
    this.hint += dt;
    this.q<HTMLElement>('.h3-hint').style.opacity = String(this.hint < 12 ? 1 : Math.max(0, 1 - (this.hint - 12) / 1.5));
  }
}
