import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import AnnuityChart from './AnnuityChart';
import CashFlowInputs from './CashFlowInputs';
import GrowthPlanner from './GrowthPlanner';
import RevealBand from './RevealBand';
import artAnnuities from '../../../assets/art/project-annuities.jpg';
import {
  FIND,
  TIMING,
  formatMoney,
  parseNumberInput,
  parseRateInput,
  solveCashFlow,
} from './annuityEngine';
import './Annuities.css';

const FIND_OPTIONS = [FIND.PRESENT, FIND.PERIODIC, FIND.FUTURE];

const FIND_LABELS = {
  [FIND.PRESENT]: 'Present',
  [FIND.PERIODIC]: 'Periodic',
  [FIND.FUTURE]: 'Future',
};

const ANSWER_LABELS = {
  [FIND.PRESENT]: 'Present value',
  [FIND.PERIODIC]: 'Equivalent payment each period',
  [FIND.FUTURE]: 'Future value',
};

const CHART_COPY = {
  [FIND.PRESENT]: {
    title: 'Present worth as the money arrives',
    description:
      'Each step is one period’s worth of value, discounted back to today. The line ends at the present value above.',
  },
  [FIND.FUTURE]: {
    title: 'Value as it accumulates',
    description:
      'The balance after each period. A future sum only lands in the final period, so the line steps up at the end.',
  },
  [FIND.PERIODIC]: {
    title: 'The flows your payment is equivalent to',
    description:
      'The balance those cash flows build to. The answer above is the single level payment with the same worth.',
  },
};

const PALETTE = ['--fg-blue', '--fg-mint', '--fg-orange', '--fg-pink'];

/** The value field each solve target hides — you cannot input the unknown. */
const FIND_VALUE_KEY = {
  [FIND.PRESENT]: 'present',
  [FIND.PERIODIC]: 'periodic',
  [FIND.FUTURE]: 'future',
};

const EMPTY_VALUES = {
  present: '',
  periodic: '',
  future: '',
  gradient: '',
  rate: '',
  periods: '',
};

let nextFlowId = 1;

const createFlow = (overrides = {}) => ({
  id: nextFlowId++,
  find: FIND.FUTURE,
  timing: TIMING.END,
  values: { ...EMPTY_VALUES },
  ...overrides,
});

/** Textbook problems, stated with the period basis they actually use. */
const EXAMPLE_PROBLEMS = [
  {
    id: 'sinking-fund',
    title: 'Sinking fund for equipment',
    description: 'You need $100,000 in 5 years. What must you set aside at the end of each year at 6%?',
    difficulty: 'Beginner',
    concepts: ['F → A'],
    flows: [{ find: FIND.PERIODIC, values: { future: '100000', rate: '6', periods: '5' } }],
  },
  {
    id: 'car-loan',
    title: 'Auto loan payment',
    description: 'A $25,000 car loan at 5.9% APR over 5 years, paid monthly.',
    difficulty: 'Beginner',
    concepts: ['P → A'],
    flows: [
      { find: FIND.PERIODIC, values: { present: '25000', rate: '0.4916667', periods: '60' } },
    ],
  },
  {
    id: 'retirement-fund',
    title: 'Retirement savings',
    description: '$500 a month for 30 years at 7% a year, compounded monthly.',
    difficulty: 'Beginner',
    concepts: ['A → F'],
    flows: [{ find: FIND.FUTURE, values: { periodic: '500', rate: '0.5833333', periods: '360' } }],
  },
  {
    id: 'bond-price',
    title: 'Bond price',
    description:
      'A bond pays $1,000 a year and returns $10,000 at maturity in 10 years. What is it worth today at an 8% required return?',
    difficulty: 'Intermediate',
    concepts: ['A → P', 'F → P'],
    flows: [
      { find: FIND.PRESENT, values: { periodic: '1000', rate: '8', periods: '10' } },
      { find: FIND.PRESENT, values: { future: '10000', rate: '8', periods: '10' } },
    ],
    note: 'The coupon stream and the face value are worth $11,342 together.',
  },
  {
    id: 'equipment-maintenance',
    title: 'Equipment maintenance',
    description: '$2,000 a year of upkeep, rising $500 every year, for 8 years at 10%. What is the cost today?',
    difficulty: 'Intermediate',
    concepts: ['A → P', 'G → P'],
    flows: [
      { find: FIND.PRESENT, values: { periodic: '2000', rate: '10', periods: '8' } },
      { find: FIND.PRESENT, values: { gradient: '500', rate: '10', periods: '8' } },
    ],
    note: 'The gradient starts in period 2 — the textbook convention for (P/G, i, n).',
  },
  {
    id: 'career-earnings',
    title: 'Career earnings with raises',
    description: 'A $50,000 salary rising $3,000 a year for 20 years, discounted at 5%.',
    difficulty: 'Advanced',
    concepts: ['A → P', 'G → P'],
    flows: [
      { find: FIND.PRESENT, values: { periodic: '50000', rate: '5', periods: '20' } },
      { find: FIND.PRESENT, values: { gradient: '3000', rate: '5', periods: '20' } },
    ],
  },
  {
    id: 'project-npv',
    title: 'Project NPV',
    description:
      'A project costs $200,000 now, returns $50,000 a year for 6 years and $30,000 of salvage value. At a 12% MARR, is it worth doing?',
    difficulty: 'Advanced',
    concepts: ['A → P', 'F → P', 'NPV'],
    flows: [
      { find: FIND.PRESENT, values: { periodic: '50000', rate: '12', periods: '6' } },
      { find: FIND.PRESENT, values: { future: '30000', rate: '12', periods: '6' } },
    ],
    initialCost: 200000,
  },
  {
    id: 'lease-vs-buy',
    title: 'Lease or buy?',
    description:
      'Equipment can be bought for $80,000 or leased for $15,000 a year for 7 years. At 9%, which is cheaper?',
    difficulty: 'Intermediate',
    concepts: ['A → P'],
    flows: [{ find: FIND.PRESENT, values: { periodic: '15000', rate: '9', periods: '7' } }],
    note: 'Compare the answer with the $80,000 purchase price.',
  },
  {
    id: 'college-fund',
    title: 'College fund',
    description: '$5,000 today plus $200 a month for 18 years at 6% a year, compounded monthly.',
    difficulty: 'Beginner',
    concepts: ['P → F', 'A → F'],
    flows: [
      { find: FIND.FUTURE, values: { present: '5000', rate: '0.5', periods: '216' } },
      { find: FIND.FUTURE, values: { periodic: '200', rate: '0.5', periods: '216' } },
    ],
  },
  {
    id: 'retirement-income',
    title: 'Retirement income',
    description:
      'You retire with $300,000 and want it to last 25 years at 4%. How much can you draw each year?',
    difficulty: 'Intermediate',
    concepts: ['P → A'],
    flows: [{ find: FIND.PERIODIC, values: { present: '300000', rate: '4', periods: '25' } }],
    note: 'A drawdown, not an accumulation — the same equation read backwards.',
  },
];

const DIFFICULTY_CLASS = {
  Beginner: 'is-beginner',
  Intermediate: 'is-intermediate',
  Advanced: 'is-advanced',
};

const TIME_VALUE_FACTORS = [
  { name: 'Future value of a single amount', factor: '(F/P, i, n)', formula: 'F = P(1 + i)ⁿ', use: 'What a lump sum today becomes.' },
  { name: 'Present value of a single amount', factor: '(P/F, i, n)', formula: 'P = F / (1 + i)ⁿ', use: 'What a future amount is worth today.' },
  { name: 'Future value of a uniform series', factor: '(F/A, i, n)', formula: 'F = A[(1 + i)ⁿ − 1] / i', use: 'What regular deposits accumulate to.' },
  { name: 'Sinking fund', factor: '(A/F, i, n)', formula: 'A = F·i / [(1 + i)ⁿ − 1]', use: 'The deposit that reaches a target.' },
  { name: 'Present value of a uniform series', factor: '(P/A, i, n)', formula: 'P = A[(1 + i)ⁿ − 1] / [i(1 + i)ⁿ]', use: 'What a stream of equal payments is worth today.' },
  { name: 'Capital recovery', factor: '(A/P, i, n)', formula: 'A = P·i(1 + i)ⁿ / [(1 + i)ⁿ − 1]', use: 'The payment that repays a loan, or a sustainable drawdown.' },
  { name: 'Future value of a gradient', factor: '(F/G, i, n)', formula: 'F = G[(1 + i)ⁿ − 1 − i·n] / i²', use: 'Payments that grow by G every period.' },
  { name: 'Present value of a gradient', factor: '(P/G, i, n)', formula: 'P = (G/i)·[(P/A, i, n) − n(P/F, i, n)]', use: 'The value today of a steadily rising stream.' },
  { name: 'Gradient to uniform series', factor: '(A/G, i, n)', formula: 'A = (P/G, i, n) · (A/P, i, n)', use: 'Turns a rising stream into one level payment.' },
];

function Annuities() {
  const [tab, setTab] = useState('planner');
  const [flows, setFlows] = useState(() => [createFlow()]);
  const [selectedExample, setSelectedExample] = useState(null);
  const [showExamples, setShowExamples] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);

  // ---- solver plumbing ----------------------------------------------------

  const updateFlow = useCallback((id, patch) => {
    setFlows((previous) =>
      previous.map((flow) => (flow.id === id ? { ...flow, ...patch } : flow)),
    );
  }, []);

  const updateFlowValue = useCallback((id, key, value) => {
    setFlows((previous) =>
      previous.map((flow) =>
        flow.id === id ? { ...flow, values: { ...flow.values, [key]: value } } : flow,
      ),
    );
  }, []);

  /**
   * Swapping the solve target only changes which field is shown — the value
   * behind it is kept so switching back restores it. It is excluded from the
   * maths instead, because nothing can be both the input and the unknown.
   */
  const changeFind = useCallback((id, find) => {
    setFlows((previous) => previous.map((flow) => (flow.id === id ? { ...flow, find } : flow)));
  }, []);

  const addFlow = useCallback(() => {
    setFlows((previous) => [...previous, createFlow()]);
  }, []);

  const removeFlow = useCallback((id) => {
    setFlows((previous) => (previous.length > 1 ? previous.filter((flow) => flow.id !== id) : previous));
  }, []);

  const clearSolver = useCallback(() => {
    setSelectedExample(null);
    setFlows([createFlow()]);
  }, []);

  const loadExample = useCallback((example) => {
    setSelectedExample(example);
    setShowExamples(false);
    setTab('solver');
    setFlows(
      example.flows.map((flow) =>
        createFlow({
          find: flow.find,
          timing: flow.timing || TIMING.END,
          values: { ...EMPTY_VALUES, ...flow.values },
        }),
      ),
    );
  }, []);

  const hasAnyInput = flows.some((flow) =>
    Object.values(flow.values).some((value) => value !== ''),
  );

  // ---- solving ------------------------------------------------------------

  const results = useMemo(
    () =>
      flows.map((flow) => {
        // Whatever we are solving for is not an input, so blank it out rather
        // than letting a hidden number contribute to its own answer.
        const targetKey = FIND_VALUE_KEY[flow.find];
        const raw = { ...flow.values, ...(targetKey ? { [targetKey]: '' } : null) };
        return solveCashFlow({
          find: flow.find,
          timing: flow.timing,
          present: parseNumberInput(raw.present),
          periodic: parseNumberInput(raw.periodic),
          future: parseNumberInput(raw.future),
          gradient: parseNumberInput(raw.gradient),
          rate: parseRateInput(raw.rate, 'percent'),
          periods: parseNumberInput(raw.periods),
        });
      }),
    [flows],
  );

  const combine = useMemo(() => {
    const solved = flows
      .map((flow, index) => ({ flow, result: results[index], position: index }))
      .filter((entry) => entry.result.answer !== 0);
    if (solved.length === 0) return null;
    const targets = new Set(solved.map((entry) => entry.flow.find));
    const sameTarget = targets.size === 1;
    return {
      solved,
      sameTarget,
      find: sameTarget ? solved[0].flow.find : null,
      total: solved.reduce((sum, entry) => sum + entry.result.answer, 0),
    };
  }, [flows, results]);

  const chart = useMemo(() => {
    // Only cash flows that produced an answer belong on the chart — an
    // untouched form would otherwise plot a single meaningless zero.
    const active = flows
      .map((flow, index) => ({ flow, result: results[index] }))
      .filter(({ result }) => result.components.length > 0);
    if (active.length === 0) return null;

    const length = active.reduce((max, { result }) => Math.max(max, result.series.length), 0);
    if (length === 0) return null;
    const labels = Array.from({ length }, (_, index) => `Period ${index}`);
    const valueAt = (result, index) => {
      const point = result.series[index];
      return point ? point.value : null;
    };

    const drawCombined = active.length > 1 && combine?.sameTarget;

    const series = active.map(({ result }, index) => ({
      label: `Cash flow #${index + 1}`,
      data: labels.map((_, point) => valueAt(result, point)),
      // When a total is drawn, the parts recede to a muted grey so they read
      // as components of the bold line rather than competitors for attention.
      color: drawCombined ? '--text-color-accent' : PALETTE[index % PALETTE.length],
      dashed: active.length > 1,
      width: active.length > 1 ? 1.5 : 2.5,
      fill: active.length === 1,
    }));

    if (drawCombined) {
      series.push({
        label: 'Combined',
        data: labels.map((_, point) =>
          active.reduce((sum, { result }) => sum + (valueAt(result, point) || 0), 0),
        ),
        color: PALETTE[0],
        dashed: false,
        width: 2.5,
        fill: true,
      });
    }

    return { labels, series };
  }, [flows, results, combine]);

  const chartCopy = CHART_COPY[combine?.find || flows[0]?.find || FIND.FUTURE];
  const showCombined = Boolean(combine) && (results.length > 1 || Boolean(selectedExample?.initialCost));
  const npv =
    combine?.find === FIND.PRESENT && Number.isFinite(selectedExample?.initialCost)
      ? combine.total - selectedExample.initialCost
      : null;

  return (
    <>
      <SEO
        title="Annuities Calculator"
        description="Project an annuity with interest, compounding, tax and inflation — or solve any time-value-of-money problem (P, A, F, G) with the standard engineering-economy factors."
        path="/annuities"
      />
      <Header />

      <div className="annuities">
        {/* ── Hero: the gradient bookend, carrying the mode switcher ── */}
        <section className="annuities-hero">
          <img className="annuities-hero-media" src={artAnnuities} alt="" aria-hidden="true" />
          <div className="annuities-floating" aria-hidden="true">
            <span className="annuities-circle annuities-circle-1" />
            <span className="annuities-circle annuities-circle-2" />
            <span className="annuities-circle annuities-circle-3" />
          </div>

          <div className="annuities-hero-wrap">
            <p className="annuities-eyebrow">
              <span className="annuities-eyebrow-dot" aria-hidden="true" />
              Time value of money
            </p>
            <h1 className="annuities-title">Annuities</h1>
            <p className="annuities-subtitle">
              What a series of payments really becomes — with compounding, tax and inflation taken
              out of the headline rate, and every standard factor at your fingertips.
            </p>

            <nav className="annuities-tabs" aria-label="Calculator mode">
              <button
                type="button"
                className={`annuities-tab${tab === 'planner' ? ' is-active' : ''}`}
                aria-pressed={tab === 'planner'}
                onClick={() => setTab('planner')}
              >
                Growth planner
              </button>
              <button
                type="button"
                className={`annuities-tab${tab === 'solver' ? ' is-active' : ''}`}
                aria-pressed={tab === 'solver'}
                onClick={() => setTab('solver')}
              >
                Time-value solver
              </button>
            </nav>
          </div>
        </section>

        {tab === 'planner' ? (
          <GrowthPlanner />
        ) : (
          <>
            <RevealBand
              tone="tint"
              eyebrow="Time-value solver"
              title="Solve for the unknown"
              description="Pick the point in time you want the answer at, then enter whatever you know. One cash flow can mix a lump sum, a level payment, a future amount and a gradient."
              actions={
                <>
                  <button
                    type="button"
                    className="annuities-btn annuities-btn--outline"
                    aria-expanded={showExamples}
                    onClick={() => setShowExamples((value) => !value)}
                  >
                    {showExamples ? 'Hide examples' : 'Example problems'}
                    <span className="annuities-reference-caret" aria-hidden="true">
                      ›
                    </span>
                  </button>
                  {hasAnyInput && (
                    <button type="button" className="annuities-btn annuities-btn--quiet" onClick={clearSolver}>
                      Clear
                    </button>
                  )}
                </>
              }
            >
              {showExamples && (
                <div className="annuities-examples annuities-stagger">
                  {EXAMPLE_PROBLEMS.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      className={`annuities-example${selectedExample?.id === example.id ? ' is-selected' : ''}`}
                      onClick={() => loadExample(example)}
                    >
                      <span className="annuities-example-head">
                        <span className="annuities-example-title">{example.title}</span>
                        <span className={`annuities-example-level ${DIFFICULTY_CLASS[example.difficulty] || ''}`}>
                          {example.difficulty}
                        </span>
                      </span>
                      <span className="annuities-example-text">{example.description}</span>
                      <span className="annuities-example-concepts">
                        {example.concepts.map((concept) => (
                          <span key={concept} className="annuities-concept">
                            {concept}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selectedExample && (
                <div className="annuities-example-banner">
                  <strong>{selectedExample.title}</strong>
                  <span className="annuities-example-note">{selectedExample.description}</span>
                  {selectedExample.note && (
                    <span className="annuities-example-note">💡 {selectedExample.note}</span>
                  )}
                  {Number.isFinite(selectedExample.initialCost) && (
                    <span className="annuities-example-note">
                      ⚠️ Initial cost {formatMoney(selectedExample.initialCost)} is subtracted from the
                      present value to give the NPV.
                    </span>
                  )}
                </div>
              )}
            </RevealBand>

            <RevealBand tone="surface">
              {flows.map((flow, index) => {
                const result = results[index];
                const hasAnswer = result.answer !== 0 && Number.isFinite(result.answer);
                return (
                  <article key={flow.id} className="annuities-flow" aria-label={`Cash flow ${index + 1}`}>
                    <header className="annuities-flow-head">
                      <span className="annuities-flow-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="annuities-find" role="group" aria-label={`Solve cash flow ${index + 1} for`}>
                        {FIND_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={`annuities-find-btn${flow.find === option ? ' is-active' : ''}`}
                            aria-pressed={flow.find === option}
                            onClick={() => changeFind(flow.id, option)}
                          >
                            {FIND_LABELS[option]}
                          </button>
                        ))}
                      </div>
                      {flows.length > 1 && (
                        <button
                          type="button"
                          className="annuities-flow-remove"
                          onClick={() => removeFlow(flow.id)}
                          aria-label={`Remove cash flow ${index + 1}`}
                        >
                          ✕
                        </button>
                      )}
                    </header>

                    <CashFlowInputs
                      values={flow.values}
                      find={flow.find}
                      timing={flow.timing}
                      idPrefix={`cash-flow-${flow.id}`}
                      onValueChange={(key, value) => updateFlowValue(flow.id, key, value)}
                      onTimingChange={(timing) => updateFlow(flow.id, { timing })}
                    />

                    <div className="annuities-figure" aria-live="polite">
                      <span className="annuities-figure-label">{ANSWER_LABELS[flow.find]}</span>
                      <span className={`annuities-figure-value${hasAnswer ? '' : ' is-empty'}`}>
                        {hasAnswer ? formatMoney(result.answer) : '—'}
                      </span>
                      {hasAnswer && (
                        <span
                          key={`${flow.id}-${result.answer}`}
                          className="annuities-figure-glow"
                          aria-hidden="true"
                        />
                      )}
                      {flow.timing === TIMING.BEGIN && hasAnswer && (
                        <span className="annuities-figure-note">
                          payments at the beginning of each period
                        </span>
                      )}
                    </div>

                    {result.warnings.length > 0 && (
                      <ul className="annuities-warnings">
                        {result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}

                    {result.components.length > 0 && (
                      <table className="annuities-breakdown">
                        <caption>How this answer is built</caption>
                        <thead>
                          <tr>
                            <th scope="col">You entered</th>
                            <th scope="col">Factor</th>
                            <th scope="col">Contributes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.components.map((component) => (
                            <tr key={component.key}>
                              <td>
                                {component.symbol} = {formatMoney(component.input)}
                              </td>
                              <td className="annuities-breakdown-factor">{component.factorLabel}</td>
                              <td>{formatMoney(component.value)}</td>
                            </tr>
                          ))}
                          <tr className="annuities-breakdown-total">
                            <td colSpan={2}>Total</td>
                            <td>{formatMoney(result.answer)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </article>
                );
              })}

              <div className="annuities-toolbar">
                <button type="button" className="annuities-btn annuities-btn--primary" onClick={addFlow}>
                  Add another cash flow
                  <span className="annuities-btn-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>

              {showCombined && (
                <section className="annuities-total" aria-live="polite">
                  <span className="annuities-figure-label">Combined result</span>
                  <div className="annuities-figure">
                    <span className="annuities-figure-value">
                      {combine.sameTarget
                        ? formatMoney(combine.total)
                        : `${combine.solved.length} answers`}
                    </span>
                    <span
                      key={`combined-${combine.total}-${combine.solved.length}`}
                      className="annuities-figure-glow"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="annuities-total-caption">
                    {combine.sameTarget
                      ? `Everything above is measured at the same point in time, so the parts add up to one number: the ${ANSWER_LABELS[combine.find].toLowerCase()}.`
                      : 'These cash flows are valued at different points in time, so adding them together would be meaningless. Each answer is listed separately.'}
                  </p>
                  <ul className="annuities-total-list">
                    {combine.solved.map(({ flow, result, position }) => (
                      <li key={flow.id}>
                        <span className="annuities-total-flow">
                          {String(position + 1).padStart(2, '0')} · {FIND_LABELS[flow.find]}
                        </span>
                        <span className="annuities-total-amount">{formatMoney(result.answer)}</span>
                      </li>
                    ))}
                  </ul>
                  {npv !== null && (
                    <div className={`annuities-npv${npv >= 0 ? ' is-positive' : ' is-negative'}`}>
                      <span className="annuities-figure-label">Net present value</span>
                      <strong>{formatMoney(npv)}</strong>
                      <span className="annuities-npv-verdict">
                        {npv >= 0 ? 'Worth doing at this rate' : 'Does not clear the required return'}
                      </span>
                    </div>
                  )}
                </section>
              )}

              {chart && (
                <AnnuityChart
                  title={chartCopy.title}
                  description={chartCopy.description}
                  labels={chart.labels}
                  series={chart.series}
                  emptyMessage="Fill in a cash flow above to draw it."
                />
              )}
            </RevealBand>
          </>
        )}

        {/* ── Reference ── */}
        <RevealBand
          tone="wash"
          eyebrow="Reference"
          title="Every factor the solver uses"
          description="Each one moves a cash flow to the point in time you asked for. At a 0% interest rate they all fall back to plain arithmetic instead of dividing by zero."
          actions={
            <button
              type="button"
              className="annuities-btn annuities-btn--outline"
              aria-expanded={showFormulas}
              onClick={() => setShowFormulas((value) => !value)}
            >
              {showFormulas ? 'Hide the factors' : 'Show the factors'}
              <span className="annuities-reference-caret" aria-hidden="true">
                ›
              </span>
            </button>
          }
        >
          {showFormulas && (
            <div className="annuities-reference-body">
              <ul className="annuities-factor-list annuities-stagger">
                {TIME_VALUE_FACTORS.map((entry) => (
                  <li key={entry.factor} className="annuities-factor">
                    <span className="annuities-factor-name">
                      {entry.name} <code>{entry.factor}</code>
                    </span>
                    <code className="annuities-factor-formula">{entry.formula}</code>
                    <span className="annuities-factor-use">{entry.use}</span>
                  </li>
                ))}
              </ul>

              <h3>Conventions</h3>
              <ul className="annuities-notes">
                <li>
                  <strong>A uniform series (A)</strong> means the same amount every period. “End of
                  period” is an ordinary annuity; “beginning of period” is an annuity due, and every
                  uniform factor gains one period of interest.
                </li>
                <li>
                  <strong>A gradient (G)</strong> means the payment grows by G each period, starting
                  from zero in period 1 — so the values are 0, G, 2G, 3G …
                </li>
                <li>
                  <strong>Enter rates as percentages.</strong> 5 means 5% per period, not 0.05%.
                </li>
              </ul>

              <h3>Planner assumptions</h3>
              <ul className="annuities-notes">
                <li>
                  <strong>Compounding vs deposits.</strong> When the compounding frequency does not
                  match your deposit frequency, the per-period rate is converted properly — 6%
                  compounded annually paid monthly is 0.4868% a month, not 0.5%.
                </li>
                <li>
                  <strong>Taxed every year</strong> compounds at the after-tax rate, which is what
                  really drags a brokerage account. <strong>Tax-deferred</strong> compounds untouched
                  and is taxed once at the end, on everything above what you paid in.{' '}
                  <strong>Tax-free</strong> is taxed never.
                </li>
                <li>
                  <strong>Inflation</strong> never touches the account. It only restates the final
                  balance in today’s purchasing power, using 1 / (1 + inflation)ⁿ.
                </li>
                <li>
                  <strong>Deposit increases</strong> are applied once a year, on the anniversary,
                  which models raising a contribution alongside a salary.
                </li>
              </ul>
            </div>
          )}
        </RevealBand>

        {/* ── Closing bookend ── */}
        <RevealBand tone="cta">
          <div className="annuities-cta">
            <p className="annuities-cta-eyebrow">Read the numbers with care</p>
            <h2 className="annuities-cta-title">A headline rate is not the rate you keep.</h2>
            <ul className="annuities-cta-points annuities-stagger">
              <li>
                <strong>Compounding</strong>
                7% a year compounded monthly is really 7.23% — the frequency is part of the rate.
              </li>
              <li>
                <strong>Tax</strong>
                Taxed every year at 22%, that same 7% compounds at 5.6%. Tax-deferred, it waits.
              </li>
              <li>
                <strong>Inflation</strong>
                2.5% a year turns $1,000 in 30 years into about $477 of today’s money.
              </li>
            </ul>
            <Link className="annuities-btn annuities-btn--outline" to="/projects">
              Other calculators
              <span className="annuities-btn-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </div>
        </RevealBand>
      </div>

      <Footer />
    </>
  );
}

export default Annuities;
