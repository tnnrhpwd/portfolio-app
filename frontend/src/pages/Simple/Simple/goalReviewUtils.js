/**
 * goalReviewUtils.js — pure helpers for the "Work on my goals" panel.
 *
 * The review arrives as a stored blob (`review/goal-review`): proposals of four
 * kinds, a few observations, and stats. What the panel needs from it is grouping,
 * staging and a readable age — none of which belongs in the component, and all of
 * which is worth testing without a DOM.
 */

/** How each proposal kind presents itself. The order here IS the render order:
 *  changing the list, then adding to it. */
export const PROPOSAL_SECTIONS = [
  { kind: 'horizon', icon: '🧭', title: 'Re-scope', blurb: 'Aimed at the wrong horizon' },
  { kind: 'split', icon: '✂️', title: 'Break down', blurb: 'An aim with nothing under it' },
  { kind: 'plan', icon: '📋', title: 'Plan', blurb: 'Nothing to work from yet' },
  { kind: 'new-goal', icon: '✨', title: 'New goals', blurb: 'Follows from what you have' },
];

const KIND_META = PROPOSAL_SECTIONS.reduce((acc, s) => { acc[s.kind] = s; return acc; }, {});

/** The icon for one proposal, wherever it is rendered on its own. */
export function proposalIcon(kind) {
  return KIND_META[kind]?.icon || '•';
}

/**
 * Group the proposals into the sections the panel renders, dropping empty ones.
 * Unknown kinds are dropped rather than shown in a section of their own: the
 * apply step can't execute them, so offering one would be a dead end.
 */
export function groupProposals(items) {
  const list = Array.isArray(items) ? items : [];
  return PROPOSAL_SECTIONS
    .map((section) => ({ ...section, items: list.filter((i) => i?.kind === section.kind) }))
    .filter((section) => section.items.length > 0);
}

/** Staged ids, toggled. Returns a new Set — the caller's stays untouched. */
export function toggleStaged(staged, id) {
  const next = new Set(staged);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Staged ids narrowed to proposals that still exist in the review (a refresh
 *  replaces them, and an id that is gone can no longer be applied). */
export function liveStaged(staged, items) {
  const known = new Set((Array.isArray(items) ? items : []).map((i) => i?.id).filter(Boolean));
  return [...(staged || [])].filter((id) => known.has(id));
}

/**
 * How long ago the review was taken, in words. Coarse on purpose: the panel only
 * needs the user to know whether they are looking at something current.
 */
export function reviewAge(generatedAt, now = Date.now()) {
  const then = Date.parse(generatedAt || '');
  if (!Number.isFinite(then)) return '';
  // Floored, not rounded: half a minute old is "just now", not "1 min ago" — and
  // the coarse units above round because nobody reads them to the minute.
  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** `This week → This quarter`, for a re-scope proposal. */
export function horizonChange(from, to, labels) {
  const label = (h) => labels?.[h] || 'No horizon';
  return `${label(from)} → ${label(to)}`;
}

/**
 * What applying a batch would produce, for the button and the footer:
 * `Apply 3 changes` + `1 goal re-scoped, 2 goals created`.
 *
 * A re-scope is not counted as a goal: nothing is created, an existing goal's
 * horizon moves — and saying "creates 1 goal" for that is simply wrong.
 */
export function batchSummary(writes) {
  const list = Array.isArray(writes) ? writes : [];
  // A split creates its children, so it counts as goals created.
  const goals = list.filter((w) => w === 'goal' || w === 'child' || w === 'split' || w === 'new-goal').length;
  const plans = list.filter((w) => w === 'plan').length;
  const rescoped = list.filter((w) => w === 'horizon').length;
  return { count: list.length, goals, plans, rescoped };
}

/** `1 goal re-scoped, 2 goals created, 1 plan created` — empty for an empty batch. */
export function batchSummaryText(summary) {
  const s = summary || {};
  const parts = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (s.rescoped) parts.push(`${plural(s.rescoped, 'goal')} re-scoped`);
  if (s.goals) parts.push(`${plural(s.goals, 'goal')} created`);
  if (s.plans) parts.push(`${plural(s.plans, 'plan')} created`);
  return parts.join(', ');
}

/** The staged proposals, in the order the panel shows them. */
export function stagedItems(items, staged) {
  const ids = new Set(staged || []);
  return (Array.isArray(items) ? items : []).filter((i) => i?.id && ids.has(i.id));
}

/**
 * Turn an observation from the review into a `kind='lesson'` workspace item —
 * the same store the agent's own critic writes to, so a kept observation is
 * recalled by the loop later instead of sitting in a panel.
 */
export function lessonToWorkspaceItem(text, slugify) {
  const body = String(text || '').trim();
  if (!body) return null;
  return {
    slug: slugify ? slugify(body) : 'review-lesson',
    name: body.length > 80 ? `${body.slice(0, 79).trimEnd()}…` : body,
    content: JSON.stringify({ pattern: body, source: 'goal-review', confidence: 0.5 }),
  };
}
