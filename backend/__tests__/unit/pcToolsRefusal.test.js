/**
 * pcToolsRefusal.test.js — what the model and the UI are told when the PC says no.
 *
 * **What was wrong.** `pc_do` decided whether a failed dispatch was a REFUSAL by
 * running `/denied|not approved|permission policy/i` over the PC's reason text,
 * and the reason is written by a permission gate with six distinct branches. Two
 * were mis-read, both in the direction of "this is a fault":
 *
 *   - the emergency kill switch ("Blocked by the emergency kill switch …")
 *     matched none of those words, so a deliberate hard stop arrived as `Error:`;
 *   - an expired prompt ("no answer within 110s — the request expired …") matched
 *     none either, and then fell through the failure taxonomy to FATAL — the model
 *     was told, verbatim, `HARNESS: FAILED — this is not retryable … do not repeat
 *     it`. A user who was away from their desk for two minutes got a step the
 *     model had been instructed to abandon.
 *
 * Both are locked below at the level of the CLASSIFICATION, not just the wording,
 * because the wording was never the point: `kind` decides which instruction the
 * model gets and whether the harness may retry, and `cause` decides whether a
 * person or a stored setting refused — which is the difference between a step
 * worth offering to retry and one that will refuse identically forever.
 *
 * The legacy cases matter as much as the new ones: the token is only sent by
 * addon builds released with it, so the fallback path is what the field is
 * actually running until every desktop updates.
 */

const { interpretPcFailure, REFUSAL_CAUSES } = require('../../services/pcTools.js');
const { classifyToolOutcome, KINDS } = require('../../services/harness/toolOutcome.js');
const { completeStep, startStep } = require('../../services/harness/stepJournal.js');

/** What the addon writes on the wire (simple-addon/server/automation/refusal-wire.js). */
const wire = (cause, reason) => `DENIED[${cause}]: ${reason}`;

/**
 * Classify a `pc_do` failure exactly as the loop does, after interpretation.
 *
 * The spread is kept deliberately explicit about the two DIFFERENT `retryable`s:
 * `reaskable` comes from the refusal (may a person answer differently next time?)
 * and `retryable` from the failure taxonomy (may the harness repeat it by itself?)
 * — see the warning on `REFUSAL_CAUSES`. They disagree on the same refusal.
 */
function classify(tool, rawError) {
  const refusal = interpretPcFailure(tool, rawError);
  return { ...refusal, ...classifyToolOutcome({ result: refusal.message }) };
}

describe('pc_do refusals carry their cause across the wire', () => {
  test('the kill switch is a DECISION, not a crash', () => {
    const out = classify('shell_run', wire(
      'kill-switch',
      'Blocked by the emergency kill switch (turn it off in Settings → Permissions).',
    ));

    expect(out.prefix).toBe('Denied:');
    expect(out.cause).toBe('kill-switch');
    expect(out.kind).toBe(KINDS.PERMISSION);
    // The message keeps the PC's own instruction, because only the user can act
    // on it — and being told WHICH setting is the whole point of naming a cause.
    expect(out.message).toMatch(/kill switch/i);
    expect(out.message).toMatch(/Settings/);
    expect(out.message).toMatch(/Do not retry/i);
  });

  test('an expired prompt is retryable — the user was away, not refusing', () => {
    const out = classify('screen_capture', wire(
      'expired',
      'no answer within 110s — the request expired and nothing was run.',
    ));

    expect(out.prefix).toBe('Denied:');
    expect(out.cause).toBe('expired');
    expect(out.reaskable).toBe(true);
    // This is the assertion that would have failed before: FATAL told the model
    // to give up.
    expect(out.kind).toBe(KINDS.PERMISSION);
    expect(out.kind).not.toBe(KINDS.FATAL);
    // And the model is told the machine is unchanged — an unanswered prompt is
    // exactly the case where a model might assume the action went through.
    expect(out.message).toMatch(/nothing was run/i);
    expect(out.message).toMatch(/do not assume/i);
  });

  test('a human declining is retryable but must not be re-asked automatically', () => {
    const out = classify('shell_run', wire('user-declined', 'User denied'));

    expect(out.cause).toBe('user-declined');
    expect(out.reaskable).toBe(true);
    expect(out.kind).toBe(KINDS.PERMISSION);
    // Retryable from the USER's side only. Nagging is the failure mode here.
    expect(out.message).toMatch(/do not ask again on your own/i);
  });

  test('a stored policy denial is NOT retryable, and says which setting', () => {
    const out = classify('shell_run', wire(
      'policy-deny',
      'Denied by permission policy (category "shell").',
    ));

    expect(out.cause).toBe('policy-deny');
    expect(out.reaskable).toBe(false);
    expect(out.kind).toBe(KINDS.PERMISSION);
    expect(out.message).toMatch(/will refuse again/i);
    expect(out.message).toMatch(/on the PC|on their machine/i);
  });

  test('the two hard stops and the two human answers are distinguished', () => {
    // The property the prose classifier could not express at all: it is not
    // enough to know a gate blocked it, because the next move differs.
    const reaskable = ['user-declined', 'expired'].map((c) => classify('x', wire(c, 'r')).reaskable);
    const hardStops = ['kill-switch', 'policy-deny'].map((c) => classify('x', wire(c, 'r')).reaskable);

    expect(reaskable).toEqual([true, true]);
    expect(hardStops).toEqual([false, false]);
  });

  test('a refusal is never auto-retried by the harness, even when it is re-askable', () => {
    // The two meanings in one place, on the same result. `reaskable` is about the
    // HUMAN answering differently; `retryable` lets the LOOP re-run a step without
    // asking anyone. A `pc_do` drives the user's real machine, so it is never in
    // `isRetrySafeTool` — and this is the assertion that keeps the two from being
    // conflated by a future rename or a spread.
    for (const cause of ['expired', 'user-declined', 'policy-deny', 'kill-switch']) {
      const out = classify('shell_run', wire(cause, 'reason'));
      expect(out.retryable).toBe(false);
    }

    const expired = classify('shell_run', wire('expired', 'reason'));
    expect(expired.reaskable).toBe(true);
    expect(expired.retryable).toBe(false);
  });

  test('a prompt that FAILED is a fault, and is never blamed on the user', () => {
    const out = classify('shell_run', wire('prompt-failed', 'Approval prompt failed: IPC closed'));

    expect(out.cause).toBe('prompt-failed');
    expect(out.reaskable).toBe(false);
    // The model must not tell the user they refused something they were never
    // shown — that was the old wording's implicit claim.
    expect(out.message).toMatch(/user was not asked|could not even be put/i);
  });

  test('an unknown cause is treated as a refusal with unknown semantics', () => {
    // Version skew: a newer addon, an older backend. It IS a refusal — the token
    // says so — but nothing beyond that may be inferred, least of all retryability.
    const out = classify('shell_run', wire('brand-new-cause', 'something new'));

    expect(out.prefix).toBe('Denied:');
    expect(out.cause).toBe('brand-new-cause');
    expect(out.reaskable).toBe(false);
    expect(out.kind).toBe(KINDS.PERMISSION);
    expect(out.message).toMatch(/something new/);
  });

  test('a malformed token falls back rather than being half-understood', () => {
    // `DENIED[` without a clean cause is not usable; guessing from a partial
    // match is how a classifier silently mislabels. It must fall through.
    const out = classify('shell_run', 'DENIED[Not A Cause]: User denied the request');

    expect(out.cause).toBeNull();
    // The legacy regex still reads it as a refusal, which is right.
    expect(out.prefix).toBe('Denied:');
    expect(out.kind).toBe(KINDS.PERMISSION);
  });
});

describe('the legacy path — addons that send no cause', () => {
  test('a refusal worded as before is still a refusal', () => {
    const out = classify('shell_run', 'Denied — "shell_run" is set to deny in your permission policy.');

    expect(out.prefix).toBe('Denied:');
    expect(out.cause).toBeNull();
    expect(out.kind).toBe(KINDS.PERMISSION);
  });

  test('a relay timeout is still reported as unknown, not as a refusal', () => {
    // Distinct from an expiry: the PC never answered AT ALL, so the action may
    // have run — the opposite of "nothing was run".
    const out = classify('shell_run', 'the PC did not answer within 120s');

    expect(out.prefix).toBe('Error:');
    expect(out.cause).toBeNull();
    expect(out.message).toMatch(/may have run/i);
    expect(out.message).toMatch(/do NOT repeat/i);
  });

  test('an arbitrary failure keeps the generic error shape', () => {
    const out = classify('shell_run', 'Unknown tool: shell_run');

    expect(out.prefix).toBe('Error:');
    expect(out.message).toBe('Error: Unknown tool: shell_run');
    expect(out.kind).toBe(KINDS.NOT_FOUND);
  });

  test('a missing reason does not produce "Error: undefined"', () => {
    const out = classify('shell_run', undefined);

    expect(out.prefix).toBe('Error:');
    expect(out.message).not.toMatch(/undefined/);
  });
});

describe('the cause survives into the record the UI reads', () => {
  /**
   * The journal decides a step's status from the prefix with
   * `/^(?:Denied|Cancelled)(?::|\s)/` — an anchored match against the message
   * SHAPE. The new label is `Denied (expired): …`, which is a different shape from
   * the `Denied: …` it was written for, so whether a refusal still lands in the
   * `denied` state (rather than a red error) is an empirical question, not an
   * obvious one. It is asked here because getting it wrong is invisible: the step
   * simply renders as a failure, which looks plausible.
   */
  function record(rawError) {
    const refusal = interpretPcFailure('shell_run', rawError);
    const classified = classifyToolOutcome({ result: refusal.message });
    const run = { id: 'r1', steps: [], stepsDropped: 0 };
    const step = startStep(run, { tool: 'pc_do', args: {} });
    return completeStep(step, {
      result: refusal.message,
      outcome: classified.kind,
      cause: classified.cause,
    });
  }

  test('a refusal is still the `denied` state, not an error', () => {
    for (const cause of ['kill-switch', 'policy-deny', 'user-declined', 'expired']) {
      const step = record(wire(cause, 'the PC said so'));
      expect(step.status).toBe('denied');
      expect(step.outcome).toBe(KINDS.PERMISSION);
      expect(step.cause).toBe(cause);
    }
  });

  test('the two halves of the record answer different questions', () => {
    const step = record(wire('expired', 'no answer within 110s — nothing was run.'));

    // `outcome` — what kind of failure (a gate refused).
    expect(step.outcome).toBe(KINDS.PERMISSION);
    // `cause` — whether a person or a setting refused. This is the field an
    // affordance keys off, and the only one of the two that can tell a retry
    // worth offering from one that will refuse identically forever.
    expect(step.cause).toBe('expired');
    // The harness instruction must not leak into the user-facing preview.
    expect(step.resultPreview).not.toMatch(/HARNESS:/);
  });

  test('a legacy refusal records a null cause rather than a guess', () => {
    const step = record('Denied — "shell_run" is set to deny in your permission policy.');

    expect(step.status).toBe('denied');
    expect(step.cause).toBeNull();
  });

  test('a fault records neither a refusal state nor a cause', () => {
    const step = record('the PC did not answer within 120s');

    expect(step.status).toBe('error');
    expect(step.cause).toBeNull();
  });

  test('the record says whether a retry is even worth offering', () => {
    // This is the field the client's "Try again" button keys off, and the reason it
    // is computed here rather than in the UI: a frontend that kept its own list of
    // re-askable causes would drift from the refusal vocabulary, and the failure
    // mode is a button promising something the machine has already refused.
    const reaskable = ['user-declined', 'expired']
      .map((c) => record(wire(c, 'r')).reaskable);
    const hardStops = ['kill-switch', 'policy-deny']
      .map((c) => record(wire(c, 'r')).reaskable);

    expect(reaskable).toEqual([true, true]);
    expect(hardStops).toEqual([false, false]);
  });

  test('an unlabelled or unrecognised refusal is never re-askable', () => {
    // Both are "unknown", and unknown must fail closed: a missing button is a small
    // loss, a wrong one is a lie. Covers the legacy addon in the field and the
    // version-skew case.
    expect(record('Denied — "shell_run" is set to deny in your permission policy.').reaskable).toBe(false);
    expect(record(wire('brand-new-cause', 'something new')).reaskable).toBe(false);
  });

  test('a RUNNING step is not re-askable — there is nothing to re-ask yet', () => {
    const run = { id: 'r1', steps: [], stepsDropped: 0 };
    const step = startStep(run, { tool: 'pc_do', args: {} });

    expect(step.status).toBe('running');
    expect(step.reaskable).toBe(false);
    expect(step.cause).toBeNull();
  });
});

describe('the cause vocabulary is closed', () => {
  test('every cause has a stated rationale and next move', () => {
    for (const [cause, entry] of Object.entries(REFUSAL_CAUSES)) {
      expect(typeof entry.reaskable).toBe('boolean');
      expect(entry.why.length).toBeGreaterThan(10);
      expect(entry.next.length).toBeGreaterThan(10);
      // A cause whose advice is not addressed to the model is not advice.
      expect(entry.next).toMatch(/Do not|Do NOT|Report|Tell|wait|let them|nothing/i);
      expect(cause).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('the hard stops are exactly the ones a setting controls', () => {
    // Naming this as a test because it is a POLICY decision, not an implementation
    // detail: `deny` is documented as a hard stop, so a retry must never be
    // offered for one.
    const reaskableCauses = Object.entries(REFUSAL_CAUSES)
      .filter(([, v]) => v.reaskable)
      .map(([k]) => k)
      .sort();

    expect(reaskableCauses).toEqual(['expired', 'user-declined']);
  });
});
