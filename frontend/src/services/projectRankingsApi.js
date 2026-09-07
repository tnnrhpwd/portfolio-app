/**
 * projectRankingsApi.js — fetches page-view counts for the /projects catalog.
 *
 *   GET /api/data/analytics/project-rankings?paths=/fluid,/2048,/coliseum
 *
 * Returns `{ success, days, pages: [{ path, visits }] }`. The endpoint is
 * public and only returns counts for the paths we explicitly ask for.
 */

import { getApiBase } from '../config/api';
import { parseJson } from './apiClient';

/**
 * Fetch visit counts for the given paths.
 * @param {string[]} paths - e.g. ['/fluid', '/2048']
 * @param {{ days?: number }} [options]
 * @returns {Promise<{success: boolean, days: number, pages: Array<{path: string, visits: number}>}>}
 */
export async function fetchProjectRankings(paths, { days = 30 } = {}) {
  const query = `paths=${encodeURIComponent(paths.join(','))}&days=${days}`;
  const res = await fetch(`${getApiBase()}analytics/project-rankings?${query}`);
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || json.message || 'Failed to load project rankings');
  return json;
}
