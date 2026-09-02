export interface GameSettings {
  /** Global text scale (0.85 small, 1 normal, 1.2 large). */
  textScale: number;
  highContrast: boolean;
  reducedMotion: boolean;
  muted: boolean;
}

const KEY = 'colosseum.settings.v1';

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const DEFAULTS: GameSettings = {
  textScale: 1,
  highContrast: false,
  reducedMotion: detectReducedMotion(),
  muted: false,
};

function load(): GameSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings: GameSettings = load();

export function getSettings(): GameSettings {
  return settings;
}

export function setSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]): GameSettings {
  settings = { ...settings, [key]: value };
  persist();
  return settings;
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable — settings still apply in memory.
  }
}
