/**
 * petsApi.js — Frontend API helpers for the Pets feature.
 *
 *   GET    /api/data/pets                → list pets
 *   POST   /api/data/pets/adopt          → adopt a pet
 *   GET    /api/data/pets/:petId         → get one pet
 *   POST   /api/data/pets/:petId/action  → perform a care action / revive
 *   DELETE /api/data/pets/:petId         → release a pet
 */

import { getApiBase } from '../config/api';
import { authHeaders as headers, parseJson } from './apiClient';

/** List the current user's pets (stats already decayed server-side). */
export async function fetchPets(token) {
  const res = await fetch(`${getApiBase()}pets`, { headers: headers(token) });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to load pets');
  return json;
}

/** Adopt a new pet with the given name + species. */
export async function adoptPet(token, { name, species }) {
  const res = await fetch(`${getApiBase()}pets/adopt`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, species }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to adopt pet');
  return json.pet;
}

/** Fetch a single pet by id. */
export async function fetchPet(token, petId) {
  const res = await fetch(`${getApiBase()}pets/${encodeURIComponent(petId)}`, {
    headers: headers(token),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to load pet');
  return json.pet;
}

/** Perform a care action (feed / play / groom / rest / heal / walk / treat / train / revive). */
export async function petAction(token, petId, action, extra = {}) {
  const res = await fetch(`${getApiBase()}pets/${encodeURIComponent(petId)}/action`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ action, ...extra }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to update pet');
  return json.pet;
}

/** Release (delete) a pet permanently. */
export async function releasePet(token, petId) {
  const res = await fetch(`${getApiBase()}pets/${encodeURIComponent(petId)}`, {
    method: 'DELETE',
    headers: headers(token),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to release pet');
  return json;
}
