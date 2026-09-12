import {
  FIND,
  TAX_TREATMENT,
  TIMING,
  compoundGrowth,
  effectiveAnnualRate,
  factors,
  formatMoneyCompact,
  gradientSchedule,
  parseNumberInput,
  parseRateInput,
  periodicRate,
  projectionSeries,
  projectAnnuity,
  realRate,
  realValue,
  sanitizeNumberInput,
  solveCashFlow,
  summarizeByYear,
} from './annuityEngine';

describe('input parsing', () => {
  it.each([
    ['0', 0],
    ['10000', 10000],
    ['1,234.5', 1234.5],
    ['abc', 0],
    ['', 0],
    [undefined, 0],
    [null, 0],
    ['2.5', 2.5],
  ])('parses %p as %p', (raw, expected) => {
    expect(parseNumberInput(raw)).toBe(expected);
  });

  it('treats the rate as a percentage when that is the unit the UI collected', () => {
    expect(parseRateInput('5', 'percent')).toBeCloseTo(0.05, 12);
    expect(parseRateInput('0.05', 'decimal')).toBeCloseTo(0.05, 12);
  });

  it('keeps numeric fields honest while typing', () => {
    expect(sanitizeNumberInput('12a3')).toBe('123');
    expect(sanitizeNumberInput('1.2.3')).toBe('1.23');
    expect(sanitizeNumberInput('-5')).toBe('5');
    expect(sanitizeNumberInput('-5', { allowNegative: true })).toBe('-5');
    expect(sanitizeNumberInput('1,000')).toBe('1000');
    expect(sanitizeNumberInput('.')).toBe('.');
  });

  it('formats large money compactly for chart axes', () => {
    expect(formatMoneyCompact(950)).toBe('$950');
    expect(formatMoneyCompact(12500)).toBe('$12.5K');
    expect(formatMoneyCompact(250000)).toBe('$250K');
    expect(formatMoneyCompact(1250000)).toBe('$1.3M');
    expect(formatMoneyCompact(-2000000)).toBe('-$2M');
    expect(formatMoneyCompact(NaN)).toBe('—');
  });
});

describe('rate conversion', () => {
  it('converts a nominal annual rate to an effective annual rate', () => {
    // 12% compounded monthly is 12.68% effective.
    expect(effectiveAnnualRate({ nominalRate: 0.12, compounding: 12 })).toBeCloseTo(0.126825, 6);
    expect(effectiveAnnualRate({ nominalRate: 0.12, compounding: 1 })).toBeCloseTo(0.12, 12);
  });

  it('converts a nominal annual rate to the rate per payment period', () => {
    // 6% compounded annually, paid monthly — NOT 0.5%/month.
    expect(periodicRate({ nominalRate: 0.06, compounding: 1, paymentsPerYear: 12 })).toBeCloseTo(
      0.00486755,
      6,
    );
    // When compounding matches the payment frequency the naive division is right.
    expect(periodicRate({ nominalRate: 0.06, compounding: 12, paymentsPerYear: 12 })).toBeCloseTo(
      0.005,
      12,
    );
  });

  it('supports continuous compounding', () => {
    expect(effectiveAnnualRate({ nominalRate: 0.05, continuous: true })).toBeCloseTo(
      Math.expm1(0.05),
      12,
    );
  });

  it('uses the Fisher equation for the real rate', () => {
    expect(realRate({ nominalRate: 0.07, inflationRate: 0.025 })).toBeCloseTo(0.043902, 6);
    expect(realRate({ nominalRate: 0.02, inflationRate: 0.03 })).toBeLessThan(0);
  });

  it('discounts nominal dollars into purchasing power', () => {
    expect(realValue(1000, 0.03, 10)).toBeCloseTo(744.0939, 3);
    expect(realValue(1000, 0, 10)).toBe(1000);
  });
});

describe('interest factors', () => {
  it('matches the standard table values', () => {
    const f = factors(0.05, 10);
    expect(f.PtoF).toBeCloseTo(1.6288946268, 8);
    expect(f.FtoP).toBeCloseTo(0.6139132535, 8);
    expect(f.AtoF).toBeCloseTo(12.5778925355, 8);
    expect(f.FtoA).toBeCloseTo(0.0795045777, 8);
    expect(f.AtoP).toBeCloseTo(7.7217349292, 8);
    expect(f.PtoA).toBeCloseTo(0.129504575, 8);
    expect(f.GtoF).toBeCloseTo(51.55785071, 6);
  });

  it('is defined at a 0% interest rate instead of returning NaN', () => {
    const f = factors(0, 10);
    expect(f.PtoF).toBe(1);
    expect(f.FtoP).toBe(1);
    expect(f.AtoF).toBe(10);
    expect(f.FtoA).toBeCloseTo(0.1, 12);
    expect(f.AtoP).toBe(10);
    expect(f.PtoA).toBeCloseTo(0.1, 12);
    expect(f.GtoF).toBeCloseTo(45, 12); // n(n−1)/2 — a straight sum of 0,1,…,9
    expect(Number.isNaN(f.GtoA)).toBe(false);
    expect(f.GtoA).toBeCloseTo(4.5, 12); // average of 0,1,…,9
  });

  it('handles a zero-period annuity without dividing by zero', () => {
    const f = factors(0.05, 0);
    expect(f.FtoA).toBe(0);
    expect(f.PtoA).toBe(0);
    expect(f.AtoF).toBe(0);
    expect(f.GtoA).toBe(0);
  });

  it('scales the uniform-series factors for an annuity due', () => {
    const ordinary = factors(0.05, 10, TIMING.END);
    const due = factors(0.05, 10, TIMING.BEGIN);
    expect(due.AtoF).toBeCloseTo(ordinary.AtoF * 1.05, 10);
    expect(due.AtoP).toBeCloseTo(ordinary.AtoP * 1.05, 10);
    expect(due.FtoA).toBeCloseTo(ordinary.FtoA / 1.05, 10);
    // A/G is timing-invariant: the (1+i) in P/G and A/P cancel out.
    expect(due.GtoA).toBeCloseTo(ordinary.GtoA, 10);
  });

  it('stays accurate for very small rates', () => {
    // (1+i)^n − 1 ≈ n·i + (n·i)²/2 — a direct pow() loses precision here.
    const n = 1000;
    const i = 1e-6;
    expect(compoundGrowth(i, n)).toBeCloseTo(n * i + (n * i) ** 2 / 2, 8);
    expect(compoundGrowth(0.05, 10)).toBeCloseTo(0.6288946268, 8);
    expect(compoundGrowth(0.1, 8)).toBeCloseTo(1.1435888100, 8);
  });

  it('describes the textbook gradient convention (0, G, 2G, …)', () => {
    expect(gradientSchedule(500, 4).map((p) => p.value)).toEqual([0, 500, 1000, 1500]);
  });
});

describe('solveCashFlow', () => {
  it('REGRESSION: returns the future value of a periodic deposit at a 0% rate', () => {
    // The reported bug: $10,000/period for 10 periods at 0% answered $0.00
    // because (1+i)^n − 1 divided by i was 0/0.
    const result = solveCashFlow({
      find: FIND.FUTURE,
      periodic: 10000,
      rate: 0,
      periods: 10,
    });
    expect(result.answer).toBe(100000);
    expect(Number.isNaN(result.answer)).toBe(false);
  });

  it('finds the ordinary future value of a periodic deposit', () => {
    const result = solveCashFlow({
      find: FIND.FUTURE,
      periodic: 10000,
      rate: 0.05,
      periods: 10,
    });
    expect(result.answer).toBeCloseTo(125778.9254, 3);
  });

  it('finds a periodic deposit that reaches a future target', () => {
    const result = solveCashFlow({
      find: FIND.PERIODIC,
      future: 100000,
      rate: 0.06,
      periods: 5,
    });
    expect(result.answer).toBeCloseTo(17739.64, 2);
  });

  it('finds the present value of a future amount and of an annuity', () => {
    expect(
      solveCashFlow({ find: FIND.PRESENT, future: 10000, rate: 0.08, periods: 10 }).answer,
    ).toBeCloseTo(4631.9349, 3);
    expect(
      solveCashFlow({ find: FIND.PRESENT, periodic: 1000, rate: 0.08, periods: 10 }).answer,
    ).toBeCloseTo(6710.0814, 3);
  });

  it('adds the present value of a gradient to a base annuity', () => {
    const result = solveCashFlow({
      find: FIND.PRESENT,
      periodic: 2000,
      gradient: 500,
      rate: 0.1,
      periods: 8,
    });
    // 2000·(P/A,10%,8) + 500·(P/G,10%,8)
    expect(result.answer).toBeCloseTo(2000 * 5.334926198 + 500 * 16.0287, 1);
  });

  it('never returns NaN for any zero-rate combination', () => {
    const combos = [
      { present: 1000 },
      { periodic: 100 },
      { future: 5000 },
      { gradient: 50 },
      { present: 1000, periodic: 100, future: 5000, gradient: 50 },
    ];
    [FIND.PRESENT, FIND.PERIODIC, FIND.FUTURE].forEach((find) => {
      combos.forEach((combo) => {
        const result = solveCashFlow({ find, rate: 0, periods: 12, ...combo });
        expect(Number.isNaN(result.answer)).toBe(false);
        expect(Number.isFinite(result.answer)).toBe(true);
      });
    });
  });

  it('grows the plotted series to the headline answer at the final period', () => {
    [FIND.PRESENT, FIND.FUTURE].forEach((find) => {
      const result = solveCashFlow({
        find,
        present: 10000,
        periodic: 6000,
        future: 25000,
        gradient: 300,
        rate: 0.07,
        periods: 30,
      });
      expect(result.series).toHaveLength(31);
      expect(result.series[result.series.length - 1].value).toBeCloseTo(result.answer, 6);
    });
  });

  it('plots the accumulating balance when solving for a uniform payment', () => {
    // The answer is a single payment amount, so it cannot be an endpoint of a
    // balance curve — the curve shows the flows that payment is equivalent to.
    const inputs = {
      present: 10000,
      periodic: 6000,
      future: 25000,
      gradient: 300,
      rate: 0.07,
      periods: 30,
    };
    const periodic = solveCashFlow({ ...inputs, find: FIND.PERIODIC });
    const future = solveCashFlow({ ...inputs, find: FIND.FUTURE });
    const last = periodic.series[periodic.series.length - 1];
    expect(last.value).toBeCloseTo(future.answer, 6);
    expect(periodic.answer).toBeCloseTo(9995.13, 1);
  });

  it('values the same deposit more under annuity-due than ordinary', () => {
    const ordinary = solveCashFlow({ find: FIND.FUTURE, periodic: 100, rate: 0.05, periods: 10 });
    const due = solveCashFlow({
      find: FIND.FUTURE,
      periodic: 100,
      rate: 0.05,
      periods: 10,
      timing: TIMING.BEGIN,
    });
    expect(due.answer).toBeCloseTo(ordinary.answer * 1.05, 8);
  });

  it('explains each input’s contribution to the answer', () => {
    const result = solveCashFlow({
      find: FIND.PRESENT,
      periodic: 1000,
      future: 10000,
      rate: 0.08,
      periods: 10,
    });
    expect(result.components).toHaveLength(2);
    const periodic = result.components.find((c) => c.key === 'periodic');
    const future = result.components.find((c) => c.key === 'future');
    expect(periodic.factorLabel).toBe('(P/A, i, n)');
    expect(future.factorLabel).toBe('(P/F, i, n)');
    expect(periodic.value + future.value).toBeCloseTo(result.answer, 10);
  });

  it('warns instead of silently answering zero when nothing was entered', () => {
    const result = solveCashFlow({ find: FIND.FUTURE, rate: 0.05, periods: 10 });
    expect(result.answer).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/at least one amount/i);
  });

  it('warns when a periodic amount has no periods to spread over', () => {
    const result = solveCashFlow({ find: FIND.FUTURE, periodic: 100, rate: 0.05, periods: 0 });
    expect(result.warnings.join(' ')).toMatch(/number of periods/i);
  });

  it('flags a 0% rate so the straight-line result is not a surprise', () => {
    const result = solveCashFlow({ find: FIND.FUTURE, periodic: 100, rate: 0, periods: 5 });
    expect(result.warnings.join(' ')).toMatch(/0%/);
  });
});

describe('projectAnnuity', () => {
  const base = {
    initialDeposit: 0,
    periodicDeposit: 10000,
    annualRate: 0.05,
    compounding: 1,
    paymentsPerYear: 1,
    years: 10,
    timing: TIMING.END,
    taxTreatment: TAX_TREATMENT.NONE,
  };

  it('agrees with the (F/A, i, n) factor it is projecting', () => {
    const projection = projectAnnuity(base);
    expect(projection.summary.nominalBalance).toBeCloseTo(
      10000 * factors(0.05, 10).AtoF,
      4,
    );
    expect(projection.summary.nominalBalance).toBeCloseTo(125778.93, 2);
  });

  it('returns the straight sum of deposits at a 0% rate', () => {
    const projection = projectAnnuity({ ...base, annualRate: 0 });
    expect(projection.summary.nominalBalance).toBe(100000);
    expect(projection.summary.totalInterest).toBe(0);
  });

  it('models monthly compounding paid monthly', () => {
    const projection = projectAnnuity({
      ...base,
      periodicDeposit: 500,
      annualRate: 0.06,
      compounding: 12,
      paymentsPerYear: 12,
      years: 10,
    });
    const i = periodicRate({ nominalRate: 0.06, compounding: 12, paymentsPerYear: 12 });
    expect(projection.summary.nominalBalance).toBeCloseTo(500 * factors(i, 120).AtoF, 4);
  });

  it('compounds annually while paying monthly at the correct per-period rate', () => {
    const projection = projectAnnuity({
      ...base,
      periodicDeposit: 500,
      annualRate: 0.06,
      compounding: 1,
      paymentsPerYear: 12,
      years: 10,
    });
    const i = periodicRate({ nominalRate: 0.06, compounding: 1, paymentsPerYear: 12 });
    expect(projection.periodicRate).toBeCloseTo(i, 12);
    expect(projection.summary.nominalBalance).toBeCloseTo(500 * factors(i, 120).AtoF, 4);
    // Paying at the end of the month earns less than monthly compounding.
    expect(projection.summary.nominalBalance).toBeLessThan(500 * factors(0.005, 120).AtoF);
  });

  it('earns one extra period of interest when deposits land at the start', () => {
    const end = projectAnnuity(base);
    const begin = projectAnnuity({ ...base, timing: TIMING.BEGIN });
    expect(begin.summary.nominalBalance).toBeCloseTo(10000 * factors(0.05, 10, TIMING.BEGIN).AtoF, 4);
    expect(begin.summary.nominalBalance).toBeGreaterThan(end.summary.nominalBalance);
  });

  it('escalates contributions with the annual raise rate', () => {
    const flat = projectAnnuity(base);
    const escalating = projectAnnuity({ ...base, contributionGrowthRate: 0.03 });
    expect(escalating.summary.totalContributions).toBeGreaterThan(flat.summary.totalContributions);
    expect(escalating.years[1].contributions).toBeCloseTo(10000 * 1.03, 6);
  });

  it('taxes the interest every year in a taxable account', () => {
    const taxable = projectAnnuity({
      ...base,
      marginalTaxRate: 0.25,
      taxTreatment: TAX_TREATMENT.ANNUAL,
    });
    // Compounding at the after-tax rate is what actually drags the balance.
    const netRate = periodicRate({ nominalRate: 0.05 * 0.75, compounding: 1, paymentsPerYear: 1 });
    expect(taxable.summary.nominalBalance).toBeCloseTo(10000 * factors(netRate, 10).AtoF, 4);
    expect(taxable.summary.nominalBalance).toBeLessThan(projectAnnuity(base).summary.nominalBalance);
    expect(taxable.summary.recurringTax).toBeGreaterThan(0);
    expect(taxable.summary.deferredTaxDue).toBe(0);
    // What you keep is the taxed balance — no further bill.
    expect(taxable.summary.afterTaxBalance).toBeCloseTo(taxable.summary.nominalBalance, 6);
  });

  it('defers tax to withdrawal on everything above the contributions', () => {
    const deferred = projectAnnuity({
      ...base,
      marginalTaxRate: 0.25,
      taxTreatment: TAX_TREATMENT.DEFERRED,
    });
    const untaxed = projectAnnuity(base);
    // Growth inside the account is identical to tax-free…
    expect(deferred.summary.nominalBalance).toBeCloseTo(untaxed.summary.nominalBalance, 4);
    // …but the final bill is 25% of the earnings.
    expect(deferred.summary.deferredTaxDue).toBeCloseTo(
      (untaxed.summary.nominalBalance - untaxed.summary.totalContributions) * 0.25,
      4,
    );
    expect(deferred.summary.afterTaxBalance).toBeCloseTo(
      untaxed.summary.nominalBalance - deferred.summary.deferredTaxDue,
      4,
    );
    expect(deferred.summary.recurringTax).toBe(0);
  });

  it('never taxes a tax-free account', () => {
    const projection = projectAnnuity({ ...base, marginalTaxRate: 0.4 });
    expect(projection.summary.totalTax).toBe(0);
    expect(projection.summary.afterTaxBalance).toBe(projection.summary.nominalBalance);
  });

  it('re-expresses the balance in today’s dollars and reports the erosion', () => {
    const projection = projectAnnuity({ ...base, inflationRate: 0.025 });
    expect(projection.summary.realBalance).toBeCloseTo(
      projection.summary.nominalBalance / 1.025 ** 10,
      4,
    );
    expect(projection.summary.inflationErosion).toBeGreaterThan(0);
    expect(projection.summary.realAnnualRate).toBeCloseTo(
      (1.05 / 1.025) - 1,
      6,
    );
  });

  it('reports the effective annual rate actually earned', () => {
    const projection = projectAnnuity({ ...base, compounding: 12 });
    expect(projection.summary.effectiveAnnualRate).toBeCloseTo(
      effectiveAnnualRate({ nominalRate: 0.05, compounding: 12 }),
      12,
    );
    expect(projection.summary.effectiveAnnualRate).toBeGreaterThan(0.05);
  });

  it('produces one row per period and one bucket per year', () => {
    const projection = projectAnnuity({ ...base, paymentsPerYear: 12, compounding: 12, years: 3 });
    expect(projection.rows).toHaveLength(36);
    expect(projection.years).toHaveLength(3);
    expect(projection.years[0].year).toBe(1);
    expect(projection.years[2].cumContributions).toBeCloseTo(projection.summary.totalContributions, 4);
    expect(projection.years[2].endBalance).toBeCloseTo(projection.summary.nominalBalance, 4);
  });

  it('carries each year’s contributions, interest and tax into its bucket', () => {
    const rows = [
      { year: 1, startBalance: 0, endBalance: 10, realEndBalance: 9, contribution: 5, grossInterest: 5, tax: 1, cumContributions: 5, cumInterest: 5, cumTax: 1 },
      { year: 1, startBalance: 10, endBalance: 21, realEndBalance: 19, contribution: 5, grossInterest: 6, tax: 1.2, cumContributions: 10, cumInterest: 11, cumTax: 2.2 },
      { year: 2, startBalance: 21, endBalance: 33, realEndBalance: 30, contribution: 5, grossInterest: 7, tax: 1.4, cumContributions: 15, cumInterest: 18, cumTax: 3.6 },
    ];
    const years = summarizeByYear(rows, 2);
    expect(years).toHaveLength(2);
    expect(years[0].contributions).toBe(10);
    expect(years[0].interest).toBeCloseTo(11, 10);
    expect(years[0].tax).toBeCloseTo(2.2, 10);
    expect(years[0].endBalance).toBe(21);
    expect(years[1].endBalance).toBe(33);
  });

  it('ignores a missing or malformed argument object', () => {
    const projection = projectAnnuity();
    expect(projection.summary.nominalBalance).toBe(0);
    expect(projection.rows).toHaveLength(0);
    expect(projection.years).toEqual([]);
  });

  it('handles a lump sum with no deposits', () => {
    const projection = projectAnnuity({ ...base, periodicDeposit: 0, initialDeposit: 10000 });
    expect(projection.summary.nominalBalance).toBeCloseTo(10000 * 1.05 ** 10, 4);
    expect(projection.summary.totalContributions).toBe(0);
  });

  it('supports continuous compounding', () => {
    const lump = projectAnnuity({
      ...base,
      periodicDeposit: 0,
      initialDeposit: 1000,
      annualRate: 0.05,
      continuous: true,
    });
    expect(lump.periodicRate).toBeCloseTo(Math.expm1(0.05), 12);
    expect(lump.summary.nominalBalance).toBeCloseTo(1000 * Math.exp(0.5), 4);

    const deposits = projectAnnuity({
      ...base,
      initialDeposit: 0,
      periodicDeposit: 500,
      paymentsPerYear: 12,
      compounding: 365,
      continuous: true,
      years: 10,
    });
    const i = periodicRate({ nominalRate: 0.05, continuous: true, paymentsPerYear: 12 });
    expect(deposits.summary.nominalBalance).toBeCloseTo(500 * factors(i, 120).AtoF, 4);
  });
});

describe('projectionSeries', () => {
  it('plots the opening balance, each year’s balance, and money paid in', () => {
    const projection = projectAnnuity({
      initialDeposit: 1000,
      periodicDeposit: 100,
      annualRate: 0.05,
      compounding: 1,
      paymentsPerYear: 1,
      years: 3,
      taxTreatment: TAX_TREATMENT.NONE,
    });
    const series = projectionSeries(projection);
    expect(series.labels).toEqual(['Year 0', 'Year 1', 'Year 2', 'Year 3']);
    expect(series.nominal).toHaveLength(4);
    expect(series.nominal[0]).toBe(1000);
    expect(series.contributions[3]).toBeCloseTo(
      1000 + projection.summary.totalContributions,
      6,
    );
    const last = series.nominal.length - 1;
    expect(series.nominal[last]).toBeCloseTo(projection.summary.nominalBalance, 4);
    expect(series.real[last]).toBeCloseTo(projection.summary.realBalance, 4);
    // The gap between the balance and what you paid in is the growth.
    expect(series.nominal[last]).toBeGreaterThan(series.contributions[last]);
  });

  it('survives an empty projection', () => {
    expect(projectionSeries(projectAnnuity())).toEqual({
      labels: ['Year 0'],
      nominal: [0],
      real: [0],
      contributions: [0],
    });
  });
});
