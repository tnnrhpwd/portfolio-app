/**
 * planSurface.test.js — the plan the model publishes about its own work.
 *
 * The rule this suite exists to protect: **a malformed plan must never fail a
 * turn.** The plan is the model describing its own intent, so the realistic
 * inputs are misspelled statuses, prose in the wrong field, two steps marked
 * current, and a list that is too long. Every one of those has to come out the
 * other side as a usable checklist plus a NOTE — silently correcting the model
 * would teach it nothing and the same mistake would repeat next turn.
 *
 * `normalisePlan` is pure and total, so this is a table, not a mock.
 */

const {
  normalisePlan,
  renderPlan,
  planChanged,
  summarisePlan,
  normaliseStatus,
  PLAN_STATUSES,
  MAX_ITEMS,
  MAX_TEXT_CHARS,
} = require('../../services/harness/planSurface.js');

const texts = (plan) => plan.items.map((i) => i.text);
const statuses = (plan) => plan.items.map((i) => i.status);

describe('planSurface — normalising what the model actually sends', () => {
  test('keeps a clean plan exactly as sent', () => {
    const plan = normalisePlan([
      { text: 'Find where the limit is set', status: 'done' },
      { text: 'Raise it to 30,000', status: 'in_progress' },
      { text: 'Run the costs suite', status: 'pending' },
    ]);

    expect(statuses(plan)).toEqual(['done', 'in_progress', 'pending']);
    expect(plan.notes).toEqual([]);
    expect(plan.counts).toEqual({ pending: 1, in_progress: 1, done: 1, blocked: 0 });
  });

  test('accepts a whole plan object as well as the bare items array', () => {
    // The executor passes `args.items`, but a caller that hands it the tool's
    // whole args object must not get an empty plan for its trouble.
    expect(statuses(normalisePlan({ items: [{ text: 'a', status: 'done' }] }))).toEqual(['done']);
    expect(texts(normalisePlan({ items: [{ text: 'a' }] }))).toEqual(['a']);
  });

  test('coerces the status spellings a model really produces', () => {
    // Rejecting these would teach the model that set_plan is unreliable — and the
    // whole point of the tool is to get it to REPORT its intent.
    expect(normaliseStatus('In Progress')).toBe('in_progress');
    expect(normaliseStatus('in-progress')).toBe('in_progress');
    expect(normaliseStatus('IN_PROGRESS')).toBe('in_progress');
    expect(normaliseStatus('completed')).toBe('done');
    expect(normaliseStatus('finished')).toBe('done');
    expect(normaliseStatus('stuck')).toBe('blocked');
    expect(normaliseStatus('waiting')).toBe('blocked');
    // Anything unknown is pending: never claim work that may not have happened.
    expect(normaliseStatus('invented')).toBe('pending');
    expect(normaliseStatus(undefined)).toBe('pending');
  });

  test('an unknown status becomes pending, and the plan is still returned', () => {
    const plan = normalisePlan([{ text: 'do the thing', status: 'mostly-done' }]);
    expect(statuses(plan)).toEqual(['pending']);
    expect(plan.items).toHaveLength(1);
  });

  test('accepts `title` as the text field, and drops entries with neither', () => {
    const plan = normalisePlan([
      { title: 'from a title', status: 'done' },
      { text: '   ', status: 'done' },   // whitespace only
      { status: 'done' },                // no text at all
      { text: 'kept', status: 'pending' },
    ]);

    expect(texts(plan)).toEqual(['from a title', 'kept']);
    expect(plan.notes.join(' ')).toMatch(/2 step\(s\) had no text/);
  });

  test('MORE THAN ONE in_progress: keeps the later one and says so', () => {
    // The ambiguity that matters — the checklist is where the user looks to see
    // where the agent is, and two markers make that unanswerable. The later one
    // wins because a model that marks two has moved on from the first.
    const plan = normalisePlan([
      { text: 'first', status: 'in_progress' },
      { text: 'second', status: 'in_progress' },
    ]);

    expect(statuses(plan)).toEqual(['pending', 'in_progress']);
    expect(plan.notes.join(' ')).toMatch(/more than one step was in progress/);
    expect(plan.notes.join(' ')).toContain('second');
  });

  test('bounds the list and says how much was dropped', () => {
    const long = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ text: `step ${i}`, status: 'pending' }));
    const plan = normalisePlan(long);

    expect(plan.items).toHaveLength(MAX_ITEMS);
    expect(plan.notes.join(' ')).toMatch(new RegExp(`first ${MAX_ITEMS} steps were kept`));
  });

  test('clips a step that is really a paragraph', () => {
    const plan = normalisePlan([{ text: 'x'.repeat(MAX_TEXT_CHARS + 50), status: 'pending' }]);
    expect(plan.items[0].text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 1);
    expect(plan.items[0].text.endsWith('…')).toBe(true);
  });

  test('never throws, whatever it is handed', () => {
    // The property that matters most: this runs inside a TOOL, and a throw would
    // cost the turn.
    for (const input of [undefined, null, 'a string', 42, {}, { items: 'nope' }, [null], [{ text: {} }]]) {
      expect(() => normalisePlan(input)).not.toThrow();
      expect(Array.isArray(normalisePlan(input).items)).toBe(true);
    }
    expect(normalisePlan(undefined).notes).toContain('no items were provided');
    expect(normalisePlan([]).notes.join(' ')).toMatch(/plan is empty/);
  });

  test('ids are stable positions, so the UI can key on them', () => {
    const plan = normalisePlan([{ text: 'a' }, { text: 'b' }]);
    expect(plan.items.map((i) => i.id)).toEqual(['p1', 'p2']);
  });
});

describe('planSurface — what the model reads back', () => {
  test('renders the list, the counts and the current step', () => {
    const plan = normalisePlan([
      { text: 'search the repo', status: 'done' },
      { text: 'edit the file', status: 'in_progress' },
      { text: 'run the check', status: 'pending' },
    ]);

    const text = renderPlan(plan);
    expect(text).toContain('PLAN VISIBLE TO THE USER');
    expect(text).toContain('3 steps, 1 in progress, 1 done');
    expect(text).toContain('1. [done] search the repo');
    expect(text).toContain('2. [in progress] edit the file');
    // The reminder names the step to flip, which is the one thing the model most
    // often forgets.
    expect(text).toMatch(/call set_plan again when "edit the file" finishes/);
  });

  test('warns when the marker has been left behind', () => {
    // The most likely drift: work finished, nobody moved the marker, and the
    // checklist keeps pointing at a step that is already done.
    const text = renderPlan(normalisePlan([
      { text: 'done thing', status: 'done' },
      { text: 'next thing', status: 'pending' },
    ]));

    expect(text).toMatch(/nothing is marked in progress, but steps remain/);
  });

  test('does NOT warn when the plan is finished', () => {
    const text = renderPlan(normalisePlan([
      { text: 'one', status: 'done' },
      { text: 'two', status: 'done' },
    ]));
    expect(text).not.toMatch(/nothing is marked in progress/);
  });

  test('reports blocked work, since that is usually about the user', () => {
    const text = renderPlan(normalisePlan([
      { text: 'need the API key', status: 'blocked' },
      { text: 'deploy', status: 'pending' },
    ]));
    expect(text).toContain('1 blocked');
    expect(text).toContain('[blocked] need the API key');
  });

  test('passes the corrections on to the model', () => {
    const text = renderPlan(normalisePlan([{ text: 'a', status: 'in_progress' }, { text: 'b', status: 'in_progress' }]));
    expect(text).toContain('more than one step was in progress');
  });
});

describe('planSurface — change detection', () => {
  test('a redraw is needed only when the STEPS moved', () => {
    const one = normalisePlan([{ text: 'a', status: 'in_progress' }]);
    const sameAgain = normalisePlan([{ text: 'a', status: 'in_progress' }]);
    const moved = normalisePlan([{ text: 'a', status: 'done' }]);

    expect(planChanged(one, sameAgain)).toBe(false);
    expect(planChanged(one, moved)).toBe(true);
    expect(planChanged(null, one)).toBe(true);
    expect(planChanged(one, null)).toBe(true);
    expect(planChanged(null, null)).toBe(false);
  });
});

describe('planSurface — the one-line summary', () => {
  test('names the current step, which is what a log wants', () => {
    const plan = normalisePlan([
      { text: 'search', status: 'done' },
      { text: 'edit', status: 'in_progress' },
    ]);
    expect(summarisePlan(plan)).toBe('2 steps · 1 done · working on: edit');
  });

  test('is null when there is no plan at all', () => {
    expect(summarisePlan(null)).toBeNull();
    expect(summarisePlan({ items: [] })).toBeNull();
  });
});

describe('planSurface — the export surface', () => {
  test('the four statuses are the four the schema advertises', () => {
    // The tool schema's enum and this list must not drift: the schema is what the
    // model is allowed to send, and this is what the normaliser understands.
    expect([...PLAN_STATUSES]).toEqual(['pending', 'in_progress', 'done', 'blocked']);
  });
});
