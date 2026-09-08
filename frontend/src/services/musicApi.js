/**
 * musicApi.js — Frontend API helper for the /music page.
 *
 *   GET    /api/data/music/catalog   → genres/moods/tempos + config
 *   POST   /api/data/music/generate  → generate a song (auth)
 *   GET    /api/data/music/songs     → list the user's songs (auth)
 *   DELETE /api/data/music/songs/:id → delete a song (auth)
 */

import { getApiBase } from '../config/api';
import { authHeaders, parseJson } from './apiClient';

/**
 * Read the logged-in user's JWT from localStorage (same shape the rest of the
 * app uses). Returns null when the visitor is not signed in.
 */
export function getMusicToken() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.token || null;
  } catch {
    return null;
  }
}

/** Fetch the style catalogs + server generation config. Public. */
export async function getMusicCatalog() {
  const res = await fetch(`${getApiBase()}music/catalog`);
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || 'Failed to load the music catalog');
  return json;
}

/**
 * Generate a song. `voice` is `{ dataUrl }` (inline audio) or `{ voiceSampleKey }`.
 * Requires the user's consent that they own the voice.
 */
export async function generateSong({ title, lyrics, style, voice, consent }, token) {
  const res = await fetch(`${getApiBase()}music/generate`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title, lyrics, style, voice, consent }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || 'Failed to generate the song');
  return json;
}

/** List the authenticated user's saved songs. */
export async function listSongs(token) {
  const res = await fetch(`${getApiBase()}music/songs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || 'Failed to load your songs');
  return json.songs || [];
}

/** Delete a saved song by id. */
export async function deleteSong(songId, token) {
  const res = await fetch(`${getApiBase()}music/songs/${encodeURIComponent(songId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || 'Failed to delete the song');
  return json;
}
