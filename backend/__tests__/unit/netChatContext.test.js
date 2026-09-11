/**
 * netChatContext.test.js — unit tests for the shared /net tool-context builder.
 *
 * This replaced two copy-pasted blocks in llmService.js, so the important
 * guarantees are: it recognizes both request shapes, sets the admin flag +
 * capability list, and returns nothing for a non-/net request.
 */

const { buildToolContext } = require('../../services/netChatContext');

function req(user = { id: 'u1', email: 'u1@example.com', nickname: 'Uno' }) {
  return { user };
}

describe('buildToolContext — request shapes', () => {
  test('recognizes the addon JSON payload', () => {
    const userInput = JSON.stringify({
      message: 'open notepad',
      conversationHistory: [{ role: 'user', content: 'hi' }],
      behaviorFile: 'custom.txt',
      activeAgent: { id: 'a1' },
    });
    const out = buildToolContext({ req: req(), userInput, isNetChat: true });
    expect(out.toolContext).not.toBeNull();
    expect(out.toolContext.userId).toBe('u1');
    expect(out.toolContext.userEmail).toBe('u1@example.com');
    expect(out.toolContext.userName).toBe('Uno');
    expect(out.behaviorFile).toBe('custom.txt');
    expect(out.activeAgent).toEqual({ id: 'a1' });
    expect(out.userMessageForContext).toBe('open notepad');
  });

  test('recognizes the web /net plain-text form', () => {
    const out = buildToolContext({ req: req(), userInput: 'write me a poem', isNetChat: true });
    expect(out.toolContext).not.toBeNull();
    expect(out.userMessageForContext).toBe('write me a poem');
  });

  test('returns no tool context for a non-/net request', () => {
    const out = buildToolContext({ req: req(), userInput: 'compress this', isNetChat: false });
    expect(out.toolContext).toBeNull();
  });
});

describe('buildToolContext — admin + capabilities', () => {
  const ORIGINAL = process.env.ADMIN_USER_ID;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_USER_ID;
    else process.env.ADMIN_USER_ID = ORIGINAL;
  });

  test('marks the configured admin and grants repo capabilities', () => {
    process.env.ADMIN_USER_ID = 'admin-1';
    const out = buildToolContext({ req: req({ id: 'admin-1', email: 'a@x.com' }), userInput: 'repo work', isNetChat: true });
    expect(out.toolContext.isAdmin).toBe(true);
    expect(out.toolContext.capabilities).toEqual(expect.arrayContaining(['repo:read', 'repo:write', 'repo:push']));
    expect(typeof out.toolContext.turnStartedAt).toBe('number');
  });

  test('a normal user gets no repo capabilities', () => {
    process.env.ADMIN_USER_ID = 'admin-1';
    const out = buildToolContext({ req: req({ id: 'someone-else' }), userInput: 'hello', isNetChat: true });
    expect(out.toolContext.isAdmin).toBe(false);
    expect(out.toolContext.capabilities).toEqual([]);
  });
});
