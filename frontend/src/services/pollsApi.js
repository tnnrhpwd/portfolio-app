/**
 * pollsApi.js — Frontend API helpers for the public Polls feature.
 *
 * Talks to:
 *   GET    /api/data/polls
 *   POST   /api/data/polls
 *   POST   /api/data/polls/:id/vote
 *   POST   /api/data/polls/:id/close
 *   POST   /api/data/polls/:id/delete
 *
 * Polls are public — no auth token required.
 */

import { getApiBase } from '../config/api';

/**
 * Safely read a JSON body. The Netlify SPA catch-all / proxy can occasionally
 * return an HTML error page instead of JSON; parse defensively so we surface a
 * clear error instead of a confusing SyntaxError.
 */
async function parseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from server (${res.status}). Please try again.`);
  }
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

/** List recent polls (active + closed). */
export async function fetchPolls() {
  const res = await fetch(`${getApiBase()}polls`);
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.dataMessage || json.message || json.error || 'Failed to load polls');
  return json.polls || [];
}

/** Create a new poll. Returns the created poll including its `ownerKey`. */
export async function createPoll({ question, options, durationMinutes, creator }) {
  const res = await fetch(`${getApiBase()}polls`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ question, options, durationMinutes, creator }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.dataMessage || json.message || json.error || 'Failed to create poll');
  return json.poll;
}

/** Cast a vote. `voterId` is an anonymous device identifier stored locally. */
export async function votePoll(pollId, optionIndex, voterId) {
  const res = await fetch(`${getApiBase()}polls/${encodeURIComponent(pollId)}/vote`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ optionIndex, voterId }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.dataMessage || json.message || json.error || 'Failed to vote');
  return json.poll;
}

/** Close a poll (owner only). */
export async function closePoll(pollId, ownerKey) {
  const res = await fetch(`${getApiBase()}polls/${encodeURIComponent(pollId)}/close`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ ownerKey }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.dataMessage || json.message || json.error || 'Failed to close poll');
  return json.poll;
}

/** Delete a poll (owner only). */
export async function deletePoll(pollId, ownerKey) {
  const res = await fetch(`${getApiBase()}polls/${encodeURIComponent(pollId)}/delete`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ ownerKey }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.dataMessage || json.message || json.error || 'Failed to delete poll');
  return json;
}
