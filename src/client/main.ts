// Entry point: DOM menus + Phaser game host for local solo play.
import Phaser from 'phaser';
import { GameScene, type GameSceneData } from './GameScene';
import { HudScene, newHudModel, type HudModel } from './hud';
import { InputManager } from './input';
import { AudioEngine } from './audio';
import { ACTION_LABELS, codeLabel, DEFAULT_BINDINGS, loadSettings, saveSettings, type Action, type Settings } from './settings';
import type { Observation } from '../sim/observation';
import type { LocalSession } from '../game/session';
import type { Difficulty } from '../ai/personality';
import { MissionSession, type Checkpoint } from '../game/mission/session';
import { MISSIONS, missionById } from '../content/missions';
import { MissionView3D } from './three/view';

const settings: Settings = loadSettings();
const input = new InputManager(settings);
const audio = new AudioEngine(settings);
const ui = document.getElementById('ui')!;
let hud: HudModel = newHudModel();
let inMatch = false;
let paused = false;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#0c1310',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, powerPreference: 'high-performance' },
  fps: { target: 240, smoothStep: false },
  scene: [],
});
game.scene.add('game', GameScene, false);
game.scene.add('hud', HudScene, false);
input.attach(document.body);
// Browsers only allow audio after a gesture: the first click anywhere starts the menu score.
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
document.addEventListener('keydown', () => audio.unlock(), { once: true });
(window as unknown as { __ironveil: unknown }).__ironveil = { game, hud: () => hud, settings, audio, mission: () => activeMission() };

/** The active 3D mission view, if a mission is running. */
let view3d: MissionView3D | null = null;
const view3dHost = document.createElement('div');
view3dHost.id = 'view3d-host';
document.body.insertBefore(view3dHost, ui);

function closeView3d(): void {
  view3d?.dispose();
  view3d = null;
  view3dHost.style.display = 'none';
  document.getElementById('game')!.style.visibility = '';
}

/** The running mission session (missions are always rendered by the 3D view). */
function activeMission(): MissionSession | null {
  return view3d?.session ?? null;
}

function gameScene(): GameScene | null {
  const s = game.scene.getScene('game') as GameScene | null;
  return s && game.scene.isActive('game') ? s : null;
}

// --------------------------------------------------------------- input actions
input.onAction = (a: Action) => {
  if (a === 'pause' && inMatch) {
    if (paused) closePause();
    else openPause();
  }
  if (a === 'telemetry') view3d?.toggleTelemetry();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') hud.showDebug = !hud.showDebug;
});
setInterval(() => {
  hud.showScoreboard = inMatch && input.isDown('scoreboard');
}, 30);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && inMatch && !paused) openPause();
});
window.addEventListener('blur', () => {
  if (inMatch && !paused) openPause();
});

// --------------------------------------------------------------- screens
function screen(html: string, dim = false): HTMLDivElement {
  ui.innerHTML = '';
  const d = document.createElement('div');
  d.className = `screen${dim ? ' dim' : ''}`;
  d.innerHTML = html;
  ui.appendChild(d);
  return d;
}

function clearUi(): void {
  ui.innerHTML = '';
}

function seg(name: string, options: [string, string][], value: string): string {
  return `<span class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</span>`;
}

function wireSeg(root: HTMLElement, name: string, onPick: (v: string) => void): void {
  const el = root.querySelector(`[data-seg="${name}"]`)!;
  el.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(b.dataset.v!);
      audio.click();
    }),
  );
}

function mainMenu(): void {
  inMatch = false;
  audio.setScene('menu');
  audio.setMood('menu');
  const m = MISSIONS[0]!.mission;
  const d = screen(`
    <div class="card">
      <h1>IRONVEIL</h1>
      <div class="tag">A tank crew, a divided city, and a long night</div>
      <div class="row"><label>Callsign</label><input type="text" id="name" maxlength="14" value="${escapeHtml(settings.playerName)}"></div>
      <div class="mission-card">
        <div class="eyebrow">Campaign · mission 0</div>
        <div class="mtitle">${escapeHtml(m.title)}</div>
        <div class="muted small">Stealth and combat through a checkpoint district, rendered in 3D.</div>
      </div>
      <div class="actions">
        <button class="primary" id="mission">Play mission</button>
        <button id="how">How to play</button>
        <button id="settings">Settings</button>
      </div>
      <details class="skirmish">
        <summary>Skirmish · team deathmatch (2D, original mode)</summary>
        <div class="row"><label>Difficulty</label>${seg('diff', [['easy', 'Recruit'], ['normal', 'Veteran'], ['hard', 'Ironclad']], settings.difficulty)}</div>
        <div class="row"><label>Team size</label>${seg('size', [['1', '1v1'], ['2', '2v2'], ['3', '3v3'], ['4', '4v4']], String(settings.teamSize))}</div>
        <div class="actions"><button id="deploy">Deploy</button><button id="train">Training</button></div>
        <div class="notice">Map: Relay Yard. You and your squad against tactical AI; first team to 15 kills wins.</div>
      </details>
    </div>`);
  wireSeg(d, 'diff', (v) => (settings.difficulty = v as Difficulty));
  wireSeg(d, 'size', (v) => (settings.teamSize = Number(v)));
  d.querySelector('#deploy')!.addEventListener('click', () => {
    lastTraining = false;
    settings.playerName = ((d.querySelector('#name') as HTMLInputElement).value.trim() || 'You').slice(0, 14);
    saveSettings(settings);
    startMatch();
  });
  d.querySelector('#train')!.addEventListener('click', () => {
    saveSettings(settings);
    startMatch(true);
  });
  d.querySelector('#mission')!.addEventListener('click', () => {
    settings.playerName = ((d.querySelector('#name') as HTMLInputElement).value.trim() || 'You').slice(0, 14);
    saveSettings(settings);
    missionBriefing(MISSIONS[0]!.mission.id);
  });
  d.querySelector('#how')!.addEventListener('click', () => howTo(mainMenu));
  d.querySelector('#settings')!.addEventListener('click', () => settingsScreen(mainMenu));
}

function howTo(back: () => void): void {
  const b = settings.bindings;
  const k = (a: Action) => b[a].map(codeLabel).join(' / ');
  const d = screen(`
    <div class="card">
      <h2>How to play</h2>
      <ul class="tips">
        <li><b>${k('up')}, ${k('left')}, ${k('down')}, ${k('right')}</b> — drive in that world direction immediately. The tank keeps its momentum: tap the opposite direction to brake, steer early to drift through corners.</li>
        <li><b>Mouse</b> aims; the turret traverses toward it (the gold ring shows where the barrel really points).</li>
        <li><b>Hold ${k('fire')}</b> to charge, <b>release</b> to fire. Taps are quick and deal steady damage; full charge hits hard and flies fast but slows you and is audible. At full charge you have 1.5 s before the cannon vents and the shot is lost. <b>${k('cancel')}</b> cancels.</li>
        <li><b>${k('smoke')}</b> drops a smoke cloud that blocks sight for everyone (not shells). 18 s cooldown.</li>
        <li><b>Hold ${k('silent')}</b> for silent running: slow and quiet. It doesn't make you invisible, and you still leave tracks in mud.</li>
        <li>Brush hides you beyond close range until you fire. Coloured arcs around your tank show what you <i>hear</i> but can't see: <span style="color:#ff5a3a">shots</span>, <span style="color:#ffd23a">charging</span>, <span style="color:#e8eef5">engines</span>.</li>
        <li>Fresh mud tracks are evidence, not a GPS: they don't say who made them or where they are now.</li>
        <li>Enemy bots investigate sounds, search where they lost you, flank, and fall back to reload. Break line of sight, change your angle, and come back from somewhere they don't expect.</li>
      </ul>
      <div class="actions"><button id="back">Back</button></div>
    </div>`);
  d.querySelector('#back')!.addEventListener('click', back);
}

function settingsScreen(back: () => void): void {
  const actions = Object.keys(ACTION_LABELS) as Action[];
  const d = screen(
    `
    <div class="card">
      <h2>Settings</h2>
      <div class="row"><label>Master volume</label><input type="range" min="0" max="1" step="0.05" id="master" value="${settings.master}"></div>
      <div class="row"><label>Effects volume</label><input type="range" min="0" max="1" step="0.05" id="sfx" value="${settings.sfx}"></div>
      <div class="row"><label>Music</label><input type="range" min="0" max="1" step="0.05" id="music" value="${settings.music}"></div>
      <div class="row"><label>Text size</label>${seg('text', [['0.85', 'Small'], ['1', 'Normal'], ['1.2', 'Large'], ['1.4', 'Huge']], String(settings.textScale))}</div>
      <div class="row"><label>Reduced motion</label>${seg('rm', [['0', 'Off'], ['1', 'On']], settings.reducedMotion ? '1' : '0')} <span class="muted small">no camera shake/kick, calmer smoke</span></div>
      <div class="row"><label>Effects quality</label>${seg('fx', [['0', 'High'], ['1', 'Low']], settings.lowEffects ? '1' : '0')} <span class="muted small">fewer particles & lights; never changes visibility</span></div>
      <div class="row"><label>Squad radio</label>${seg('radio', [['1', 'Shown'], ['0', 'Hidden']], settings.showRadio ? '1' : '0')}</div>
      <h2 style="margin-top:18px">Controls</h2>
      <div class="grid">${actions
        .map((a) => `<span>${ACTION_LABELS[a]}</span><span>${settings.bindings[a].map((c, i) => `<button class="bind" data-a="${a}" data-i="${i}">${codeLabel(c)}</button>`).join(' ')}</span>`)
        .join('')}</div>
      <div class="actions"><button id="reset">Reset controls</button><button id="back" class="primary">Done</button></div>
    </div>`,
    inMatch,
  );
  const range = (id: keyof Settings) =>
    d.querySelector(`#${id}`)!.addEventListener('input', (e) => {
      (settings[id] as number) = Number((e.target as HTMLInputElement).value);
      audio.applyVolumes();
    });
  range('master');
  range('sfx');
  range('music');
  wireSeg(d, 'text', (v) => (settings.textScale = Number(v)));
  wireSeg(d, 'rm', (v) => {
    settings.reducedMotion = v === '1';
    gameScene()?.applySettings();
  });
  wireSeg(d, 'fx', (v) => {
    settings.lowEffects = v === '1';
    gameScene()?.applySettings();
    view3d?.applySettings();
  });
  wireSeg(d, 'radio', (v) => (settings.showRadio = v === '1'));
  d.querySelectorAll<HTMLButtonElement>('button.bind').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.textContent = 'press…';
      input.captureNext = (code) => {
        const a = btn.dataset.a as Action;
        const i = Number(btn.dataset.i);
        if (code !== 'Escape') settings.bindings[a][i] = code;
        saveSettings(settings);
        settingsScreen(back);
      };
    }),
  );
  d.querySelector('#reset')!.addEventListener('click', () => {
    settings.bindings = structuredClone(DEFAULT_BINDINGS);
    saveSettings(settings);
    settingsScreen(back);
  });
  d.querySelector('#back')!.addEventListener('click', () => {
    saveSettings(settings);
    back();
  });
}

function openPause(): void {
  const gs = gameScene();
  if (!gs && !view3d) return;
  paused = true;
  input.releaseAll();
  if (view3d) view3d.setPaused(true);
  else gs!.setPaused(true);
  audio.setEngine(0, false, false);
  audio.setChargeHum(0);
  const d = screen(
    `<div class="card" style="width:min(420px,calc(100vw - 32px))">
      <h2>Paused</h2>
      <div class="actions" style="flex-direction:column">
        <button class="primary" id="resume">Resume</button>
        ${currentMission ? '<button id="retry">Retry from checkpoint</button><button id="restart">Restart mission</button>' : '<button id="restart">Restart match</button>'}
        <button id="set">Settings</button>
        <button id="how">How to play</button>
        <button id="quit">Quit to menu</button>
      </div></div>`,
    true,
  );
  d.querySelector('#resume')!.addEventListener('click', closePause);
  d.querySelector('#restart')!.addEventListener('click', () => {
    clearUi();
    paused = false;
    if (currentMission) startMission(currentMission);
    else startMatch();
  });
  d.querySelector('#retry')?.addEventListener('click', () => {
    clearUi();
    paused = false;
    startMission(currentMission!, activeMission()?.lastCheckpoint ?? undefined);
  });
  d.querySelector('#set')!.addEventListener('click', () => settingsScreen(openPause));
  d.querySelector('#how')!.addEventListener('click', () => howTo(openPause));
  d.querySelector('#quit')!.addEventListener('click', quitToMenu);
}

function closePause(): void {
  paused = false;
  clearUi();
  if (view3d) view3d.setPaused(false);
  else gameScene()?.setPaused(false);
}

function quitToMenu(): void {
  paused = false;
  currentMission = null;
  closeView3d();
  game.scene.stop('hud');
  game.scene.stop('game');
  mainMenu();
}

let lastTraining = false;
function startMatch(training = lastTraining): void {
  lastTraining = training;
  currentMission = null;
  closeView3d();
  audio.setScene('skirmish');
  audio.setMood('tension', 0.4);
  audio.unlock();
  hud = newHudModel();
  (window as unknown as { __ironveil: { hud: () => HudModel } }).__ironveil.hud = () => hud;
  clearUi();
  inMatch = true;
  paused = false;
  const data: GameSceneData = {
    cfg: { teamSize: settings.teamSize, difficulty: settings.difficulty, playerName: settings.playerName, training },
    settings,
    input,
    audio,
    hud,
    onEnd: showResults,
  };
  game.scene.stop('hud');
  game.scene.stop('game');
  game.scene.start('game', data);
  game.scene.start('hud', { model: hud, settings });
}

function showResults(obs: Observation, session: LocalSession): void {
  inMatch = false;
  const w = obs.match.winner;
  const title = w === 'draw' ? 'Draw' : w === obs.team ? 'Victory' : 'Defeat';
  const me = session.world.tank(session.playerId);
  const acc = me.shotsFired ? Math.round((100 * me.shotsHit) / me.shotsFired) : 0;
  const rows = [...obs.scoreboard]
    .sort((a, b) => a.team - b.team || b.kills - a.kills)
    .map((r) => `<tr><td class="t${r.team}">${escapeHtml(r.name)}${r.isBot ? '' : ' (you)'}</td><td>${r.isBot ? session.botInfo(r.id)?.persona ?? '' : '—'}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`)
    .join('');
  const d = screen(
    `<div class="card">
      <h2>${title} · <span class="t0">${obs.match.scores[0]}</span> – <span class="t1">${obs.match.scores[1]}</span></h2>
      <div class="muted">Your accuracy ${acc}% (${me.shotsHit}/${me.shotsFired} shots) · damage dealt ${me.damageDealt}</div>
      <table class="res"><tr><th>Tank</th><th>Temperament</th><th>K</th><th>D</th></tr>${rows}</table>
      <div class="actions"><button class="primary" id="again">Play again</button><button id="menu">Menu</button></div>
    </div>`,
    true,
  );
  d.querySelector('#again')!.addEventListener('click', () => startMatch(false));
  d.querySelector('#menu')!.addEventListener('click', quitToMenu);
}

// --------------------------------------------------------------- missions
let currentMission: string | null = null;

function missionBriefing(id: string): void {
  const m = MISSIONS.find((x) => x.mission.id === id)!.mission;
  const d = screen(`
    <div class="card">
      <h2>${escapeHtml(m.title)}</h2>
      <p class="brief">${escapeHtml(m.briefing ?? '')}</p>
      <ul class="tips">
        <li>Enemies have a <b>suspicion meter</b>: being seen fills it, faster up close. Firing or getting within point-blank range fills it at once. Break line of sight and it drains.</li>
        <li>Your crew talks on the radio in real time. When a <b>decision</b> comes up, press <b>1</b>, <b>2</b> or <b>3</b> before the timer runs out, or the commander decides.</li>
        <li>If you're destroyed you can retry from the last <b>checkpoint</b>.</li>
      </ul>
      <div class="actions"><button class="primary" id="go">Begin</button><button id="back">Back</button></div>
    </div>`);
  d.querySelector('#go')!.addEventListener('click', () => startMission(id));
  d.querySelector('#back')!.addEventListener('click', mainMenu);
}

function startMission(id: string, checkpoint?: Checkpoint): void {
  audio.unlock();
  clearUi();
  inMatch = true;
  paused = false;
  currentMission = id;
  game.scene.stop('hud');
  game.scene.stop('game');
  closeView3d();
  const entry = missionById(id)!;
  const session = new MissionSession({ ...entry, seed: (Date.now() & 0xffff) + 1 });
  if (checkpoint) session.loadCheckpoint(checkpoint);
  document.getElementById('game')!.style.visibility = 'hidden';
  view3dHost.style.display = 'block';
  view3d = new MissionView3D(view3dHost, {
    session,
    input,
    audio,
    settings,
    onEnd: (s) => {
      inMatch = false;
      missionResults(s);
    },
  });
}

function missionResults(s: MissionSession): void {
  const o = s.outcome;
  const ok = o?.result === 'success';
  const objectives = s
    .objectives()
    .map((x) => `<li class="obj ${x.state}">${x.state === 'complete' ? '✔' : x.state === 'failed' ? '✖' : '•'} ${escapeHtml(x.text)}</li>`)
    .join('');
  const d = screen(
    `<div class="card">
      <h2>${ok ? 'Mission complete' : 'Mission failed'}</h2>
      <p class="brief">${escapeHtml(o?.text ?? '')}</p>
      <ul class="objlist">${objectives}</ul>
      <div class="actions">
        ${ok ? '' : '<button class="primary" id="retry">Retry from checkpoint</button>'}
        <button ${ok ? 'class="primary"' : ''} id="restart">Restart mission</button>
        <button id="menu">Menu</button>
      </div>
    </div>`,
    true,
  );
  const cp = s.lastCheckpoint ?? undefined;
  d.querySelector('#retry')?.addEventListener('click', () => startMission(s.def.id, cp));
  d.querySelector('#restart')!.addEventListener('click', () => startMission(s.def.id));
  d.querySelector('#menu')!.addEventListener('click', quitToMenu);
}

// Decisions: number keys answer the active mission choice.
window.addEventListener('keydown', (e) => {
  const ms = activeMission();
  if (!ms || !ms.choice || paused) return;
  const n = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
  if (n >= 0) {
    ms.choose(n % 3);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

mainMenu();
