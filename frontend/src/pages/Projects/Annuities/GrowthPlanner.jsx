import React, { useMemo, useState } from 'react';
import AnnuityChart from './AnnuityChart';
import RevealBand from './RevealBand';
import {
  TAX_TREATMENT,
  TAX_TREATMENT_LABELS,
  TIMING,
  formatMoney,
  formatPercent,
  parseNumberInput,
  parseRateInput,
  projectAnnuity,
  projectionSeries,
  sanitizeNumberInput,
} from './annuityEngine';
import './GrowthPlanner.css';

const FREQUENCIES = [
  { value: '52', label: 'Weekly' },
  { value: '26', label: 'Every 2 weeks' },
  { value: '12', label: 'Monthly' },
  { value: '4', label: 'Quarterly' },
  { value: '2', label: 'Twice a year' },
  { value: '1', label: 'Once a year' },
];

const COMPOUNDING = [
  { value: '1', label: 'Annually' },
  { value: '2', label: 'Twice a year' },
  { value: '4', label: 'Quarterly' },
  { value: '12', label: 'Monthly' },
  { value: '365', label: 'Daily' },
  { value: 'continuous', label: 'Continuously' },
];

const RATE_PRESETS = [
  { label: 'Savings 3%', value: '3' },
  { label: 'Balanced 7%', value: '7' },
  { label: 'Equities 10%', value: '10' },
];

const DEFAULT_INPUTS = {
  initialDeposit: '10000',
  periodicDeposit: '500',
  paymentsPerYear: '12',
  years: '30',
  annualRate: '7',
  compounding: '12',
  timing: TIMING.END,
  contributionGrowth: '0',
  inflation: '2.5',
  taxRate: '22',
  taxTreatment: TAX_TREATMENT.ANNUAL,
};

function PlannerField({ id, label, hint, suffix, children }) {
  return (
    <div className="annuities-field">
      <div className="annuities-field-head">
        <label className="annuities-field-label" htmlFor={id}>
          {label}
        </label>
      </div>
      <div className="annuities-field-control">
        {children}
        {suffix && <span className="annuities-field-suffix">{suffix}</span>}
      </div>
      {hint && <p className="annuities-field-hint">{hint}</p>}
    </div>
  );
}

function Metric({ label, value, hint, tone = '' }) {
  return (
    <div className={`annuities-metric${tone ? ` is-${tone}` : ''}`}>
      <span className="annuities-metric-label">{label}</span>
      <span className="annuities-metric-value">{value}</span>
      {hint && <span className="annuities-metric-hint">{hint}</span>}
    </div>
  );
}

/**
 * Long-horizon accumulation with the three forces a "7% for 30 years" headline
 * ignores: the interest rate you are actually paid, the tax taken out of it,
 * and the inflation that shrinks what is left.
 */
function GrowthPlanner() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);

  const setField = (key, raw, allowNegative = false) =>
    setInputs((previous) => ({ ...previous, [key]: sanitizeNumberInput(raw, { allowNegative }) }));

  const projection = useMemo(() => {
    const continuous = inputs.compounding === 'continuous';
    return projectAnnuity({
      initialDeposit: parseNumberInput(inputs.initialDeposit),
      periodicDeposit: parseNumberInput(inputs.periodicDeposit),
      annualRate: parseRateInput(inputs.annualRate, 'percent'),
      compounding: continuous ? 365 : parseNumberInput(inputs.compounding),
      continuous,
      paymentsPerYear: parseNumberInput(inputs.paymentsPerYear),
      years: parseNumberInput(inputs.years),
      timing: inputs.timing,
      contributionGrowthRate: parseRateInput(inputs.contributionGrowth, 'percent'),
      inflationRate: parseRateInput(inputs.inflation, 'percent'),
      marginalTaxRate: parseRateInput(inputs.taxRate, 'percent'),
      taxTreatment: inputs.taxTreatment,
    });
  }, [inputs]);

  const { summary } = projection;
  const series = useMemo(() => projectionSeries(projection), [projection]);
  const growth = Math.max(0, summary.nominalBalance - summary.totalContributions);

  const chartSeries = [
    { label: 'Balance', data: series.nominal, color: '--fg-blue', fill: true, width: 2.5 },
    { label: 'In today’s dollars', data: series.real, color: '--fg-mint', dashed: true },
    { label: 'What you paid in', data: series.contributions, color: '--fg-orange', dashed: true },
  ];

  return (
    <>
      <RevealBand
        tone="surface"
        eyebrow="Growth planner"
        title="What your money becomes"
        description="Interest, compounding, tax and inflation all pull in different directions. Set the assumptions and watch which one wins."
        actions={
          <button
            type="button"
            className="annuities-btn annuities-btn--outline"
            onClick={() => setInputs(DEFAULT_INPUTS)}
          >
            Reset to defaults
          </button>
        }
      >
        <div className="annuities-planner-groups annuities-stagger">
          <section className="annuities-planner-group" aria-label="What you put in">
            <h3 className="annuities-planner-group-title">What you put in</h3>
            <div className="annuities-fields">
              <PlannerField id="gp-initial" label="Starting balance" hint="What is already invested today.">
                <input
                  id="gp-initial"
                  type="text"
                  inputMode="decimal"
                  value={inputs.initialDeposit}
                  placeholder="0"
                  onChange={(event) => setField('initialDeposit', event.target.value)}
                />
              </PlannerField>

              <PlannerField
                id="gp-periodic"
                label="Regular deposit"
                hint="Added at the start or end of every period."
              >
                <input
                  id="gp-periodic"
                  type="text"
                  inputMode="decimal"
                  value={inputs.periodicDeposit}
                  placeholder="0"
                  onChange={(event) => setField('periodicDeposit', event.target.value)}
                />
              </PlannerField>

              <PlannerField id="gp-frequency" label="How often you deposit">
                <select
                  id="gp-frequency"
                  value={inputs.paymentsPerYear}
                  onChange={(event) => setField('paymentsPerYear', event.target.value)}
                >
                  {FREQUENCIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </PlannerField>

              <PlannerField id="gp-years" label="Years invested">
                <input
                  id="gp-years"
                  type="text"
                  inputMode="numeric"
                  value={inputs.years}
                  placeholder="30"
                  onChange={(event) => setField('years', event.target.value)}
                />
              </PlannerField>

              <PlannerField
                id="gp-escalation"
                label="Deposit increase each year"
                hint="Raise your contribution with your salary."
                suffix="%"
              >
                <input
                  id="gp-escalation"
                  type="text"
                  inputMode="decimal"
                  value={inputs.contributionGrowth}
                  placeholder="0"
                  onChange={(event) => setField('contributionGrowth', event.target.value)}
                />
              </PlannerField>

              <div className="annuities-choice">
                <span className="annuities-field-label">Payments land</span>
                <div className="annuities-choice-options" role="group" aria-label="Payment timing">
                  {[TIMING.END, TIMING.BEGIN].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`annuities-pill${inputs.timing === option ? ' is-active' : ''}`}
                      aria-pressed={inputs.timing === option}
                      onClick={() => setInputs((previous) => ({ ...previous, timing: option }))}
                    >
                      {option === TIMING.END ? 'End of period' : 'Start of period'}
                    </button>
                  ))}
                </div>
                <p className="annuities-field-hint">
                  Paying at the start earns one extra period of interest every time.
                </p>
              </div>
            </div>
          </section>

          <section className="annuities-planner-group" aria-label="What it earns">
            <h3 className="annuities-planner-group-title">What it earns</h3>
            <div className="annuities-fields">
              <PlannerField
                id="gp-rate"
                label="Annual interest rate"
                hint="The nominal rate you are quoted, before tax and inflation."
                suffix="%"
              >
                <input
                  id="gp-rate"
                  type="text"
                  inputMode="decimal"
                  value={inputs.annualRate}
                  placeholder="7"
                  onChange={(event) => setField('annualRate', event.target.value)}
                />
              </PlannerField>

              <PlannerField
                id="gp-compounding"
                label="Compounded"
                hint="A 7% rate compounded monthly is really 7.23%."
              >
                <select
                  id="gp-compounding"
                  value={inputs.compounding}
                  onChange={(event) => setField('compounding', event.target.value)}
                >
                  {COMPOUNDING.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </PlannerField>

              <div className="annuities-choice">
                <span className="annuities-field-label">Quick rates</span>
                <div className="annuities-choice-options">
                  {RATE_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={`annuities-pill${inputs.annualRate === preset.value ? ' is-active' : ''}`}
                      onClick={() => setField('annualRate', preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p className="annuities-field-hint">
                  Long-run averages, not promises. Markets do not deliver them evenly.
                </p>
              </div>
            </div>
          </section>

          <section className="annuities-planner-group" aria-label="What is taken, and what it is worth">
            <h3 className="annuities-planner-group-title">What is taken, and what it is worth</h3>
            <div className="annuities-fields">
              <PlannerField
                id="gp-inflation"
                label="Expected inflation"
                hint="Used to restate the result in today’s money."
                suffix="%"
              >
                <input
                  id="gp-inflation"
                  type="text"
                  inputMode="decimal"
                  value={inputs.inflation}
                  placeholder="2.5"
                  onChange={(event) => setField('inflation', event.target.value)}
                />
              </PlannerField>

              <PlannerField
                id="gp-tax"
                label="Marginal tax rate"
                hint="The rate on the next dollar of income."
                suffix="%"
              >
                <input
                  id="gp-tax"
                  type="text"
                  inputMode="decimal"
                  value={inputs.taxRate}
                  placeholder="22"
                  onChange={(event) => setField('taxRate', event.target.value)}
                />
              </PlannerField>

              <PlannerField
                id="gp-treatment"
                label="How the growth is taxed"
                hint="The same 7% behaves very differently in a 401k than in a brokerage account."
              >
                <select
                  id="gp-treatment"
                  value={inputs.taxTreatment}
                  onChange={(event) => setField('taxTreatment', event.target.value)}
                >
                  {Object.entries(TAX_TREATMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </PlannerField>
            </div>
          </section>
        </div>
      </RevealBand>

      <RevealBand
        tone="tint"
        eyebrow="Projection"
        title="Where it lands"
        description="The result restated three ways: what the account says, what it buys, and how much of it you actually put in."
      >
        <div className="annuities-figure annuities-planner-figure" aria-live="polite">
          <span className="annuities-figure-label">Balance after {projection.totalYears} years</span>
          <span className="annuities-figure-value">{formatMoney(summary.afterTaxBalance)}</span>
          <span
            key={`glow-${summary.afterTaxBalance}`}
            className="annuities-figure-glow"
            aria-hidden="true"
          />
          <p className="annuities-figure-note">
            {summary.totalTax > 0
              ? `After ${formatMoney(summary.totalTax)} of tax`
              : 'Nothing is taxed in this scenario'}
            {' · '}
            about {formatMoney(summary.realAfterTaxBalance)} in today’s money
          </p>
        </div>

        <div className="annuities-metrics annuities-stagger">
          <Metric
            label="You contributed"
            value={formatMoney(summary.totalContributions)}
            hint={`${formatMoney(parseNumberInput(inputs.periodicDeposit))} per deposit`}
          />
          <Metric
            label="Investment growth"
            value={formatMoney(growth)}
            hint={`${formatPercent(summary.growthShare, 1)} of the balance`}
            tone="positive"
          />
          <Metric
            label="Tax"
            value={formatMoney(summary.totalTax)}
            hint={
              summary.deferredTaxDue > 0
                ? `Includes ${formatMoney(summary.deferredTaxDue)} owed at withdrawal`
                : summary.recurringTax > 0
                  ? 'Charged as the interest is earned'
                  : 'Tax-free account'
            }
            tone={summary.totalTax > 0 ? 'negative' : ''}
          />
          <Metric
            label="Inflation"
            value={formatMoney(summary.inflationErosion)}
            hint="Purchasing power lost over the period"
            tone={summary.inflationErosion > 0 ? 'negative' : ''}
          />
          <Metric
            label="Effective annual return"
            value={formatPercent(summary.effectiveAnnualRate, 2)}
            hint={
              summary.effectiveAnnualRate !== summary.netAnnualRate
                ? `${formatPercent(summary.netAnnualRate, 2)} after tax`
                : 'Compounding included'
            }
          />
          <Metric
            label="Real return"
            value={formatPercent(summary.realAnnualRate, 2)}
            hint="Return after inflation"
            tone={summary.realAnnualRate >= 0 ? 'positive' : 'negative'}
          />
        </div>

        <AnnuityChart
          title="Where the money comes from"
          description="Your contributions against what the balance grows into — and the same balance restated in today’s purchasing power."
          labels={series.labels}
          series={chartSeries}
          emptyMessage="Enter a deposit or a starting balance to see the projection."
          footnote={`The shaded area is growth you never deposited. At a 4% withdrawal rate this balance would support roughly ${formatMoney(summary.safeAnnualWithdrawal)} a year — a rule of thumb, not a guarantee.`}
        />
      </RevealBand>

      {projection.years.length > 0 && (
        <RevealBand
          tone="surface"
          eyebrow="Schedule"
          title="Year by year"
          description={`Every deposit, every dollar of interest and every dollar of tax, at ${formatPercent(projection.periodicRate, 4)} per period.`}
        >
          <div className="annuities-table-scroll">
            <table className="annuities-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Start</th>
                  <th scope="col">Deposits</th>
                  <th scope="col">Interest</th>
                  <th scope="col">Tax</th>
                  <th scope="col">End balance</th>
                  <th scope="col">In today’s $</th>
                </tr>
              </thead>
              <tbody>
                {projection.years.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td>{formatMoney(row.startBalance, 0)}</td>
                    <td>{formatMoney(row.contributions, 0)}</td>
                    <td className="is-positive">{formatMoney(row.interest, 0)}</td>
                    <td className={row.tax > 0 ? 'is-negative' : ''}>{formatMoney(row.tax, 0)}</td>
                    <td className="is-strong">{formatMoney(row.endBalance, 0)}</td>
                    <td className="is-muted">{formatMoney(row.realEndBalance, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RevealBand>
      )}
    </>
  );
}

export default GrowthPlanner;
