/**
 * visionBoardUtils.js — everything a vision board panel needs to decide, as
 * pure functions.
 *
 * Two jobs live here:
 *
 *   1. **Reading a stored board.** Boards arrive as workspace list entries whose
 *      `content` is JSON. That JSON is the thing most likely to be handed to the
 *      UI in a shape it didn't expect — an old board, a half-written one, a
 *      record whose image was deleted out from under it — so parsing is total and
 *      never throws, and a board with no image is dropped rather than rendered as
 *      a broken tile.
 *   2. **Saying what a board is, in one line.** "Dreams · 6 goals · 2 days ago"
 *      is the whole point of a history: it has to make the difference between two
 *      boards legible without opening them.
 */

/** Scope vocabulary — mirrors the backend's `SCOPE_LABELS`. */
export const BOARD_SCOPES = ['dream', 'all'];

export const SCOPE_LABELS = {
  dream: 'Dreams',
  all: 'All goals',
};

export const SCOPE_SHORT = {
  dream: 'Dreams',
  all: 'All',
};

/** Why a scope produced nothing, in the user's words. */
export const SKIP_REASONS = {
  'scope-empty': 'none of your goals are on that list yet',
};

const SCOPE_GLYPHS = { dream: '🌟', all: '🎯' };

export const scopeGlyph = (scope) => SCOPE_GLYPHS[scope] || '🖼️';
export const scopeLabel = (scope) => SCOPE_LABELS[scope] || 'Vision board';

/**
 * One board from a workspace list entry, or null.
 *
 * Null covers every unrenderable case on purpose — no JSON, JSON that isn't an
 * object, or a record with no image URL. The gallery filters these out, so a
 * corrupt row can never take the panel down with it.
 */
export function parseBoard(entry) {
  if (!entry?.content) return null;
  let record;
  try {
    record = JSON.parse(entry.content);
  } catch {
    return null;
  }
  if (!record || typeof record !== 'object') return null;
  const url = record.image?.url;
  if (typeof url !== 'string' || !url) return null;

  return {
    slug: entry.slug || '',
    name: entry.name || 'Vision board',
    scope: BOARD_SCOPES.includes(record.scope) ? record.scope : 'all',
    url,
    s3Key: record.image?.s3Key || null,
    bytes: Number(record.image?.bytes) || 0,
    // The look this board got. A board made before looks existed has none — that
    // is a missing value, not a broken one, and the line simply says less.
    style: styleName(record.style),
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    promptSource: record.promptSource === 'fallback' ? 'fallback' : 'model',
    hint: typeof record.hint === 'string' ? record.hint : '',
    model: record.model || null,
    aspectRatio: record.aspectRatio || null,
    generatedAt: record.generatedAt || entry.updatedAt || null,
    used: Number(record.source?.used) || (Array.isArray(record.source?.goals) ? record.source.goals.length : 0),
    total: Number(record.source?.total) || 0,
    truncated: Number(record.source?.truncated) || 0,
    goals: Array.isArray(record.source?.goals) ? record.source.goals : [],
  };
}

/** Every renderable board from a list response, newest first. */
export function parseBoards(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(parseBoard)
    .filter(Boolean)
    .sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
}

/** "6 goals" / "1 goal" — the count a board was actually made from. */
function goalCountLabel(board) {
  const n = board.used;
  if (!n) return 'no goals';
  return `${n} goal${n === 1 ? '' : 's'}`;
}

/** The look's name from a stored record, or null. Tolerant of both shapes. */
function styleName(style) {
  if (typeof style === 'string') return style || null;
  const name = style?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * One line describing a board: what it was made from, how much of it, what it
 * looks like, and when.
 *
 * The look is part of the description because it is the thing that makes two
 * boards of the same scope distinguishable at a glance — which is the whole job
 * of this line. `truncated` is said out loud too: a board made from 24 of 40
 * goals should never pretend it used all of them.
 */
export function boardMetaLine(board, { ago = '' } = {}) {
  if (!board) return '';
  const bits = [
    SCOPE_LABELS[board.scope] || 'All goals',
    goalCountLabel(board),
  ];
  if (board.style) bits.push(board.style);
  if (board.truncated) bits.push(`${board.truncated} left out`);
  if (board.promptSource === 'fallback') bits.push('prompt written for you');
  if (ago) bits.push(ago);
  return bits.join(' · ');
}

/** The count under the panel heading: "3 boards" or "" when there are none. */
export function boardCountLabel(count) {
  if (!count) return '';
  return `${count} board${count === 1 ? '' : 's'}`;
}

/**
 * What the dialog will cost, stated before the user presses the button: one
 * image credit per scope, and one prompt written per board.
 *
 * The "nothing to draw from" note only appears when the caller actually knows the
 * counts. A caller that doesn't (a test, a future preview) shouldn't be told a
 * scope is empty — guessing there would put a warning in front of a user who has
 * goals.
 */
export function costLine(scopes, { dreamCount, allCount } = {}) {
  const list = (Array.isArray(scopes) ? scopes : []).filter((s) => BOARD_SCOPES.includes(s));
  if (!list.length) return 'Pick at least one set of goals.';
  const parts = [
    `${list.length} image${list.length === 1 ? '' : 's'} · ${list.length} credit${list.length === 1 ? '' : 's'}`,
  ];
  const countsKnown = typeof dreamCount === 'number' || typeof allCount === 'number';
  if (countsKnown) {
    const available = { dream: dreamCount, all: allCount };
    const empty = list.filter((s) => !available[s]);
    if (empty.length) {
      parts.push(`${empty.map((s) => SCOPE_LABELS[s]).join(' and ')} would have nothing to draw from yet`);
    }
  }
  return parts.join(' · ');
}

/** Toggle a scope in the dialog's selection, keeping the canonical order. */
export function toggleScope(selected, scope) {
  const set = new Set(Array.isArray(selected) ? selected : []);
  if (set.has(scope)) set.delete(scope);
  else set.add(scope);
  return BOARD_SCOPES.filter((s) => set.has(s));
}

/** How many boards were made from each scope — the gallery's own summary. */
export function scopeCounts(boards) {
  const counts = { dream: 0, all: 0 };
  for (const board of Array.isArray(boards) ? boards : []) {
    if (counts[board.scope] !== undefined) counts[board.scope] += 1;
  }
  return counts;
}

/**
 * The generation result as a sentence: what was made, what was skipped, what
 * failed. All three, because "2 of 3 worked" is the case a single toast hides.
 */
export function resultLine({ boards = [], skipped = [], failures = [] } = {}) {
  const made = boards.length;
  const bits = [];
  if (made) {
    bits.push(`Made ${made} board${made === 1 ? '' : 's'}`);
  }
  if (skipped.length) {
    bits.push(skipped.map((s) => {
      const reason = SKIP_REASONS[s?.reason] || s?.reason || 'nothing to draw from';
      return `${SCOPE_LABELS[s?.scope] || 'That board'}: ${reason}`;
    }).join('; '));
  }
  if (failures.length) {
    bits.push(`could not make ${failures.map((f) => SCOPE_LABELS[f?.scope] || 'one board').join(' or ')}`);
  }
  if (!bits.length) return 'Nothing to make a board from yet.';
  return `${bits.join(' — ')}.`;
}
