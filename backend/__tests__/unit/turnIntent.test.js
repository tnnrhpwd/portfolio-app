/**
 * turnIntent.test.js — the /net act-vs-answer decision.
 *
 * The report that started this (2026-09-18): the cloud turn had no policy for
 * acting vs answering, only `tool_choice: 'auto'` and prose, and it regularly
 * narrated an outcome instead of performing it — "answers when it should act".
 *
 * These cases are deliberately about the *boundaries*, because the module is
 * advisory: a 'tool' verdict costs one extra model call, so the thing worth
 * pinning is that it never fires on ordinary conversation, never fires on a
 * bare confirmation, and never points a non-admin at tools they were not given.
 */

const {
  DECISION_POLICY,
  ACT_NUDGE,
  classifyTurnIntent,
  actNudgeFor,
  appendSystemNote,
} = require('../../services/turnIntent.js');

const verdictOf = (text, opts) => classifyTurnIntent(text, opts).verdict;
const reasonOf = (text, opts) => classifyTurnIntent(text, opts).reason;

const ADMIN = { capabilities: ['repo:read', 'repo:write', 'repo:push'] };
const USER = { capabilities: [] };

describe('DECISION_POLICY', () => {
  it('states the act-first rule and the no-evidence rule', () => {
    expect(DECISION_POLICY).toMatch(/CALL THE TOOL FIRST/);
    expect(DECISION_POLICY).toMatch(/Do not describe the action/);
    expect(DECISION_POLICY).toMatch(/Never say you did something unless a tool result/);
  });

  it('keeps the escape hatches: clarify only when ambiguous or irreversible', () => {
    expect(DECISION_POLICY).toMatch(/genuinely ambiguous/);
    expect(DECISION_POLICY).toMatch(/irreversible/);
    // Plain conversation must not be pushed into a tool call.
    expect(DECISION_POLICY).toMatch(/just answer in text/);
  });
});

describe('classifyTurnIntent — tool-ownable turns', () => {
  it.each([
    ['add a goal to run a marathon', 'goals'],
    ['what goals do i have saved right now', 'goals'],
    ['save these as my goals', 'goals'],
    ['remember that my sister is called Ana', 'notes'],
    ['note that the venue is booked for the 3rd', 'notes'],
    ['generate an image of a fox in the rain', 'image'],
    ['draw me a logo for the podcast', 'image'],
    ['calculate 15% of 200', 'math'],
    ['2 + 2', 'math'],
    ['what is 2+2', 'math'],
    ['what time is it', 'datetime'],
    ["what's today's date", 'datetime'],
    ['report a bug: the export button 500s', 'support'],
    ['can you file a ticket for this', 'support'],
    ['the export button does not work', 'support'],
    ['log that I finished the report', 'action-log'],
    ['summarize this conversation', 'summarize'],
    ['search the web for the latest score', 'web-search'],
  ])('%s → tool (%s)', (text, reason) => {
    expect(classifyTurnIntent(text)).toMatchObject({ verdict: 'tool', reason });
  });

  it('is a tool turn for the exact prompt that started the repo-agent work', () => {
    const text = 'increase the context length for the net goal description input on this website';
    expect(verdictOf(text, { hasRepoCapability: true })).toBe('tool');
  });
});

describe('classifyTurnIntent — must NOT nudge', () => {
  it('leaves social openers alone', () => {
    expect(verdictOf('hey')).toBe('chat');
    expect(verdictOf('thanks!')).toBe('chat');
    expect(verdictOf('ok')).toBe('chat');
  });

  it('leaves bare confirmations alone — they reply to a question already asked', () => {
    expect(verdictOf('yes')).toBe('ambiguous');
    expect(verdictOf('yes, push it')).toBe('ambiguous');
    expect(verdictOf('go ahead')).toBe('ambiguous');
    expect(reasonOf('yes')).toBe('too-short');
  });

  it('leaves explanation and chit-chat alone', () => {
    expect(verdictOf('explain how closures work')).toBe('ambiguous');
    expect(verdictOf('how are you?')).toBe('ambiguous');
    expect(verdictOf('what is my name')).toBe('ambiguous');
    expect(verdictOf('')).toBe('ambiguous');
  });

  it('does not read "make a plan" as an image request', () => {
    expect(verdictOf('make a plan for the week')).toBe('ambiguous');
  });

  it('does not offer repository work to a context that has no repo tools', () => {
    expect(verdictOf('fix the footer on this website', { hasRepoCapability: false })).toBe('ambiguous');
    expect(verdictOf('commit my changes', { hasRepoCapability: false })).toBe('ambiguous');
  });

  it('does offer repository work to the administrator', () => {
    expect(reasonOf('fix the footer on this website', { hasRepoCapability: true })).toBe('site-source');
    expect(reasonOf('commit my changes', { hasRepoCapability: true })).toBe('repo');
  });
});

describe('actNudgeFor', () => {
  it('returns the corrective note for a tool turn', () => {
    expect(actNudgeFor({ userMessage: 'add a goal to run a marathon', ...USER })).toBe(ACT_NUDGE);
  });

  it('returns nothing for ordinary conversation', () => {
    expect(actNudgeFor({ userMessage: 'how are you?', ...USER })).toBeNull();
  });

  it('returns nothing when the turn has no message to judge', () => {
    expect(actNudgeFor({ userMessage: '', ...USER })).toBeNull();
    expect(actNudgeFor(null)).toBeNull();
    expect(actNudgeFor(undefined)).toBeNull();
  });

  it('needs the repo capability before a repo request counts', () => {
    const message = 'fix the footer on this website';
    expect(actNudgeFor({ userMessage: message, ...ADMIN })).toBe(ACT_NUDGE);
    expect(actNudgeFor({ userMessage: message, ...USER })).toBeNull();
  });
});

describe('appendSystemNote', () => {
  it('appends to the existing system message instead of adding a turn', () => {
    const messages = [
      { role: 'system', content: 'base' },
      { role: 'user', content: 'hi' },
    ];
    expect(appendSystemNote(messages, ACT_NUDGE)).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe(`base${ACT_NUDGE}`);
  });

  it('is a no-op when there is no system message or no note', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    expect(appendSystemNote(messages, ACT_NUDGE)).toBe(false);
    expect(messages).toHaveLength(1);
    expect(appendSystemNote([{ role: 'system', content: 'x' }], '')).toBe(false);
  });
});
