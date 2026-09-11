import {
  GOAL_CONVERSATION_PREFIX,
  GOAL_CHAT_TITLE_PREFIX,
  goalConversationId,
  goalSlugFromConversationId,
  goalSlugFromConversation,
  isGoalConversation,
  goalChatTitle,
  normalizeGoal,
  goalRefFromWorkspaceEntry,
  buildGoalKickoffMessage,
  findGoalConversation,
  ensureGoalConversation,
  agentStateFromRun,
  formatAgentRunMessage,
  goalRunOfflineMessage,
  goalKickoffMessage,
  appendGoalRunToConversation,
} from './goalChat';

const goal = (over = {}) => ({
  slug: 'organize-downloads',
  title: 'Organize my downloads',
  description: 'Sort every file in ~/Downloads into subfolders by type.',
  ...over,
});

const chat = (over = {}) => ({
  id: 'abc',
  title: 'New Chat',
  messages: [],
  createdAt: '2026-09-11T00:00:00.000Z',
  ...over,
});

describe('goalChat · conversation identity', () => {
  test('derives a stable id from the goal slug', () => {
    expect(goalConversationId('organize-downloads')).toBe(`${GOAL_CONVERSATION_PREFIX}organize-downloads`);
    expect(goalConversationId('organize-downloads')).toBe(goalConversationId('organize-downloads'));
  });

  test('an empty slug has no conversation', () => {
    expect(goalConversationId('')).toBe('');
    expect(goalConversationId(undefined)).toBe('');
    expect(goalConversationId('   ')).toBe('');
  });

  test('round-trips the slug out of the id', () => {
    const id = goalConversationId('my-goal');
    expect(goalSlugFromConversationId(id)).toBe('my-goal');
  });

  test('a normal chat is not a goal thread', () => {
    expect(goalSlugFromConversationId('1')).toBeNull();
    expect(goalSlugFromConversationId('goalish')).toBeNull();
    expect(isGoalConversation(chat())).toBe(false);
  });

  test('recognizes a goal thread by its explicit slug even if the id is odd', () => {
    const conv = chat({ id: 'legacy-id', goalSlug: 'my-goal' });
    expect(isGoalConversation(conv)).toBe(true);
    expect(goalSlugFromConversation(conv)).toBe('my-goal');
  });

  test('null/undefined conversations are not goal threads', () => {
    expect(isGoalConversation(null)).toBe(false);
    expect(goalSlugFromConversation(undefined)).toBeNull();
  });

  test('titles the thread with the goal name, capped', () => {
    expect(goalChatTitle('Organize my downloads')).toBe(`${GOAL_CHAT_TITLE_PREFIX}Organize my downloads`);
    expect(goalChatTitle('')).toBe(`${GOAL_CHAT_TITLE_PREFIX}Untitled goal`);
    const long = goalChatTitle('x'.repeat(200));
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('goalChat · kickoff message', () => {
  test('reads as the user ask, with the goal text', () => {
    const msg = buildGoalKickoffMessage(goal());
    expect(msg).toContain('🎯 Goal: Organize my downloads');
    expect(msg).toContain('Sort every file in ~/Downloads into subfolders by type.');
  });

  test('carries the success criteria, constraints and step budget when set', () => {
    const msg = buildGoalKickoffMessage(goal({
      successCriteria: 'Nothing loose left in Downloads.',
      constraints: 'Never delete a file.',
      maxSteps: 20,
    }));
    expect(msg).toContain('Success criteria: Nothing loose left in Downloads.');
    expect(msg).toContain('Constraints: Never delete a file.');
    expect(msg).toContain('Step budget: at most 20 steps.');
  });

  test('omits empty sections instead of emitting blank labels', () => {
    const msg = buildGoalKickoffMessage({ slug: 's', title: 'Just a title' });
    expect(msg).toBe('🎯 Goal: Just a title');
  });

  test('does not repeat the title as the description', () => {
    const msg = buildGoalKickoffMessage({ slug: 's', title: 'Same', description: 'Same' });
    expect(msg).toBe('🎯 Goal: Same');
  });

  test('falls back to a usable title when the goal has none', () => {
    expect(buildGoalKickoffMessage({ slug: 's' })).toContain('Untitled goal');
  });
});

describe('goalChat · goal shapes', () => {
  test('normalizes a /plans item or a workspace entry', () => {
    const fromWorkspace = goalRefFromWorkspaceEntry({
      slug: 'g', name: 'Name', content: 'Body', successCriteria: 'ok', constraints: 'no', maxSteps: 5,
    });
    expect(fromWorkspace).toEqual({
      slug: 'g', title: 'Name', description: 'Body', successCriteria: 'ok', constraints: 'no', maxSteps: 5,
    });
  });

  test('fills a missing slug from the caller and drops a junk step budget', () => {
    expect(goalRefFromWorkspaceEntry(null, 'fallback').slug).toBe('fallback');
    expect(normalizeGoal({ maxSteps: -4 }).maxSteps).toBeNull();
    expect(normalizeGoal({ maxSteps: '7' }).maxSteps).toBe(7);
  });
});

describe('goalChat · ensureGoalConversation', () => {
  test('creates the thread, titled and linked to the goal', () => {
    const { conversations, conversation, created } = ensureGoalConversation([chat()], goal(), { now: 1000 });
    expect(created).toBe(true);
    expect(conversation.id).toBe(goalConversationId('organize-downloads'));
    expect(conversation.goalSlug).toBe('organize-downloads');
    expect(conversation.title).toBe('🎯 Organize my downloads');
    expect(conversations).toHaveLength(2);
    expect(conversations[0]).toBe(conversation);
  });

  test('a plain hand-off does not arm a run', () => {
    const { conversation } = ensureGoalConversation([], goal());
    expect(conversation.pendingKickoff).toBe(false);
  });

  test('enlisting arms the run with the kickoff text', () => {
    const { conversation } = ensureGoalConversation([], goal(), { enlist: true });
    expect(conversation.pendingKickoff).toBe(buildGoalKickoffMessage(goal()));
  });

  test('is idempotent — a second enlist does not duplicate the thread', () => {
    const first = ensureGoalConversation([], goal(), { enlist: true });
    const second = ensureGoalConversation(first.conversations, goal(), { enlist: true });
    expect(second.created).toBe(false);
    expect(second.conversations).toHaveLength(1);
    expect(second.conversation.messages).toHaveLength(0);
  });

  test('re-enlisting a spent thread re-arms it', () => {
    const created = ensureGoalConversation([], goal(), { enlist: true });
    const spent = created.conversations.map((c) => ({ ...c, pendingKickoff: false }));
    const again = ensureGoalConversation(spent, goal(), { enlist: true });
    expect(again.conversation.pendingKickoff).toBe(buildGoalKickoffMessage(goal()));
  });

  test('a view hand-off never clears an enlist the user already asked for', () => {
    const created = ensureGoalConversation([], goal(), { enlist: true });
    const viewed = ensureGoalConversation(created.conversations, goal(), { enlist: false });
    expect(viewed.conversation.pendingKickoff).toBe(buildGoalKickoffMessage(goal()));
  });

  test('never overwrites a title the user or the LLM chose', () => {
    const created = ensureGoalConversation([], goal(), { enlist: true });
    const renamed = created.conversations.map((c) => ({ ...c, title: 'Sorted downloads' }));
    const next = ensureGoalConversation(renamed, goal({ title: 'Renamed goal' }));
    expect(next.conversation.title).toBe('Sorted downloads');
  });

  test('keeps an existing thread\'s messages', () => {
    const created = ensureGoalConversation([], goal(), { enlist: true });
    const withMsg = created.conversations.map((c) => ({ ...c, messages: [{ id: '1', role: 'user', content: 'hi' }] }));
    const next = ensureGoalConversation(withMsg, goal(), { enlist: true });
    expect(next.conversation.messages).toHaveLength(1);
  });

  test('bumps updatedAt only when the enlist actually changed something', () => {
    const created = ensureGoalConversation([], goal(), { enlist: true, now: 1000 });
    const settled = created.conversations.map((c) => ({ ...c, pendingKickoff: false }));
    const noop = ensureGoalConversation(settled, goal(), { now: 5000 });
    expect(noop.conversation.updatedAt).toBe(created.conversation.updatedAt);
    const armed = ensureGoalConversation(settled, goal(), { enlist: true, now: 5000 });
    expect(armed.conversation.updatedAt).toBe(new Date(5000).toISOString());
  });

  test('a goal with no slug yields no conversation', () => {
    const { conversations, conversation, created } = ensureGoalConversation([chat()], { title: 'No slug' });
    expect(conversation).toBeNull();
    expect(created).toBe(false);
    expect(conversations).toHaveLength(1);
  });
});

describe('goalChat · finding the thread', () => {
  test('finds it by slug', () => {
    const created = ensureGoalConversation([], goal());
    expect(findGoalConversation(created.conversations, 'organize-downloads')).toBe(created.conversation);
    expect(findGoalConversation(created.conversations, 'other')).toBeNull();
    expect(findGoalConversation(created.conversations, '')).toBeNull();
  });
});

describe('goalChat · agent run mapping', () => {
  const run = {
    actionable: true,
    status: 'done',
    result: 'Sorted 412 files into 9 folders.',
    stepLog: [
      { tool: 'shell_run', args: { cmd: 'ls' }, ok: true, result: 'many files' },
      { tool: 'fs_write', ok: false, result: 'permission denied' },
    ],
  };

  test('maps a finished run onto the stored agent state', () => {
    const state = agentStateFromRun(run);
    expect(state.status).toBe('done');
    expect(state.result).toBe('Sorted 412 files into 9 folders.');
    expect(state.summary).toBe('Sorted 412 files into 9 folders.');
    expect(state.source).toBe('addon');
    expect(state.plan).toEqual(['shell_run', 'fs_write']);
    // Every tool call yields a step, and its result yields a second one — a
    // failed call keeps both, so /plans shows what was attempted and why not.
    expect(state.steps.map((s) => s.kind)).toEqual([
      'tool', 'tool-result', 'error', 'tool-result', 'result',
    ]);
  });

  test('maps stop/timeout/failure distinctly', () => {
    expect(agentStateFromRun({ status: 'stopped' }).status).toBe('stopped');
    expect(agentStateFromRun({ status: 'timeout' }).status).toBe('stopped');
    expect(agentStateFromRun({ status: 'failed' }).status).toBe('failed');
    expect(agentStateFromRun({ status: 'weird' }).status).toBe('failed');
  });

  test('records a bare reason as the last thing the user can read', () => {
    const state = agentStateFromRun({ status: 'failed', reason: 'no windows found' });
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].text).toBe('Stopped: no windows found');
    expect(state.summary).toBe('no windows found');
  });

  test('an empty run still produces a valid state', () => {
    const state = agentStateFromRun(null);
    expect(state.steps).toEqual([]);
    expect(state.status).toBe('failed');
  });

  test('formats the run as a readable chat message', () => {
    const msg = formatAgentRunMessage(run);
    expect(msg).toContain('🤖 **Agent run** — Done · 2 steps');
    expect(msg).toContain('✅ `shell_run`');
    expect(msg).toContain('❌ `fs_write`');
    expect(msg).toContain('Sorted 412 files into 9 folders.');
    expect(msg).toContain('Continue in this thread');
  });

  test('a stopped run reports why instead of an empty result block', () => {
    const msg = formatAgentRunMessage({ status: 'stopped', reason: 'kill switch on' });
    expect(msg).toContain('Stopped');
    expect(msg).toContain('_Stopped: kill switch on_');
    expect(msg).not.toContain('**Result**');
  });

  test('the offline notice tells the user what to do next', () => {
    const msg = goalRunOfflineMessage();
    expect(msg).toContain('isn\'t reachable');
    expect(msg).toContain('Enlist agent');
  });
});

describe('goalChat · recording a run in the thread', () => {
  const run = {
    status: 'done',
    result: 'Sorted 412 files.',
    stepLog: [{ tool: 'shell_run', ok: true }],
  };

  test('creates the thread and opens it with the ask', () => {
    const { conversations, conversation } = appendGoalRunToConversation([chat()], goal(), run, { now: 2000 });
    expect(conversations[0].id).toBe(goalConversationId('organize-downloads'));
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation.messages[0].content).toContain('🎯 Goal: Organize my downloads');
    expect(conversation.messages[0].goalKickoff).toBe(true);
    expect(conversation.messages[1].content).toContain('Sorted 412 files.');
  });

  test('the kickoff message id is derived, so a re-seed cannot duplicate it', () => {
    const first = appendGoalRunToConversation([], goal(), run, { now: 2000 });
    const again = appendGoalRunToConversation(first.conversations, goal(), run, { now: 3000 });
    const userMessages = again.conversation.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(goalKickoffMessage(goal(), 5000).id).toBe('goal-kickoff-organize-downloads');
    expect(userMessages[0].id).toBe('goal-kickoff-organize-downloads');
  });

  test('appends to an existing thread without repeating the ask', () => {
    const first = appendGoalRunToConversation([], goal(), run, { now: 2000 });
    const second = appendGoalRunToConversation(first.conversations, goal(), run, { now: 3000 });
    expect(second.conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
  });

  test('clears a pending kickoff — the run just happened', () => {
    const armed = ensureGoalConversation([], goal(), { enlist: true }).conversations;
    const { conversation } = appendGoalRunToConversation(armed, goal(), run);
    expect(conversation.pendingKickoff).toBe(false);
  });

  test('a goal with no slug records nothing', () => {
    const { conversations, conversation } = appendGoalRunToConversation([chat()], { title: 'x' }, run);
    expect(conversation).toBeNull();
    expect(conversations).toHaveLength(1);
  });

  test('carries the run status and step count as message metadata', () => {
    const { conversation } = appendGoalRunToConversation([], goal(), run);
    const msg = conversation.messages[conversation.messages.length - 1];
    expect(msg.agentRun).toEqual({ goalSlug: 'organize-downloads', status: 'done', steps: 1 });
  });
});
