// Persistent per-player settings (localStorage, guarded — the game works without it).
import type { Difficulty } from '../ai/personality';

export type Action = 'up' | 'down' | 'left' | 'right' | 'fire' | 'cancel' | 'smoke' | 'silent' | 'scoreboard' | 'pause';

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  fire: 'Charge / fire (hold, release)',
  cancel: 'Cancel charge',
  smoke: 'Deploy smoke',
  silent: 'Silent running (hold)',
  scoreboard: 'Scoreboard (hold)',
  pause: 'Pause / menu',
};

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  reducedMotion: boolean;
  lowEffects: boolean;
  textScale: number;
  showRadio: boolean;
  difficulty: Difficulty;
  teamSize: number;
  playerName: string;
  bindings: Record<Action, string[]>;
}

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Space', 'Mouse0'],
  cancel: ['Mouse2', 'KeyE'],
  smoke: ['KeyQ'],
  silent: ['ShiftLeft', 'ShiftRight'],
  scoreboard: ['Tab'],
  pause: ['Escape', 'KeyP'],
};

const KEY = 'ironveil.settings.v1';

export function defaultSettings(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    master: 0.8,
    sfx: 0.9,
    music: 0.4,
    reducedMotion: reduce,
    lowEffects: false,
    textScale: 1,
    showRadio: true,
    difficulty: 'normal',
    teamSize: 2,
    playerName: 'You',
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, bindings: { ...d.bindings, ...(s.bindings ?? {}) } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export function codeLabel(code: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + '↑'.slice(0, 0);
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'Space') return 'Space';
  return code;
}
