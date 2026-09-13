/**
 * Rocket — profile-backed progress and the public leaderboard.
 *
 * Both features reuse the app's ONE generic, schema-less data API rather than
 * adding backend code, exactly like the 2048 page does (see the storage notes at
 * the top of `Projects/Game2048/Game2048.jsx`). Two different endpoints:
 *
 *   Progress (private, auth'd) — `/api/data`
 *     POST   { text: "RocketSave|<json>" }   the backend prepends "Creator:<id>|"
 *     GET    ?data={"text":"RocketSave"}     returns only the caller's own rows
 *     DELETE /:id                            used to keep ONE row per user
 *
 *   Leaderboard (public, no auth) — `/api/data/public`
 *     POST   { text: "RocketLeaderboard|Public:true|..." }
 *     GET    ?data={"text":"RocketLeaderboard"}   scan by "contains"
 *
 * Two traps worth remembering, both documented in the sibling games:
 *
 *   1. Rows come back with the text in `data` and the id in `_id` — NOT
 *      `text`/`id`. Reading the wrong fields silently filters every row away (so
 *      saves never load) and makes the delete a no-op (so every write duplicates).
 *   2. `PUT /api/data/:id` is coupled to unrelated payment-method gating. Never
 *      use it: write a fresh row and delete the old ones.
 *
 * Everything here is best-effort. Rocket is offline-first — a signed-out player,
 * a dead backend or a bad response all degrade to local-only play, and nothing in
 * this file throws into the game.
 */

import { loadSave, migrate, persistSave, type SaveData } from './save';

const BASE = '/api/data';
const SAVE_MARKER = 'RocketSave';
const LEADERBOARD_MARKER = 'RocketLeaderboard';
const MAX_ROWS = 60;
export const LEADERBOARD_SIZE = 10;

export interface AuthUser {
  _id: string;
  token: string;
  nickname?: string;
  email?: string;
}

/** The app stores the logged-in user (and JWT) in localStorage under `user`. */
export function readUser(): AuthUser | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    return parsed && parsed._id && parsed.token ? (parsed as AuthUser) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return readUser() !== null;
}

/** Display name for the board: the app's nickname, trimmed and de-delimited. */
export function displayName(): string {
  const user = readUser();
  return sanitizeName(user?.nickname || user?.email?.split('@')[0] || '');
}

/** Strip the delimiters the text format uses and cap the length. */
export function sanitizeName(name: string): string {
  const cleaned = String(name ?? '')
    .replace(/[|:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return cleaned || 'Anonymous';
}

// ─── text format ────────────────────────────────────────────────────────────

/** `Key: value` pairs separated by `|`, the house convention for stored rows. */
export function parseDelimitedFields(text: string): Record<string, string | true> {
  const fields: Record<string, string | true> = {};
  for (const part of String(text ?? '').split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) {
      if (part.trim()) fields[part.trim()] = true;
      continue;
    }
    // Rejoin the rest rather than truncating: ISO timestamps contain colons.
    fields[part.slice(0, idx).trim()] = part.slice(idx + 1);
  }
  return fields;
}

/**
 * The stored row for a save. The payload is JSON (an upgrade map and a ship list
 * are not flat values) but the marker and `Public:false` tag stay in the flat
 * prefix so the same row is greppable and impossible to confuse with a
 * leaderboard entry.
 */
export function formatSaveText(save: SaveData): string {
  const payload = {
    updatedAt: save.updatedAt,
    bestScore: save.bestScore,
    bestWave: save.bestWave,
    coins: save.coins,
    levels: save.levels,
    unlockedShips: save.unlockedShips,
    ship: save.ship,
    runs: save.runs,
    kills: save.kills,
    submittedWave: save.submittedWave,
  };
  return `${SAVE_MARKER}|${JSON.stringify(payload)}`;
}

/**
 * Pull a save out of a stored row. The row carries a `Creator:<id>|` prefix, so
 * the marker is located rather than assumed to be at the start.
 */
export function parseSaveText(text: string): SaveData | null {
  const idx = String(text ?? '').indexOf(SAVE_MARKER);
  if (idx === -1) return null;
  const rest = String(text).slice(idx + SAVE_MARKER.length).replace(/^\|/, '');
  if (!rest) return null;
  try {
    return migrate(JSON.parse(rest));
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  wave: number;
  score: number;
  name: string;
  at: string;
  userId: string;
  rank?: number;
}

export function formatLeaderboardText(entry: {
  wave: number;
  score: number;
  name: string;
  userId: string;
}): string {
  return [
    LEADERBOARD_MARKER,
    'Public:true',
    `Wave:${entry.wave}`,
    `Score:${entry.score}`,
    `Name:${sanitizeName(entry.name)}`,
    `At:${new Date().toISOString()}`,
    `UserId:${entry.userId}`,
  ].join('|');
}

/** Parse one public row. Returns null for anything that is not a valid entry. */
export function parseLeaderboardRow(row: { data?: string; _id?: string }): LeaderboardEntry | null {
  const text = row?.data;
  if (typeof text !== 'string' || !text.includes(LEADERBOARD_MARKER)) return null;
  const fields = parseDelimitedFields(text.slice(text.indexOf(LEADERBOARD_MARKER)));
  const wave = parseInt(String(fields.Wave ?? ''), 10);
  if (!Number.isFinite(wave) || wave < 1) return null;
  const score = parseInt(String(fields.Score ?? ''), 10);
  return {
    wave,
    score: Number.isFinite(score) ? score : 0,
    name: sanitizeName(String(fields.Name ?? '')),
    at: typeof fields.At === 'string' ? fields.At : '',
    userId: typeof fields.UserId === 'string' ? fields.UserId : '',
  };
}

/**
 * Best-first ranking: farthest wave wins, then the higher score, then whoever got
 * there first. One row per player — a single strong player should not fill the
 * board with their own history.
 */
export function rankLeaderboard(entries: LeaderboardEntry[], limit = LEADERBOARD_SIZE): { top: LeaderboardEntry[]; total: number } {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = entry.userId || `anon:${entry.name}`;
    const current = best.get(key);
    if (!current || entry.wave > current.wave || (entry.wave === current.wave && entry.score > current.score)) {
      best.set(key, entry);
    }
  }
  const ranked = [...best.values()].sort(
    (a, b) => b.wave - a.wave || b.score - a.score || String(a.at).localeCompare(String(b.at)),
  );
  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  return { top: ranked.slice(0, limit), total: ranked.length };
}

/** Where `bestWave` sits on the board, or null when it does not make the cut. */
export function findRank(entries: LeaderboardEntry[], userId: string): LeaderboardEntry | null {
  return entries.find((entry) => entry.userId && entry.userId === userId) ?? null;
}

// ─── transport ──────────────────────────────────────────────────────────────

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const user = readUser();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (user) headers.Authorization = `Bearer ${user.token}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function fetchOwnRows(marker: string): Promise<Array<{ _id?: string; data?: string }>> {
  const res = await request(`?data=${encodeURIComponent(JSON.stringify({ text: marker }))}`);
  // Throwing (rather than returning []) is what keeps a failed READ from turning
  // into a destructive WRITE: "no rows" and "could not ask" must not look alike,
  // or a transient error would push this device's stale save over a good one.
  if (!res.ok) throw new Error(`cloud read failed: ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ _id?: string; data?: string }> };
  return (json.data ?? []).filter((row) => (row.data ?? '').includes(marker));
}

// ─── cloud status (for the menu to display) ─────────────────────────────────

export type CloudState = 'signed-out' | 'idle' | 'syncing' | 'synced' | 'offline';

let state: CloudState = 'idle';
let changedAt = 0;

const listeners = new Set<() => void>();

/**
 * Subscribe to status changes. The menu shows before the boot sync finishes (so a
 * slow network never delays play), which means it needs a nudge to redraw once the
 * merged save and the status are known.
 */
export function onCloudChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: CloudState): void {
  state = next;
  changedAt = Date.now();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a scene mid-teardown is not a cloud failure */
    }
  }
}

export function cloudStatus(): { state: CloudState; at: number } {
  return { state, at: changedAt };
}

export function cloudStateLabel(): string {
  switch (state) {
    case 'signed-out':
      return 'Playing as a guest — progress stays on this device';
    case 'syncing':
      return 'Syncing your progress…';
    case 'synced':
      return 'Progress saved to your profile';
    case 'offline':
      return 'Could not reach your profile — saved on this device';
    default:
      return '';
  }
}

// ─── progress sync ──────────────────────────────────────────────────────────

/** The profile's saved progress, or null when signed out / unreachable / empty. */
export async function cloudLoadSave(): Promise<SaveData | null> {
  const user = readUser();
  if (!user) {
    setState('signed-out');
    return null;
  }
  try {
    const rows = await fetchOwnRows(SAVE_MARKER);
    let newest: SaveData | null = null;
    for (const row of rows) {
      const parsed = parseSaveText(row.data ?? '');
      if (parsed && (!newest || parsed.updatedAt > newest.updatedAt)) newest = parsed;
    }
    return newest;
  } catch {
    setState('offline');
    return null;
  }
}

/** Replace the profile's single save row with `save`. */
export async function cloudPushSave(save: SaveData): Promise<boolean> {
  if (!readUser()) {
    setState('signed-out');
    return false;
  }
  setState('syncing');
  try {
    const rows = await fetchOwnRows(SAVE_MARKER);
    await Promise.all(
      rows.map((row) => (row._id ? request(`/${row._id}`, { method: 'DELETE' }) : Promise.resolve())),
    );
    const res = await request('', { method: 'POST', body: JSON.stringify({ text: formatSaveText(save) }) });
    setState(res.ok ? 'synced' : 'offline');
    return res.ok;
  } catch {
    setState('offline');
    return false;
  }
}

/**
 * Adopt the profile's progress into local storage and return the merged save.
 *
 * Called once per boot. Merge rules live in `save.ts` (`mergeSaves`) so they stay
 * pure and unit-tested; this function only does I/O and the write-back.
 */
export async function syncProgressToLocal(local: SaveData): Promise<SaveData> {
  if (!readUser()) {
    setState('signed-out');
    return local;
  }
  const cloud = await cloudLoadSave();
  if (!cloud) {
    // The read failed: change nothing. Pushing here would replace a save we could
    // not see, which is how a transient error becomes lost progress.
    if (state === 'offline') return local;
    // Profile is genuinely empty. Publish only if this device has actually
    // written something — `updatedAt === 0` means a fresh install with no
    // progress, and an empty save has nothing worth storing.
    if (local.updatedAt > 0) await cloudPushSave(local);
    else setState('synced');
    return local;
  }

  const { mergeSaves } = await import('./save');
  const merged = mergeSaves(local, cloud);
  if (merged.updatedAt !== local.updatedAt || merged.coins !== local.coins) {
    persistSave(merged);
  }
  if (JSON.stringify(merged) !== JSON.stringify(cloud)) {
    await cloudPushSave(merged);
  } else {
    setState('synced');
  }
  return merged;
}

// ─── leaderboard ────────────────────────────────────────────────────────────

/** Top entries by farthest wave. Empty array on any failure. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await request(`/public?data=${encodeURIComponent(JSON.stringify({ text: LEADERBOARD_MARKER }))}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ _id?: string; data?: string }> };
    const entries = (json.data ?? [])
      .slice(0, MAX_ROWS)
      .map((row) => parseLeaderboardRow(row))
      .filter((entry): entry is LeaderboardEntry => entry !== null);
    return rankLeaderboard(entries).top;
  } catch {
    return [];
  }
}

/** Publish a run's farthest wave. Public rows are append-only, so this is safe. */
export async function submitScore(wave: number, score: number): Promise<boolean> {
  const user = readUser();
  if (!user) return false;
  const safeWave = Math.max(0, Math.min(Math.floor(wave) || 0, 100000));
  const safeScore = Math.max(0, Math.min(Math.floor(score) || 0, 100000000));
  if (safeWave < 1) return false;
  try {
    const res = await request('/public', {
      method: 'POST',
      // The field name differs by endpoint, and getting it wrong is a 500, not a
      // validation error: the private routes read `req.body.text`, while
      // `postData.js` reads `req.body.data.Text` and throws on anything else.
      body: JSON.stringify({
        data: formatLeaderboardText({ wave: safeWave, score: safeScore, name: displayName(), userId: user._id }),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The guest best score, for the "sign in to appear here" hint. */
export function localBestWave(save = loadSave()): number {
  return save.bestWave;
}
