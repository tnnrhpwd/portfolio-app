import { retryMessageFor, describeStep } from './retryMessage.js';

/**
 * The message a "Try again" click sends.
 *
 * This is a pure function on purpose: the wording IS the feature. It has to be a
 * plain user turn (the cloud does not hold a PC step's arguments — they are
 * redacted — and the consent that matters happens on the PC), and it has to name
 * the step, because continuity only knows the MOST RECENT run and a user can click
 * the button on a step from ten turns ago.
 *
 * The failure this guards against is a button that works in the one case everyone
 * tests and quietly targets the wrong thing in the case nobody does.
 */

const refused = (over = {}) => ({
  id: 'run_1_s2',
  tool: 'pc_do',
  plane: 'addon',
  label: 'Opening Notepad…',
  status: 'denied',
  cause: 'expired',
  reaskable: true,
  ...over,
});

describe('retryMessageFor — what is offered', () => {
  it('says nothing at all for a step that is not a re-askable refusal', () => {
    expect(retryMessageFor(null)).toBeNull();
    expect(retryMessageFor(undefined)).toBeNull();
    expect(retryMessageFor({})).toBeNull();
    // The server's verdict is the only one this trusts.
    expect(retryMessageFor(refused({ reaskable: false }))).toBeNull();
    expect(retryMessageFor(refused({ reaskable: 'yes' }))).toBeNull();
    expect(retryMessageFor(refused({ reaskable: 1 }))).toBeNull();
  });

  it('says nothing for an ordinary failure or a successful step', () => {
    expect(retryMessageFor({ status: 'error', error: 'boom' })).toBeNull();
    expect(retryMessageFor({ status: 'ok' })).toBeNull();
    expect(retryMessageFor({ status: 'denied' })).toBeNull(); // no reaskable flag
  });
});

describe('retryMessageFor — the wording', () => {
  it('promises to answer the prompt after an expiry, and only that', () => {
    const text = retryMessageFor(refused({ cause: 'expired' }));

    expect(text).toMatch(/I'll answer the prompt on my PC/);
    // The user was never asked, so the message must not imply they refused.
    expect(text).not.toMatch(/anyway/i);
  });

  it('admits the earlier "no" when the user declined', () => {
    // The user answered and said no. Pretending otherwise would rewrite their own
    // transcript back at them.
    const text = retryMessageFor(refused({ cause: 'user-declined' }));

    expect(text).toMatch(/anyway/i);
    expect(text).toMatch(/I'll approve it on my PC/);
  });

  it('explicitly overrides the "do not retry" already in the model\'s context', () => {
    // The step's own result carries `HARNESS: REFUSED — do not retry it and do not
    // rephrase it`, and continuity adds `Do not retry a refused step on your own`.
    // A model can read a bare "try again" as noise beside those two and answer
    // "I can't — that was refused", which looks like a harness bug. The message has
    // to say whose request this is.
    for (const cause of ['expired', 'user-declined', 'brand-new-cause']) {
      expect(retryMessageFor(refused({ cause }))).toMatch(/I'm asking you to/);
    }
  });

  it('falls back to a neutral ask for an unknown cause', () => {
    // A newer addon, an older table. It IS re-askable (the server said so), but
    // there is no honest specific phrasing — so say only what is certainly true.
    const text = retryMessageFor(refused({ cause: 'brand-new-cause' }));

    expect(text).toMatch(/Retry that step/);
    expect(text).not.toMatch(/anyway/i);
    expect(text).not.toMatch(/answer the prompt/i);
  });
});

describe('retryMessageFor — naming the step', () => {
  it('names it, so a click on an old step still targets the right thing', () => {
    const text = retryMessageFor(refused());

    // Without this the model has nothing in context tying "that" to anything,
    // because continuity describes the previous run and this may not be it.
    expect(text).toMatch(/\(The step: Opening Notepad…\)/);
  });

  it('falls back to the tool name when there is no label', () => {
    expect(retryMessageFor(refused({ label: '' }))).toMatch(/\(The step: pc_do\)/);
  });

  it('still sends a usable message when the step cannot be named', () => {
    const text = retryMessageFor(refused({ label: '', tool: '' }));

    expect(text).toMatch(/Retry that step/);
    // No dangling empty parenthetical.
    expect(text).not.toMatch(/\(The step: \)\)/);
    expect(text).not.toMatch(/\(The step: \)/);
  });
});

describe('describeStep', () => {
  it('collapses whitespace so a multi-line label is one clean clause', () => {
    expect(describeStep({ label: 'Reading\n  the   file…' })).toBe('Reading the file…');
  });

  it('bounds the length rather than pasting a novel into the message', () => {
    const long = 'x'.repeat(400);
    const out = describeStep({ label: long });

    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns null rather than an empty or whitespace descriptor', () => {
    expect(describeStep({ label: '   ' })).toBeNull();
    expect(describeStep({})).toBeNull();
    expect(describeStep(null)).toBeNull();
  });

  it('never reads the arguments', () => {
    // A redacted step arrives with `argsPreview: null`. Reconstructing a name from
    // the arguments would undo a deliberate privacy rule for a cosmetic gain, so a
    // step with arguments and no label must still come back unnamed.
    const step = { tool: '', argsPreview: null, argsRedacted: true, argKeys: ['text'] };
    expect(describeStep(step)).toBeNull();
  });
});
