import type { GameState } from '../core';
import { deserializeState, serializeState } from '../core';

const MARKER = 'ColiseumSave';
const LEGACY_MARKER = 'ColosseumSave';

// The backend is reachable via the Vite dev proxy (localhost) and the Netlify
// proxy in production, so a relative base works for both deployment targets.
const BASE = '/api/data/';

interface StoredUser {
  _id?: string;
  token?: string;
}

function readAuth(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredUser;
    return parsed && parsed._id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return readAuth() !== null;
}

function buildText(state: GameState): string {
  return `${MARKER}|${serializeState(state)}`;
}

function parseText(text: string): GameState | null {
  for (const marker of [MARKER, LEGACY_MARKER]) {
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      return deserializeState(text.slice(idx + marker.length).replace(/^\|/, ''));
    }
  }
  return null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = readAuth();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (auth) headers.Authorization = `Bearer ${auth.token}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

interface CloudItem {
  id?: string;
  text?: string;
}

async function fetchSaves(marker: string): Promise<CloudItem[]> {
  const res = await request(`?data=${encodeURIComponent(JSON.stringify({ text: marker }))}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: CloudItem[] };
  return (json.data ?? []).filter((item) => (item.text ?? '').includes(marker));
}

async function fetchAllSaves(): Promise<CloudItem[]> {
  const current = await fetchSaves(MARKER);
  const legacy = await fetchSaves(LEGACY_MARKER);
  return [...current, ...legacy];
}

/** Pulls the logged-in user's cloud save, or null when none exists. */
export async function cloudLoad(): Promise<GameState | null> {
  if (!readAuth()) return null;
  try {
    const items = await fetchAllSaves();
    for (const item of items) {
      const parsed = parseText(item.text ?? '');
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Overwrites the user's single cloud save (delete old + create new). */
export async function cloudSave(state: GameState): Promise<boolean> {
  if (!readAuth()) return false;
  try {
    const items = await fetchAllSaves();
    await Promise.all(
      items.map((item) => (item.id ? request(`${item.id}`, { method: 'DELETE' }) : Promise.resolve())),
    );
    const res = await request('', { method: 'POST', body: JSON.stringify({ text: buildText(state) }) });
    return res.ok;
  } catch {
    return false;
  }
}
