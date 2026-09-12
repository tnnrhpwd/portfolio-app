import React from 'react';
import {
  FIND,
  TIMING,
  TIMING_LABELS,
  formatMoney,
  formatPercent,
  sanitizeNumberInput,
} from './annuityEngine';

/**
 * The inputs for one time-value cash flow.
 *
 * This is a *controlled* component: the parent owns the strings so the numbers
 * and the plotted result can never drift apart.
 *
 * The field being solved for is not rendered as an input — you cannot type the
 * unknown — and every other field explains how it is measured.
 *
 * Styling lives in the page stylesheet (Annuities.css) because the field, pill
 * and figure primitives here are shared with the growth planner.
 */

const FIELDS = [
  {
    key: 'present',
    symbol: 'P',
    label: 'Present value',
    placeholder: 'e.g. 10000',
    hint: 'Money in hand today — a lump sum, a loan, an initial deposit.',
    negative: false,
    hiddenWhenFinding: FIND.PRESENT,
    describe: (value) => `Present: ${formatMoney(value)}`,
  },
  {
    key: 'periodic',
    symbol: 'A',
    label: 'Periodic payment',
    placeholder: 'e.g. 500',
    hint: 'The same amount every period — a deposit, a payment, a coupon.',
    negative: false,
    hiddenWhenFinding: FIND.PERIODIC,
    describe: (value) => `Periodic: ${formatMoney(value)}`,
  },
  {
    key: 'future',
    symbol: 'F',
    label: 'Future value',
    placeholder: 'e.g. 100000',
    hint: 'A single amount received at the end — a target balance, a bond’s face value.',
    negative: false,
    hiddenWhenFinding: FIND.FUTURE,
    describe: (value) => `Future: ${formatMoney(value)}`,
  },
  {
    key: 'gradient',
    symbol: 'G',
    label: 'Gradient',
    placeholder: 'e.g. 250',
    hint: 'How much each payment grows: 0, G, 2G, 3G … starting in period 2.',
    negative: true,
    hiddenWhenFinding: null,
    describe: (value) => `Gradient: ${formatMoney(value)} per period`,
  },
  {
    key: 'rate',
    symbol: 'i',
    label: 'Interest rate per period',
    placeholder: 'e.g. 5',
    hint: 'Enter a percentage — 5 means 5% per period.',
    negative: true,
    hiddenWhenFinding: null,
    suffix: '%',
    describe: (value) => `Rate: ${formatPercent(value / 100, 3)} per period`,
  },
  {
    key: 'periods',
    symbol: 'n',
    label: 'Number of periods',
    placeholder: 'e.g. 10',
    hint: 'Years, months — whatever one period means to you.',
    negative: false,
    hiddenWhenFinding: null,
    describe: (value) => `Periods: ${Math.round(value)}`,
  },
];

function CashFlowInputs({ values, onValueChange, find, timing, onTimingChange, idPrefix = 'cf' }) {
  const handleChange = (key, raw, allowNegative) => {
    onValueChange(key, sanitizeNumberInput(raw, { allowNegative }));
  };

  return (
    <>
      <div className="annuities-fields annuities-stagger">
        {FIELDS.filter((field) => field.hiddenWhenFinding !== find).map((field) => {
          const inputId = `${idPrefix}-${field.key}`;
          const hintId = `${inputId}-hint`;
          const raw = values[field.key] ?? '';
          const numeric = parseFloat(raw);
          const hasValue = raw !== '' && Number.isFinite(numeric);
          return (
            <div key={field.key} className="annuities-field">
              <div className="annuities-field-head">
                <label className="annuities-field-label" htmlFor={inputId}>
                  {field.label}
                </label>
                <span className="annuities-field-symbol">{field.symbol}</span>
              </div>
              <div className="annuities-field-control">
                <input
                  id={inputId}
                  name={field.key}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck="false"
                  value={raw}
                  placeholder={field.placeholder}
                  onChange={(event) => handleChange(field.key, event.target.value, field.negative)}
                  aria-describedby={hintId}
                />
                {field.suffix && <span className="annuities-field-suffix">{field.suffix}</span>}
              </div>
              <p id={hintId} className="annuities-field-hint">
                {field.hint}
              </p>
              {hasValue && <span className="annuities-field-chip">{field.describe(numeric)}</span>}
            </div>
          );
        })}
      </div>

      <div className="annuities-choice">
        <span className="annuities-field-label">Payment timing</span>
        <div className="annuities-choice-options" role="group" aria-label="Payment timing">
          {[TIMING.END, TIMING.BEGIN].map((option) => (
            <button
              key={option}
              type="button"
              className={`annuities-pill${timing === option ? ' is-active' : ''}`}
              aria-pressed={timing === option}
              onClick={() => onTimingChange(option)}
            >
              {option === TIMING.END ? 'End of period' : 'Beginning of period'}
            </button>
          ))}
        </div>
        <p className="annuities-field-hint">{TIMING_LABELS[timing]}</p>
      </div>
    </>
  );
}

export default CashFlowInputs;
