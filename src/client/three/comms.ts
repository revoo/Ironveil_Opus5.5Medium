// The comms panel: crew radio as a dialogue box at the bottom centre of the 3D view, in a heavy
// Cold-War Berlin style (concrete, stencil, signal red, halftone portraits).
//
// It owns the radio queue. Lines play one at a time; each is planned once (`planUtterance`), the
// sound is started through `onAir`, and the panel follows the same plan: the subtitle is revealed
// letter by letter as it is "spoken", the portrait's mouth opens on vowels and the level meter
// tracks the voice. A busy channel speaks faster. Between lines the panel folds into a slim
// receiver strip whose lamp flickers when other units are talking on the net.
import { levelAt, mouthAt, planUtterance, revealAt, voiceFor, type Utterance, type VoiceProfile } from '../sound/voice';
import { portraitSvg, speaker } from './portraits';

export interface CommsLine {
  from: string;
  text: string;
  enemy: boolean;
}

interface Live {
  line: CommsLine;
  u: Utterance;
  t: number;
}

const LOG_LINES = 2;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A tile of film grain, generated once and shared by every panel. */
let grain: string | null = null;
function grainUrl(): string {
  if (grain !== null) return grain;
  grain = '';
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    if (g) {
      const img = g.createImageData(96, 96);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grain = cv.toDataURL('image/png');
    }
  } catch {
    grain = '';
  }
  return grain;
}

export class Comms {
  readonly el: HTMLElement;
  private q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
  private queue: CommsLine[] = [];
  private live: Live | null = null;
  private hold = 0;
  private log: { tag: string; text: string; enemy: boolean }[] = [];
  private shown = -1;
  private mouth = 0;
  private mouthState = -1;
  private level = 0;
  private levelQ = -1;
  private face = '';
  private traffic = 0;
  private trafficOn = false;
  private clockShown = '';

  constructor(
    host: HTMLElement,
    private onAir: (line: CommsLine, u: Utterance, voice: VoiceProfile) => void,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'cm';
    this.el.dataset.state = 'idle';
    this.el.innerHTML = `
      <div class="cm-log"></div>
      <div class="cm-box">
        <div class="cm-face"><div class="cm-pt"></div><i class="cm-grain"></i><i class="cm-scan"></i><b class="cm-stamp">Abgehört</b>
          <i class="cm-reg a"></i><i class="cm-reg b"></i></div>
        <div class="cm-body">
          <header><b class="cm-tag"></b><span class="cm-who"><span class="cm-name"></span><small class="cm-role"></small></span>
            <span class="cm-net">Funk&nbsp;K-04 · 41.250</span><span class="cm-vu"><i></i></span></header>
          <p class="cm-text"><span class="said"></span><i class="caret"></i><span class="rest"></span></p>
          <footer><span class="cm-air"><i></i>Sendung <em>0:00</em></span><span class="cm-next"></span></footer>
        </div>
      </div>
      <div class="cm-idle"><i class="lamp"></i><span>Funk K-04</span><b>Empfang</b></div>`;
    const url = grainUrl();
    if (url) this.el.style.setProperty('--grain', `url(${url})`);
    host.appendChild(this.el);
  }

  dispose(): void {
    this.el.remove();
  }

  /** Hide the panel (the "Squad radio: Hidden" setting); the voices still play. */
  setVisible(v: boolean): void {
    this.el.classList.toggle('off', !v);
  }

  push(line: CommsLine): void {
    this.queue.push(line);
  }

  /** Nothing on air and nothing waiting. */
  get idle(): boolean {
    return !this.live && this.queue.length === 0 && this.hold <= 0;
  }

  /** Another unit is talking on the net for `sec` seconds: the receiver lamp flickers. */
  netTraffic(sec: number): void {
    this.traffic = Math.max(this.traffic, sec);
  }

  update(dt: number, paused: boolean): void {
    if (paused) return;
    dt = Math.min(dt, 0.1);
    if (this.traffic > 0) this.traffic -= dt;
    const tr = this.traffic > 0;
    if (tr !== this.trafficOn) {
      this.trafficOn = tr;
      this.el.classList.toggle('traffic', tr);
    }

    if (this.live) {
      const L = this.live;
      L.t += dt;
      if (L.t >= L.u.dur) {
        this.finish();
      } else {
        this.follow(L);
        return;
      }
    }
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold > 0) return;
      this.retire();
    }
    if (this.queue.length) this.start(this.queue.shift()!);
    else if (this.el.dataset.state !== 'idle') this.el.dataset.state = 'idle';
  }

  private start(line: CommsLine): void {
    // a busy channel talks faster
    const speed = this.queue.length >= 3 ? 1.45 : this.queue.length >= 1 ? 1.2 : 1;
    const voice = voiceFor(line.from);
    const u = planUtterance(line.text, voice, speed);
    this.live = { line, u, t: 0 };
    const who = speaker(line.from, line.enemy);
    const el = this.el;
    el.dataset.state = 'live';
    el.classList.toggle('enemy', line.enemy);
    el.classList.toggle('urgent', /!/.test(line.text));
    const faceKey = line.enemy ? '#enemy' : line.from;
    if (faceKey !== this.face) {
      this.face = faceKey;
      this.q('.cm-pt').innerHTML = portraitSvg(line.from, line.enemy);
    }
    this.q('.cm-tag').textContent = who.tag;
    this.q('.cm-name').textContent = who.name;
    this.q('.cm-role').textContent = who.role;
    this.q('.cm-net').textContent = line.enemy ? 'Fremd · 38.900' : 'Funk K-04 · 41.250';
    this.q('.cm-text .said').textContent = '';
    this.q('.cm-text .rest').textContent = line.text;
    this.shown = 0;
    this.clockShown = '';
    this.renderNext();
    // the key-up: a burst of interference over the picture
    const face = this.q<HTMLElement>('.cm-face');
    face.classList.remove('key');
    void face.offsetWidth;
    face.classList.add('key');
    this.onAir(line, u, voice);
  }

  /** Follow the voice: reveal, mouth, meter, transmission clock. */
  private follow(L: Live): void {
    const n = revealAt(L.u, L.t);
    if (n !== this.shown) {
      this.shown = n;
      this.q('.cm-text .said').textContent = L.line.text.slice(0, n);
      this.q('.cm-text .rest').textContent = L.line.text.slice(n);
    }
    const m = mouthAt(L.u, L.t);
    this.mouth += (m - this.mouth) * Math.min(1, 0.45);
    const ms = this.mouth > 0.55 ? 2 : this.mouth > 0.2 ? 1 : 0;
    if (ms !== this.mouthState) {
      this.mouthState = ms;
      this.q<HTMLElement>('.cm-face').dataset.m = String(ms);
    }
    const lv = levelAt(L.u, L.t);
    this.level = Math.max(lv, this.level * 0.82);
    const lq = Math.round(this.level * 10);
    if (lq !== this.levelQ) {
      this.levelQ = lq;
      this.q<HTMLElement>('.cm-vu i').style.clipPath = `inset(0 ${100 - lq * 10}% 0 0)`;
    }
    const clock = `0:${String(Math.floor(L.t)).padStart(2, '0')}`;
    if (clock !== this.clockShown) {
      this.clockShown = clock;
      this.q('.cm-air em').textContent = clock;
    }
  }

  private finish(): void {
    const L = this.live!;
    this.live = null;
    this.q('.cm-text .said').textContent = L.line.text;
    this.q('.cm-text .rest').textContent = '';
    this.q<HTMLElement>('.cm-face').dataset.m = '0';
    this.mouthState = 0;
    this.mouth = 0;
    this.level = 0;
    this.levelQ = 0;
    this.q<HTMLElement>('.cm-vu i').style.clipPath = 'inset(0 100% 0 0)';
    this.el.dataset.state = 'hold';
    // time to finish reading; short when the next line is waiting
    this.hold = this.queue.length ? 0.45 : Math.min(3.2, 1.3 + L.line.text.length * 0.012);
    this.renderNext();
    const who = speaker(L.line.from, L.line.enemy);
    this.log.push({ tag: who.tag, text: L.line.text, enemy: L.line.enemy });
    if (this.log.length > LOG_LINES + 1) this.log.shift();
  }

  /** The finished line moves up into the log. */
  private retire(): void {
    this.hold = 0;
    // the log shows the lines before the current one
    const prev = this.queue.length ? this.log : [];
    this.q('.cm-log').innerHTML = prev
      .slice(-LOG_LINES)
      .map((l) => `<p class="${l.enemy ? 'int' : ''}"><b>${esc(l.tag)}</b>${esc(l.text)}</p>`)
      .join('');
  }

  private renderNext(): void {
    const n = this.queue.length;
    this.q('.cm-next').innerHTML = n ? `<b>▼</b> ${n} wartet` : '';
  }
}
