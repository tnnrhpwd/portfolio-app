/**
 * goalHorizons.js — the goal HORIZON vocabulary, in one place.
 *
 * A horizon says how far out a goal is aimed. It is optional on every goal, and
 * that is the whole design: a dream is not a kind of object, it is a goal at the
 * longest horizon, so "retire at 60" and "pick up groceries" are the same record
 * distinguished by one field. That is what lets them be grouped, filtered and
 * handed to different parts of the app without either being a special case.
 *
 * The values mirror the backend's `GOAL_HORIZONS`
 * (`backend/services/workspaceGoals.js`) — the same four strings, short → long —
 * so nothing has to translate between client and server.
 *
 * Lives in `constants/` rather than in the /plans utils because more than one
 * page needs it (/plans groups by it, /market filters by it), and a second copy
 * of a four-value vocabulary is how the two drift apart.
 */

/** Short → long. The order IS the ranking: nearest first, always. */
export const GOAL_HORIZONS = ['week', 'quarter', 'year', 'life'];

export const HORIZON_LABELS = {
  week: 'This week',
  quarter: 'This quarter',
  year: 'This year',
  life: 'Life',
};

/** One line on what each horizon means, for pickers and empty states. */
export const HORIZON_HINTS = {
  week: 'Days — something you can just go and do.',
  quarter: 'Weeks to months — a piece of work with an end.',
  year: 'An outcome you are aiming at this year.',
  life: 'Open-ended — usually waiting on money, a date or a person.',
};

/** The bucket for a goal that has made no claim about its horizon. A real state,
 *  not a default: every goal written before horizons existed has none. */
export const HORIZON_NONE = 'none';
export const HORIZON_NONE_LABEL = 'No horizon';

/** The horizons whose goals are CONTAINERS: aims to split, not tasks to finish. */
export const CONTAINER_HORIZONS = ['year', 'life'];

export function isContainerHorizon(horizon) {
  return CONTAINER_HORIZONS.includes(horizon);
}

/** `'life'` → `'Life'`, anything unset/unknown → `'No horizon'`. */
export function horizonLabel(horizon) {
  return GOAL_HORIZONS.includes(horizon) ? HORIZON_LABELS[horizon] : HORIZON_NONE_LABEL;
}
