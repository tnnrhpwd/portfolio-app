/**
 * fitConstants.js — small shared vocabularies for /fit.
 *
 * Kept separate from the engines so the page and (later) any API payload agree
 * on the exact strings. The backend screens free text for red flags, so these
 * values have to be stable: "lower-back" is an area, "next-day" is a timing,
 * and neither is ever free text.
 */

/** Every area the pain report offers. `none` means "nothing to report". */
export const PAIN_AREAS = [
  'none',
  'neck',
  'shoulder',
  'elbow',
  'wrist-hand',
  'upper-back',
  'lower-back',
  'hip',
  'groin',
  'quad',
  'hamstring',
  'knee',
  'shin',
  'calf',
  'ankle-foot',
  'other',
];

/** When it hurts — which changes what the advice should be. */
export const PAIN_TIMINGS = [
  '',
  'during training',
  'after training',
  'the next day',
  'all the time',
  'only when I run',
];

/**
 * Where a reported niggle does and does not belong in the training week.
 * Used to explain the "work around it" rule in the UI rather than to diagnose
 * anything — Fit never names a condition.
 */
export const PAIN_GUIDANCE = 'Tell Fit where it hurts and it will work around it — reduce the load or range, or swap the movement. Sharp, sudden, or worsening pain needs a health professional, not a training plan.';
