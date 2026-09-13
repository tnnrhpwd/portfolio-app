/**
 * Pure scoring helpers shared by every quiz page under /quizzes.
 *
 * The quiz pages are deliberately thin: `QuizPage.jsx` owns the flow (start →
 * questions → results → review) and each quiz supplies a config object with
 * its items and an `interpret()` function. Everything that is arithmetic —
 * shuffling, per-dimension scoring, band lookup — lives here so it can be
 * unit-tested without mounting React (see quizEngine.test.js).
 *
 * NOTE: nothing here is a validated psychometric model. The quizzes are for
 * entertainment and self-reflection only.
 */

/**
 * Fisher-Yates shuffle. Returns a new array; the input is never mutated.
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seconds → "m:ss", for the "time taken" readout.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * 1 → "1st", 12 → "12th", 23 → "23rd" (11/12/13 are the exceptions, not 1/2/3).
 * @param {number} n
 * @returns {string}
 */
export function ordinal(n) {
  const v = Math.round(Number(n) || 0);
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

/**
 * Scores a set of answers against named dimensions.
 *
 * Every item carries a `dim` (the dimension it feeds) and a `key` telling the
 * scorer which direction agreement points:
 *   key >= 0  →  agreeing raises the dimension (forward-scored item)
 *   key <  0  →  agreeing lowers it (reverse-scored / negatively-keyed item)
 *
 * Each response must be `{ dim, key, value }` where `value` is the 0..scaleMax
 * index of the chosen answer, or `null` for a skipped item.
 *
 * Returns, per dimension:
 *   raw / max     — sum and ceiling of the 0..1 "lean" each item contributes
 *   pct           — percentage toward the dimension's high pole (0..100, 1dp)
 *   points        — sum of raw answer points, 0..scaleMax per item
 *   pointsMax     — ceiling for `points` (scaleMax × scored items)
 *   count/skipped — how many items fed the dimension, and how many were skipped
 *
 * `pct` is what almost every quiz wants (it is comparable across dimensions
 * that have different item counts, and it survives a skips). `points` exists
 * for the screening quizzes, which report a raw symptom count rather than a
 * percentage.
 *
 * A skipped item counts as neutral (0.5) rather than as disagreement, so
 * skipping a reverse-keyed item can't silently inflate the opposite pole. It
 * is left out of `points`/`pointsMax` so a skip can never add symptom points.
 *
 * @param {Array<{dim?: string, key?: number, value: number|null}>} answers
 * @param {number} scaleMax - highest answer index (scale.length - 1)
 * @returns {Record<string, {raw:number,max:number,pct:number,points:number,pointsMax:number,count:number,skipped:number}>}
 */
export function scoreTraits(answers, scaleMax) {
  const out = {};
  const safeMax = scaleMax > 0 ? scaleMax : 1;

  (answers || []).forEach((answer) => {
    if (!answer || !answer.dim) return;
    const { dim, key = 1, value } = answer;
    const bucket = out[dim] || (out[dim] = {
      raw: 0, max: 0, pct: 0, points: 0, pointsMax: 0, count: 0, skipped: 0,
    });

    bucket.count += 1;
    bucket.max += 1;

    if (value === null || value === undefined) {
      bucket.skipped += 1;
      bucket.raw += 0.5;
      return;
    }

    const clamped = Math.min(Math.max(value, 0), safeMax);
    const t = clamped / safeMax;
    bucket.raw += key >= 0 ? t : 1 - t;
    bucket.points += key >= 0 ? clamped : safeMax - clamped;
    bucket.pointsMax += safeMax;
  });

  Object.values(out).forEach((bucket) => {
    bucket.pct = bucket.max ? Math.round((bucket.raw / bucket.max) * 1000) / 10 : 0;
  });

  return out;
}

/**
 * Turns a { dim: bucket } map into display order, carrying the definition's
 * own fields through so a quiz can read its per-dimension copy straight off the
 * row (e.g. the screening quizzes read `high`/`low` off their area definitions,
 * the Enneagram reads `short`). Dropping those fields is an easy way to end up
 * rendering the word "undefined" at a user, so they are spread rather than
 * whitelisted.
 *
 * @param {Record<string, object>} scores - output of scoreTraits
 * @param {Array<{key:string, name:string}>} definitions
 * @returns {Array<object>}
 */
export function traitRows(scores, definitions) {
  return (definitions || [])
    .map((def) => {
      const bucket = scores[def.key];
      if (!bucket) return null;
      return {
        ...def,
        key: def.key,
        name: def.name,
        note: def.note || '',
        pct: bucket.pct,
        points: bucket.points,
        pointsMax: bucket.pointsMax,
      };
    })
    .filter(Boolean);
}

/**
 * Highest-scoring dimension keys, strongest first. `pct` is the tie-breaker
 * when `points` are equal (which they are for every percentage-scored quiz).
 *
 * @param {Record<string, {pct:number, points:number}>} scores
 * @param {number} count
 * @param {string[]} [order] - preferred order for ties (keeps output stable)
 * @returns {string[]}
 */
export function topKeys(scores, count, order = []) {
  const rank = (key) => (order.indexOf(key) === -1 ? order.length : order.indexOf(key));
  return Object.keys(scores)
    .filter((key) => scores[key].count > 0)
    .sort((a, b) => (scores[b].points - scores[a].points)
      || (scores[b].pct - scores[a].pct)
      || (rank(a) - rank(b)))
    .slice(0, count);
}

/**
 * One answer expressed as a 0..1 lean toward the item's high pole.
 *
 * This is the single per-item number the couples quizzes compare: because it
 * already accounts for reverse-keying, two partners' leans are directly
 * comparable even when an item is negatively keyed. Returns null for a skipped
 * answer, so a skip is excluded rather than scored as disagreement.
 *
 * @param {number|null} value - 0..scaleMax answer index
 * @param {number} key - +1 (agreeing raises the pole) or -1 (lowers it)
 * @param {number} scaleMax
 * @returns {number|null}
 */
export function itemLean(value, key, scaleMax) {
  if (value === null || value === undefined) return null;
  const safeMax = scaleMax > 0 ? scaleMax : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const t = clamped / safeMax;
  return key >= 0 ? t : 1 - t;
}

/**
 * Compares two people's answers to the same items, for the couples quizzes.
 *
 * Alignment per item is `1 - |leanA - leanB|`, so identical answers score 100%
 * and opposite poles score 0%. The overall figure is the mean across items, and
 * `byDim` gives the same thing per area, which is what makes "you agree about
 * money and disagree about family" visible.
 *
 * Items either person skipped are dropped from both the overall and the area
 * averages rather than counted as a mismatch — an unanswered question is not a
 * disagreement.
 *
 * @param {Array<{dim:string,key:number,value:number|null,text:string}>} aResponses
 * @param {Array<{dim:string,key:number,value:number|null,text:string}>} bResponses
 * @param {number} scaleMax
 * @returns {{overallPct:number, byDim:Record<string,{sum:number,count:number,pct:number}>, items:Array<object>}}
 */
export function compareResponses(aResponses, bResponses, scaleMax) {
  const items = [];
  const byDim = {};
  const len = Math.min(aResponses?.length || 0, bResponses?.length || 0);

  for (let i = 0; i < len; i += 1) {
    const a = aResponses[i];
    const b = bResponses[i];
    const leanA = itemLean(a.value, a.key, scaleMax);
    const leanB = itemLean(b.value, b.key, scaleMax);
    if (leanA === null || leanB === null) continue;

    const similarity = 1 - Math.abs(leanA - leanB);
    items.push({
      ...a,
      index: i,
      aValue: a.value,
      bValue: b.value,
      leanA,
      leanB,
      similarity,
      gap: Math.abs(leanA - leanB),
    });

    const bucket = byDim[a.dim] || (byDim[a.dim] = { sum: 0, count: 0, pct: 0 });
    bucket.sum += similarity;
    bucket.count += 1;
  }

  Object.values(byDim).forEach((bucket) => {
    bucket.pct = bucket.count ? Math.round((bucket.sum / bucket.count) * 1000) / 10 : 0;
  });

  const overallPct = items.length
    ? Math.round((items.reduce((sum, item) => sum + item.similarity, 0) / items.length) * 1000) / 10
    : 0;

  return { overallPct, byDim, items };
}

/**
 * Finds the band a score falls into. `bands` must be ordered and cover the
 * whole range; if nothing matches (or the list is empty) the last band wins,
 * so a very high score can never fall through to "no result".
 *
 * @param {number} value
 * @param {Array<{min:number, max:number, label:string, [key:string]:any}>} bands
 * @returns {object|null}
 */
export function bandFor(value, bands) {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  return bands.find((band) => value >= band.min && value <= band.max) || bands[bands.length - 1];
}

/**
 * Labels a 0..100 value as High / Balanced / Low. Shared by the trait quizzes
 * so their bar charts describe themselves consistently.
 * @param {number} pct
 * @returns {'High'|'Balanced'|'Low'}
 */
export function strengthLabel(pct) {
  if (pct >= 70) return 'High';
  if (pct >= 40) return 'Balanced';
  return 'Low';
}
