/**
 * Annuity / time-value-of-money engine.
 *
 * Pure functions only — no React, no DOM, no formatting of state — so every
 * financial rule the page relies on can be unit-tested directly
 * (see `annuityEngine.test.js`).
 *
 * Two capabilities live here:
 *
 *  1. `solveCashFlow`  — the classic engineering-economy solver. Converts any
 *     combination of P (present), A (periodic), F (future) and G (uniform
 *     gradient) into the value at the point in time you asked for.
 *  2. `projectAnnuity` — a year-by-year accumulation projection that models
 *     compounding frequency, payment frequency, payments at the beginning vs
 *     the end of the period, escalating contributions, income tax and
 *     inflation.
 *
 * Numerical notes
 * ---------------
 * The textbook factors divide by the interest rate, so they all blow up at
 * i = 0 ((1+i)^n − 1)/i becomes 0/0 → NaN). Every factor here is written with
 * an explicit zero-interest branch, which is why an annuity with a 0% rate
 * returns the correct straight-line answer instead of 0 or NaN.
 * `(1+i)^n − 1` is evaluated through `Math.expm1(n·log1p(i))` for small rates
 * so a 0.5% monthly rate doesn't lose precision to catastrophic cancellation.
 */

/** Rates below this are treated as exactly zero. */
const NEAR_ZERO = 1e-9;

/** What the user asked the calculator to solve for. */
export const FIND = Object.freeze({
  PRESENT: '$Present',
  PERIODIC: '$Periodic',
  FUTURE: '$Future',
});

/** Whether payments land at the end (ordinary annuity) or start (annuity due). */
export const TIMING = Object.freeze({
  END: 'end',
  BEGIN: 'begin',
});

/** How the growth inside the account is taxed. */
export const TAX_TREATMENT = Object.freeze({
  /** Roth IRA / ISA / TFSA — growth is never taxed. */
  NONE: 'none',
  /** Traditional IRA / 401(k) — no annual tax, taxable at withdrawal. */
  DEFERRED: 'deferred',
  /** Ordinary brokerage account — interest is taxed every year. */
  ANNUAL: 'annual',
});

export const TIMING_LABELS = Object.freeze({
  [TIMING.END]: 'End of each period (ordinary annuity)',
  [TIMING.BEGIN]: 'Beginning of each period (annuity due)',
});

export const TAX_TREATMENT_LABELS = Object.freeze({
  [TAX_TREATMENT.NONE]: 'Tax-free (Roth / ISA / TFSA)',
  [TAX_TREATMENT.DEFERRED]: 'Tax-deferred (Traditional IRA / 401k)',
  [TAX_TREATMENT.ANNUAL]: 'Taxed every year (brokerage account)',
});

const TARGET_LETTER = {
  [FIND.PRESENT]: 'P',
  [FIND.PERIODIC]: 'A',
  [FIND.FUTURE]: 'F',
};

// ---------------------------------------------------------------------------
// Input parsing & formatting
// ---------------------------------------------------------------------------

/** Lenient string → number. Anything unparseable becomes 0 (never NaN). */
export function parseNumberInput(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const cleaned = String(raw).replace(/[^0-9.eE+-]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Rates are meaningless without a unit, and "5" vs "0.05" is a coin flip.
 * The UI always tells us which unit it collected, so we never guess.
 */
export function parseRateInput(raw, unit = 'percent') {
  const value = parseNumberInput(raw);
  return unit === 'percent' ? value / 100 : value;
}

/**
 * Keeps a text field honest while typing: digits, one decimal point, and an
 * optional leading minus. Strips thousands separators, stray letters and a
 * second minus sign.
 */
export function sanitizeNumberInput(raw, { allowNegative = false } = {}) {
  if (raw === null || raw === undefined) return '';
  let text = String(raw).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const negative = allowNegative && text.startsWith('-');
  text = text.replace(/-/g, '');
  const firstDot = text.indexOf('.');
  if (firstDot !== -1) {
    text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '');
  }
  return negative ? `-${text}` : text;
}

export function formatMoney(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Short money for chart axes and dense rows: $12.5K, $480K, $1.3M. */
export function formatMoneyCompact(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const scaled = (size, unit, threshold) => {
    const digits = abs < threshold ? 1 : 0;
    const shown = (abs / size).toFixed(digits).replace(/\.0$/, '');
    return `${sign}$${shown}${unit}`;
  };
  if (abs >= 1e9) return scaled(1e9, 'B', 1e10);
  if (abs >= 1e6) return scaled(1e6, 'M', 1e8);
  if (abs >= 1e3) return scaled(1e3, 'K', 1e5);
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// Rate conversion
// ---------------------------------------------------------------------------

/**
 * Nominal annual rate → effective annual rate (EAR).
 * A 12% nominal rate compounded monthly is 12.68% effective, not 12%.
 */
export function effectiveAnnualRate({ nominalRate = 0, compounding = 1, continuous = false } = {}) {
  const rate = Number(nominalRate) || 0;
  if (continuous) return Math.expm1(rate);
  const m = Math.max(1, Number(compounding) || 1);
  const base = 1 + rate / m;
  if (base <= 0) return -1;
  return Math.pow(base, m) - 1;
}

/**
 * The rate that actually applies to one *payment* period, which is not the
 * same as the nominal rate divided by the payment frequency unless the
 * compounding frequency matches it.
 *
 * r = 6% compounded annually, paid monthly → (1.06)^(1/12) − 1 = 0.4868%/mo,
 * not 0.5%/mo.
 */
export function periodicRate({
  nominalRate = 0,
  compounding = 1,
  paymentsPerYear = 1,
  continuous = false,
} = {}) {
  const rate = Number(nominalRate) || 0;
  const ppy = Math.max(1, Number(paymentsPerYear) || 1);
  if (continuous) return Math.expm1(rate / ppy);
  const m = Math.max(1, Number(compounding) || 1);
  const base = 1 + rate / m;
  if (base <= 0) return -1;
  return Math.pow(base, m / ppy) - 1;
}

/** Fisher equation: the real (after-inflation) rate implied by a nominal one. */
export function realRate({ nominalRate = 0, inflationRate = 0 } = {}) {
  const inflation = Number(inflationRate) || 0;
  if (1 + inflation === 0) return 0;
  return (1 + (Number(nominalRate) || 0)) / (1 + inflation) - 1;
}

/** Discounts a nominal amount back to today's purchasing power. */
export function realValue(value, inflationRate = 0, years = 0) {
  const inflation = Number(inflationRate) || 0;
  if (1 + inflation === 0) return Number(value) || 0;
  return (Number(value) || 0) / Math.pow(1 + inflation, Math.max(0, Number(years) || 0));
}

/** (1 + rate)^periods − 1, accurate for very small rates. */
export function compoundGrowth(rate, periods) {
  const i = Number(rate) || 0;
  const n = Number(periods) || 0;
  if (!n || i === 0) return 0;
  if (1 + i > 0 && Math.abs(i) < 0.05) return Math.expm1(n * Math.log1p(i));
  return Math.pow(1 + i, n) - 1;
}

// ---------------------------------------------------------------------------
// Interest factors
// ---------------------------------------------------------------------------

/**
 * Every standard factor, named as "take X, get Y": `AtoF` converts a uniform
 * series into a future value. All of them are safe at i = 0, and the uniform
 * series / gradient factors already include the annuity-due adjustment when
 * `timing` is BEGIN.
 */
export function factors(rate, periods, timing = TIMING.END) {
  const i = Number(rate) || 0;
  const n = Math.max(0, Math.floor(Number(periods) || 0));
  const zero = Math.abs(i) < NEAR_ZERO;
  const growth = compoundGrowth(i, n); // (1+i)^n − 1
  const compound = growth + 1; // (1+i)^n
  const due = timing === TIMING.BEGIN ? 1 + i : 1;

  // Ordinary (end-of-period) factors first — the due adjustment is derived
  // from these so the two can never disagree.
  // With no periods there is nothing to spread over, so every uniform-series
  // factor is 0 rather than Infinity.
  const none = n === 0;
  const spreadable = !none && (zero || growth !== 0);
  const AtoF0 = none ? 0 : zero ? n : growth / i;
  const FtoA0 = none ? 0 : zero ? 1 / n : growth === 0 ? 0 : i / growth;
  const AtoP0 = none ? 0 : zero ? n : growth / (i * compound);
  const PtoA0 = none ? 0 : zero ? 1 / n : growth === 0 ? 0 : (i * compound) / growth;
  const GtoF0 = zero ? (n * (n - 1)) / 2 : (growth - i * n) / (i * i);
  const GtoP0 = compound === 0 ? 0 : GtoF0 / compound;
  // A/G is P/G followed by A/P, so the due adjustment cancels out.
  const GtoA0 = spreadable ? GtoP0 * PtoA0 : 0;

  return {
    rate: i,
    periods: n,
    timing,
    compound,
    /** (F/P, i, n) */
    PtoF: compound,
    /** (P/F, i, n) */
    FtoP: compound === 0 ? 0 : 1 / compound,
    /** (F/A, i, n) */
    AtoF: AtoF0 * due,
    /** (A/F, i, n) */
    FtoA: due === 0 ? 0 : FtoA0 / due,
    /** (P/A, i, n) */
    AtoP: AtoP0 * due,
    /** (A/P, i, n) */
    PtoA: due === 0 ? 0 : PtoA0 / due,
    /** (F/G, i, n) */
    GtoF: GtoF0 * due,
    /** (P/G, i, n) */
    GtoP: GtoP0 * due,
    /** (A/G, i, n) */
    GtoA: GtoA0,
  };
}

function describeFactor(sourceLetter, target) {
  const targetLetter = TARGET_LETTER[target] || 'F';
  if (sourceLetter === targetLetter) return '×1';
  return `(${targetLetter}/${sourceLetter}, i, n)`;
}

/**
 * The value, in today's dollars, of a uniform gradient one period from now.
 * Used by the UI to explain the gradient convention (0, G, 2G, … appears from
 * the *second* period, which is the textbook definition).
 */
export function gradientSchedule(gradient, periods) {
  const n = Math.max(0, Math.floor(Number(periods) || 0));
  const g = Number(gradient) || 0;
  return Array.from({ length: n }, (_, index) => ({ period: index + 1, value: g * index }));
}

// ---------------------------------------------------------------------------
// Time-value solver
// ---------------------------------------------------------------------------

function buildSeries({ find, i, n, timing, present, periodic, future, gradient }) {
  const points = [];
  for (let k = 0; k <= n; k += 1) {
    const fk = factors(i, k, timing);
    let value;
    if (find === FIND.PRESENT) {
      // Present worth of everything received up to period k, plus P itself.
      // At k = n this equals the headline answer.
      value = present + periodic * fk.AtoP + gradient * fk.GtoP + (k >= n ? future * fk.FtoP : 0);
    } else {
      // Accumulating balance. A future sum only lands at the end (think: the
      // face value of a bond), so it contributes nothing before period n.
      value = present * fk.PtoF + periodic * fk.AtoF + gradient * fk.GtoF + (k >= n ? future : 0);
    }
    points.push({ period: k, value: Number.isFinite(value) ? value : 0 });
  }
  return points;
}

/**
 * Converts any mix of P / A / F / G into the value at the requested point in
 * time.
 *
 * @returns {{answer: number, series: Array<{period: number, value: number}>,
 *            components: Array<object>, warnings: string[]}}
 */
export function solveCashFlow({
  find = FIND.FUTURE,
  present = 0,
  periodic = 0,
  future = 0,
  gradient = 0,
  rate = 0,
  periods = 0,
  timing = TIMING.END,
} = {}) {
  const i = Number(rate) || 0;
  const n = Math.max(0, Math.floor(Number(periods) || 0));
  const P = Number(present) || 0;
  const A = Number(periodic) || 0;
  const F = Number(future) || 0;
  const G = Number(gradient) || 0;
  const f = factors(i, n, timing);
  const warnings = [];

  const hasAmounts = P !== 0 || A !== 0 || F !== 0 || G !== 0;
  if (!hasAmounts) {
    warnings.push('Enter at least one amount (P, A, F or G) to see a result.');
  }
  if (n === 0 && (A !== 0 || G !== 0)) {
    warnings.push('Periodic (A) and gradient (G) amounts need a number of periods before they can be converted.');
  }
  if (hasAmounts && Math.abs(i) < NEAR_ZERO) {
    warnings.push('Interest rate is 0%, so nothing compounds or discounts — the result is a straight sum.');
  }
  if (hasAmounts && n === 0 && (find === FIND.PRESENT || find === FIND.FUTURE) && F !== 0 && P !== 0) {
    warnings.push('With zero periods, P and F are interchangeable.');
  }

  const sources = [
    { key: 'present', symbol: 'P', label: 'Present value', input: P, to: { future: f.PtoF, present: 1, periodic: f.PtoA } },
    { key: 'periodic', symbol: 'A', label: 'Periodic payment', input: A, to: { future: f.AtoF, present: f.AtoP, periodic: 1 } },
    { key: 'future', symbol: 'F', label: 'Future value', input: F, to: { future: 1, present: f.FtoP, periodic: f.FtoA } },
    { key: 'gradient', symbol: 'G', label: 'Gradient', input: G, to: { future: f.GtoF, present: f.GtoP, periodic: f.GtoA } },
  ];
  const targetKey = find === FIND.PRESENT ? 'present' : find === FIND.PERIODIC ? 'periodic' : 'future';

  const components = sources
    .filter((source) => source.input !== 0)
    .map((source) => {
      const factor = source.to[targetKey];
      const raw = source.input * factor;
      return {
        key: source.key,
        symbol: source.symbol,
        label: source.label,
        input: source.input,
        factor,
        factorLabel: describeFactor(source.symbol, find),
        value: Number.isFinite(raw) ? raw : 0,
      };
    });

  const rawAnswer = components.reduce((sum, component) => sum + component.value, 0);
  const answer = Number.isFinite(rawAnswer) ? rawAnswer : 0;
  if (Number.isFinite(rawAnswer) === false) {
    warnings.push('These inputs do not produce a finite result — check the interest rate and number of periods.');
  }

  return {
    answer,
    series: buildSeries({ find, i, n, timing, present: P, periodic: A, future: F, gradient: G }),
    components,
    warnings,
    rate: i,
    periods: n,
    timing,
    factors: f,
  };
}

// ---------------------------------------------------------------------------
// Accumulation projection (tax + inflation aware)
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Grows a balance period by period, applying tax and inflation the way they
 * actually work:
 *
 *  - `ANNUAL`   — interest is taxed every period, so the account compounds at
 *                 the *after-tax* rate. This is the real drag on a brokerage
 *                 account, and it is why "7% for 30 years" is optimistic.
 *  - `DEFERRED` — the account compounds untaxed; tax is owed once at the end
 *                 on everything above the contributions.
 *  - `NONE`     — never taxed (Roth / ISA / TFSA).
 *
 * Inflation never touches the account; it only re-expresses the result in
 * today's purchasing power, because that is the number that answers "will this
 * be enough?".
 */
export function projectAnnuity({
  initialDeposit = 0,
  periodicDeposit = 0,
  annualRate = 0,
  compounding = 12,
  paymentsPerYear = 12,
  years = 0,
  timing = TIMING.END,
  contributionGrowthRate = 0,
  inflationRate = 0,
  marginalTaxRate = 0,
  taxTreatment = TAX_TREATMENT.ANNUAL,
  continuous = false,
} = {}) {
  const ppy = Math.max(1, Math.round(Number(paymentsPerYear) || 1));
  const totalYears = Math.max(0, Number(years) || 0);
  const totalPeriods = Math.round(totalYears * ppy);
  const nominalAnnual = Number(annualRate) || 0;
  const inflation = Number(inflationRate) || 0;
  const taxRate = clamp(Number(marginalTaxRate) || 0, 0, 1);
  const contributionGrowth = Number(contributionGrowthRate) || 0;
  const begin = timing === TIMING.BEGIN;
  const taxesEveryYear = taxTreatment === TAX_TREATMENT.ANNUAL;

  const i = periodicRate({ nominalRate: nominalAnnual, compounding, paymentsPerYear: ppy, continuous });
  const netPeriodicRate = taxesEveryYear ? i * (1 - taxRate) : i;

  let balance = Number(initialDeposit) || 0;
  let cumContributions = 0;
  let cumInterest = 0;
  let cumTax = 0;
  const rows = [];

  for (let period = 1; period <= totalPeriods; period += 1) {
    const yearIndex = Math.floor((period - 1) / ppy);
    const contribution = (Number(periodicDeposit) || 0) * Math.pow(1 + contributionGrowth, yearIndex);
    const startBalance = balance;

    if (begin) balance += contribution;
    const grossInterest = balance * i;
    const tax = taxesEveryYear ? grossInterest * taxRate : 0;
    balance += grossInterest - tax;
    if (!begin) balance += contribution;

    cumContributions += contribution;
    cumInterest += grossInterest;
    cumTax += tax;

    const yearsElapsed = period / ppy;
    rows.push({
      period,
      year: yearIndex + 1,
      yearsElapsed,
      startBalance,
      contribution,
      grossInterest,
      netInterest: grossInterest - tax,
      tax,
      endBalance: balance,
      realEndBalance: realValue(balance, inflation, yearsElapsed),
      cumContributions,
      cumInterest,
      cumTax,
    });
  }

  const nominalBalance = balance;
  const deferredTaxDue =
    taxTreatment === TAX_TREATMENT.DEFERRED
      ? Math.max(0, nominalBalance - cumContributions) * taxRate
      : 0;
  const afterTaxBalance = nominalBalance - deferredTaxDue;
  const realBalance = realValue(nominalBalance, inflation, totalYears);
  const effective = effectiveAnnualRate({ nominalRate: nominalAnnual, compounding, continuous });
  const netEffective = taxesEveryYear
    ? effectiveAnnualRate({ nominalRate: nominalAnnual * (1 - taxRate), compounding, continuous })
    : effective;

  return {
    rows,
    years: summarizeByYear(rows, ppy),
    periodicRate: i,
    netPeriodicRate,
    paymentsPerYear: ppy,
    totalPeriods,
    totalYears,
    summary: {
      nominalBalance,
      afterTaxBalance,
      realBalance,
      realAfterTaxBalance: realValue(afterTaxBalance, inflation, totalYears),
      totalContributions: cumContributions,
      totalInterest: cumInterest,
      recurringTax: cumTax,
      deferredTaxDue,
      totalTax: cumTax + deferredTaxDue,
      inflationErosion: nominalBalance - realBalance,
      effectiveAnnualRate: effective,
      netAnnualRate: netEffective,
      realAnnualRate: realRate({ nominalRate: effective, inflationRate: inflation }),
      growthShare: nominalBalance > 0 ? Math.max(0, nominalBalance - cumContributions) / nominalBalance : 0,
      /** The classic 4% rule: a rough annual income this balance could support. */
      safeAnnualWithdrawal: afterTaxBalance * 0.04,
    },
  };
}

/** Collapses period rows into one row per year for display. */
export function summarizeByYear(rows /* , paymentsPerYear = 12 */) {
  const years = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    let bucket = years[years.length - 1];
    if (!bucket || bucket.year !== row.year) {
      bucket = {
        year: row.year,
        startBalance: row.startBalance,
        contributions: 0,
        interest: 0,
        tax: 0,
        endBalance: row.endBalance,
        realEndBalance: row.realEndBalance,
        cumContributions: row.cumContributions,
        cumInterest: row.cumInterest,
        cumTax: row.cumTax,
      };
      years.push(bucket);
    }
    bucket.contributions += row.contribution;
    bucket.interest += row.grossInterest;
    bucket.tax += row.tax;
    bucket.endBalance = row.endBalance;
    bucket.realEndBalance = row.realEndBalance;
    bucket.cumContributions = row.cumContributions;
    bucket.cumInterest = row.cumInterest;
    bucket.cumTax = row.cumTax;
  });
  return years;
}

/**
 * The chart series for a projection: the nominal balance, the same balance in
 * today's dollars, and what you actually paid in. Three lines answer the three
 * questions people actually have ("how much will I have?", "will it be worth
 * anything?", "how much of that was me?").
 */
export function projectionSeries(projection) {
  const years = projection?.years || [];
  const openingBalance = Number(projection?.rows?.[0]?.startBalance) || 0;
  const labels = ['Year 0'];
  const nominal = [openingBalance];
  const real = [openingBalance];
  const contributions = [openingBalance];

  years.forEach((year) => {
    labels.push(`Year ${year.year}`);
    nominal.push(year.endBalance);
    real.push(year.realEndBalance);
    contributions.push(openingBalance + year.cumContributions);
  });

  return { labels, nominal, real, contributions };
}
