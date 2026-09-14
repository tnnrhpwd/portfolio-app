/**
 * Rocket — player settings.
 *
 * `reducedMotion` is seeded from the OS preference on first run and then owned
 * by the player, so choosing "full motion" in-game sticks even if the OS says
 * otherwise (and vice versa).
 */

const STORAGE_KEY = 'rocket.settings.v1';

export interface GameSettings {
  muted: boolean;
  /** Play the music tracks. `muted` is the master switch for everything. */
  music: boolean;
  reducedMotion: boolean;
  /** Draw the parallax backdrop. Off is cheaper on low-end phones. */
  parallax: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): GameSettings {
  return { muted: false, music: true, reducedMotion: prefersReducedMotion(), parallax: true };
}

let cached: GameSettings | null = null;

export function loadSettings(): GameSettings {
  if (cached) return cached;
  const fallback = defaultSettings();
  if (typeof localStorage === 'undefined') return (cached = fallback);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = fallback);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    cached = {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : fallback.muted,
      music: typeof parsed.music === 'boolean' ? parsed.music : fallback.music,
      reducedMotion:
        typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : fallback.reducedMotion,
      parallax: typeof parsed.parallax === 'boolean' ? parsed.parallax : fallback.parallax,
    };
  } catch {
    cached = fallback;
  }
  return cached;
}

export function persistSettings(settings: GameSettings): void {
  cached = settings;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* non-fatal */
  }
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next = { ...loadSettings(), ...patch };
  persistSettings(next);
  return next;
}
