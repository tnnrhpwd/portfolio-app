/**
 * uiMapperApi.js — Frontend API helper for the /uimapper internal tool.
 *
 *   POST /api/data/uimapper/automap → { success, regions: [{name,x,y,w,h}] }
 *
 * The endpoint is authenticated (server-paid Bedrock vision), so it requires
 * a logged-in user's JWT — same pattern as OCR / image generation.
 */

import { getApiBase } from '../config/api';

/**
 * Ask the backend to auto-detect UI components + names in a screenshot.
 *
 * @param {string} imageDataUrl - `data:image/jpeg;base64,...` (already downscaled).
 * @param {number} width - Pixel width of the image actually sent.
 * @param {number} height - Pixel height of the image actually sent.
 * @param {string} token - Logged-in user's JWT.
 * @returns {Promise<Array<{name:string,x:number,y:number,w:number,h:number}>>}
 */
export async function autoMapImage(imageDataUrl, width, height, token) {
  if (!token) throw new Error('Sign in required to use AI auto-mapping.');

  const res = await fetch(`${getApiBase()}uimapper/automap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ imageDataUrl, width, height }),
  });

  let json = {};
  try {
    json = await res.json();
  } catch {
    // Fall through to a generic error below.
  }

  if (!res.ok) throw new Error(json.error || json.message || 'AI auto-mapping failed. Please try again.');
  if (!json.success || !Array.isArray(json.regions)) {
    throw new Error('AI auto-mapping returned an unexpected response.');
  }
  return json.regions;
}
