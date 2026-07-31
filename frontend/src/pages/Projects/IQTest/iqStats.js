// Statistical helpers for converting IQ-test answers into a simulated IQ
// estimate (mean 100, standard deviation 15) and percentile using a simple
// 1-parameter (Rasch) Item Response Theory model.
// NOTE: this is for entertainment purposes only — not a validated psychometric model.

// Maps each question's difficulty tier (1..5) to an IRT difficulty parameter
// "b" on the logit scale. Higher b = harder question. These are chosen so
// an average test-taker (theta = 0, IQ 100) has roughly an 88% chance on a
// tier-1 item and only an ~8% chance on a tier-5 item — a realistic spread
// similar to how real ability tests mix "everyone gets this" items with
// "almost no one gets this" items.
export const DIFF_TO_B = { 1: -2.0, 2: -1.0, 3: 0.0, 4: 1.15, 5: 2.3 };

// Probability of a correct response given ability theta and item difficulty b.
function pCorrect(theta, b) {
  return 1 / (1 + Math.exp(-(theta - b)));
}

// Estimates a test-taker's ability (theta) from their pattern of right/wrong
// answers using maximum a posteriori (MAP) Newton-Raphson with a standard
// normal N(0,1) prior on theta. The prior regularizes the estimate so a
// perfect or a zero score still yields a finite, sensible result instead of
// diverging to +/-Infinity (as pure maximum-likelihood estimation would).
export function estimateAbility(responses) {
  if (!responses || responses.length === 0) return 0;
  let theta = 0;
  for (let iter = 0; iter < 50; iter++) {
    let grad = -theta; // d/dtheta of the log N(0,1) prior density
    let info = 1; // prior contributes unit Fisher information
    responses.forEach(({ b, correct }) => {
      const p = pCorrect(theta, b);
      grad += (correct ? 1 : 0) - p;
      info += p * (1 - p);
    });
    const step = grad / info;
    theta += step;
    if (Math.abs(step) < 1e-6) break;
  }
  return theta;
}

// Abramowitz & Stegun rational approximation of the error function.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// Standard normal cumulative distribution function.
export function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Converts a list of { b, correct } item responses into an IQ estimate and
// percentile via a Rasch (1PL IRT) ability estimate. theta is assumed to be
// distributed N(0,1) across the population by construction of DIFF_TO_B, so
// it maps linearly onto the IQ scale (mean 100, SD 15) and its own normal
// CDF gives the percentile directly — no separate raw-score lookup needed.
export function computeIQ(responses) {
  const theta = estimateAbility(responses);
  // Clamp to +/-4 SD, a generous range (about IQ 40-160) that keeps results
  // sane even for tiny numbers of extreme (all-correct/all-wrong) responses.
  const clampedTheta = Math.max(-4, Math.min(4, theta));
  const iq = Math.round(Math.max(55, Math.min(160, 100 + 15 * clampedTheta)));
  const percentile = Math.max(1, Math.min(99, Math.round(normalCDF(clampedTheta) * 100)));
  return { iq, percentile, theta: clampedTheta };
}
