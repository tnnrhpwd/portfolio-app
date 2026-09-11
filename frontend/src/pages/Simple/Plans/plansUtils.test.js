import {
  OOGPA_STAGES,
  stageIndex,
  stageLabel,
  agentPhase,
  agentStepCount,
  goalProgress,
  priorityFromNumber,
  priorityToNumber,
  slugifyGoalTitle,
  workspaceGoalToItem,
  suggestionToGoalPayload,
  timeSince,
  isOverdue,
  deadlineLabel,
  sortGoals,
  groupGoals,
  goalStats,
  isTerminalStatus,
  isAgentReady,
} from './plansUtils';

const goal = (over = {}) => ({
  _id: over.slug || 'demo',
  type: 'goal',
  workspace: true,
  data: { title: 'Demo', status: 'active', priority: 'medium', agent: null, ...over },
  updatedAt: over.updatedAt || null,
});

describe('plansUtils · O-O-G-P-A', () => {
  test('exposes the six loop stages in order', () => {
    expect(OOGPA_STAGES.map((s) => s.key)).toEqual([
      'observe', 'orient', 'goal', 'plan', 'act', 'reflect',
    ]);
  });

  test('maps addon stage values to display order', () => {
    expect(stageIndex('OBSERVING')).toBe(0);
    expect(stageIndex('SELECTING_GOAL')).toBe(2);
    expect(stageIndex('PLANNING')).toBe(3);
    expect(stageIndex('ACTING')).toBe(4);
    expect(stageIndex('REFLECTING')).toBe(5);
  });

  test('is case-insensitive and returns -1 for idle/unknown', () => {
    expect(stageIndex('orienting')).toBe(1);
    expect(stageIndex('IDLE')).toBe(-1);
    expect(stageIndex(undefined)).toBe(-1);
    expect(stageIndex('nonsense')).toBe(-1);
  });

  test('stageLabel falls back to Idle', () => {
    expect(stageLabel('ACTING')).toBe('Act');
    expect(stageLabel('IDLE')).toBe('Idle');
    expect(stageLabel(null)).toBe('Idle');
  });
});

describe('plansUtils · agent phase + progress', () => {
  test('normalizes agent statuses', () => {
    expect(agentPhase(null)).toBe('idle');
    expect(agentPhase({ status: 'running' })).toBe('running');
    expect(agentPhase({ status: 'done' })).toBe('done');
    expect(agentPhase({ status: 'stopped' })).toBe('stopped');
    expect(agentPhase({ status: 'interrupted' })).toBe('interrupted');
    expect(agentPhase({ status: 'weird' })).toBe('failed');
  });

  test('counts steps from an array or a number', () => {
    expect(agentStepCount({ steps: [1, 2, 3] })).toBe(3);
    expect(agentStepCount({ steps: 5 })).toBe(5);
    expect(agentStepCount({})).toBe(0);
    expect(agentStepCount(null)).toBe(0);
  });

  test('a live run never reads as finished', () => {
    expect(goalProgress({ status: 'running', steps: new Array(60).fill(0), maxSteps: 60 })).toBe(95);
    expect(goalProgress({ status: 'done', steps: [] })).toBe(100);
    expect(goalProgress({ status: 'stopped', steps: [] })).toBe(100);
    expect(goalProgress(null)).toBe(0);
    expect(goalProgress({ status: 'running', steps: [] })).toBe(5);
  });

  test('prefers the goal\'s configured step budget over the agent payload', () => {
    // 10 steps out of a 20-step goal budget = 50%
    expect(goalProgress({ status: 'running', steps: new Array(10).fill(0) }, 20)).toBe(50);
    // an explicit budget wins over agent.maxSteps
    expect(goalProgress({ status: 'running', steps: new Array(10).fill(0), maxSteps: 60 }, 20)).toBe(50);
    // falls back to the agent payload, then to 60
    expect(goalProgress({ status: 'running', steps: new Array(10).fill(0), maxSteps: 20 })).toBe(50);
    // an invalid budget is ignored
    expect(goalProgress({ status: 'running', steps: new Array(10).fill(0) }, 0)).toBe(17);
  });
});

describe('plansUtils · priority mapping', () => {
  test('number → label thresholds', () => {
    expect(priorityFromNumber(100)).toBe('high');
    expect(priorityFromNumber(90)).toBe('high');
    expect(priorityFromNumber(50)).toBe('medium');
    expect(priorityFromNumber(10)).toBe('low');
    expect(priorityFromNumber(0)).toBe('low');
    expect(priorityFromNumber(undefined)).toBe('medium');
  });

  test('label → number round-trips', () => {
    expect(priorityToNumber('high')).toBe(90);
    expect(priorityToNumber('low')).toBe(10);
    expect(priorityToNumber('medium')).toBe(50);
    expect(priorityToNumber('bogus')).toBe(50);
    expect(priorityFromNumber(priorityToNumber('high'))).toBe('high');
  });
});

describe('plansUtils · slugifyGoalTitle', () => {
  test('produces a safe slug', () => {
    expect(slugifyGoalTitle('Organize my Downloads folder')).toBe('organize-my-downloads-folder');
  });

  test('never starts with a non-alphanumeric', () => {
    expect(slugifyGoalTitle('!!!')).toMatch(/^[a-z0-9]/);
    expect(slugifyGoalTitle('  leading space')).toBe('leading-space');
  });

  test('is deterministic when `now` is supplied for the empty case', () => {
    const a = slugifyGoalTitle('', 1234567890);
    const b = slugifyGoalTitle('', 1234567890);
    expect(a).toBe(b);
    expect(a).toMatch(/^goal-/);
  });
});

describe('plansUtils · workspaceGoalToItem', () => {
  test('adapts a workspace entry into the render shape', () => {
    const item = workspaceGoalToItem({
      slug: 'tidy-inbox',
      name: 'Tidy inbox',
      content: 'Keep it clean',
      status: 'blocked',
      priority: 95,
      agent: { status: 'running', steps: [1] },
      successCriteria: 'Zero unread',
      maxSteps: 30,
      autoAbandon: true,
      createdBy: 'agent',
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(item._id).toBe('tidy-inbox');
    expect(item.type).toBe('goal');
    expect(item.data.title).toBe('Tidy inbox');
    expect(item.data.status).toBe('blocked');
    expect(item.data.priority).toBe('high');
    expect(item.data.agent.status).toBe('running');
    expect(item.data.successCriteria).toBe('Zero unread');
    expect(item.data.maxSteps).toBe(30);
    expect(item.data.autoAbandon).toBe(true);
    expect(item.data.createdBy).toBe('agent');
  });

  test('returns null for no entry and defaults missing fields', () => {
    expect(workspaceGoalToItem(null)).toBeNull();
    const item = workspaceGoalToItem({ slug: 'x' });
    expect(item.data.title).toBe('Untitled goal');
    expect(item.data.status).toBe('active');
    expect(item.data.priority).toBe('medium');
    expect(item.data.createdBy).toBe('user');
    expect(item.data.autoAbandon).toBe(false);
  });
});

describe('plansUtils · suggestionToGoalPayload', () => {
  test('folds description, tool trace and repeat count into the body', () => {
    const p = suggestionToGoalPayload({
      title: 'Sort downloads every morning',
      description: 'You open Downloads then move files',
      tools: ['fs_list', 'fs_move'],
      repeatCount: 7,
    });
    expect(p.title).toBe('Sort downloads every morning');
    expect(p.slug).toBe('sort-downloads-every-morning');
    expect(p.content).toContain('fs_list → fs_move');
    expect(p.content).toContain('Observed 7 times');
  });

  test('handles a bare suggestion', () => {
    const p = suggestionToGoalPayload(null);
    expect(p.title).toBe('Suggested automation');
    expect(p.content).toBe('');
    expect(p.slug).toMatch(/^suggested-automation/);
  });
});

describe('plansUtils · time helpers', () => {
  const now = new Date('2026-09-11T12:00:00.000Z').getTime();

  test('timeSince buckets', () => {
    expect(timeSince('', now)).toBe('');
    expect(timeSince('bogus', now)).toBe('');
    expect(timeSince('2026-09-11T11:59:30.000Z', now)).toBe('just now');
    expect(timeSince('2026-09-11T11:30:00.000Z', now)).toBe('30m ago');
    expect(timeSince('2026-09-11T09:00:00.000Z', now)).toBe('3h ago');
    expect(timeSince('2026-09-09T12:00:00.000Z', now)).toBe('2d ago');
  });

  test('isOverdue ignores finished goals and bare dates resolve to local end-of-day', () => {
    // A bare deadline is a *local calendar day*, so build `now` in local terms
    // too — otherwise this assertion would depend on the runner's timezone.
    const localNow = new Date(2026, 8, 11, 12, 0, 0).getTime();
    expect(isOverdue(null, 'active', localNow)).toBe(false);
    expect(isOverdue('2026-09-10', 'done', localNow)).toBe(false);
    expect(isOverdue('2026-09-10', 'active', localNow)).toBe(true);
    expect(isOverdue('2026-09-11', 'active', localNow)).toBe(false); // end of day today
    expect(isOverdue('bogus', 'active', localNow)).toBe(false);
  });

  test('deadlineLabel copy', () => {
    expect(deadlineLabel('2026-09-10T12:00:00.000Z', now)).toBe('Overdue');
    expect(deadlineLabel('2026-09-11T12:00:00.000Z', now)).toBe('Due today');
    expect(deadlineLabel('2026-09-12T12:00:00.000Z', now)).toBe('Due tomorrow');
    expect(deadlineLabel('2026-09-16T12:00:00.000Z', now)).toBe('5 days left');
  });
});

describe('plansUtils · sorting + grouping', () => {
  test('sortGoals puts live work before done, then priority, then recency', () => {
    const sorted = sortGoals([
      goal({ slug: 'done1', status: 'done' }),
      goal({ slug: 'low', status: 'active', priority: 'low', updatedAt: '2026-09-10T00:00:00Z' }),
      goal({ slug: 'high-old', status: 'active', priority: 'high', updatedAt: '2026-09-01T00:00:00Z' }),
      goal({ slug: 'high-new', status: 'active', priority: 'high', updatedAt: '2026-09-09T00:00:00Z' }),
      goal({ slug: 'blocked', status: 'blocked' }),
    ]);
    expect(sorted.map((g) => g._id)).toEqual(['high-new', 'high-old', 'low', 'blocked', 'done1']);
  });

  test('groupGoals buckets by status and drops empty buckets', () => {
    const groups = groupGoals([
      goal({ slug: 'a', status: 'active' }),
      goal({ slug: 'b', status: 'done' }),
      goal({ slug: 'c', status: 'blocked' }),
      goal({ slug: 'd', status: 'active' }),
    ]);
    expect(groups.map((g) => g.status)).toEqual(['active', 'blocked', 'done']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].label).toBe('In flight');
  });

  test('goalStats counts each bucket and a completion percentage', () => {
    const stats = goalStats([
      goal({ status: 'active' }),
      goal({ status: 'blocked' }),
      goal({ status: 'done' }),
      goal({ status: 'done' }),
    ]);
    expect(stats).toMatchObject({ total: 4, active: 1, blocked: 1, done: 2, pct: 50 });
    expect(goalStats([]).pct).toBe(0);
  });
});

describe('plansUtils · terminal / agent-ready', () => {
  test('isTerminalStatus', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('active')).toBe(false);
  });

  test('isAgentReady excludes finished and paused goals', () => {
    expect(isAgentReady(goal({ status: 'active' }))).toBe(true);
    expect(isAgentReady(goal({ status: 'blocked' }))).toBe(true);
    expect(isAgentReady(goal({ status: 'done' }))).toBe(false);
    expect(isAgentReady(goal({ status: 'failed' }))).toBe(false);
    expect(isAgentReady(goal({ status: 'paused' }))).toBe(false);
    expect(isAgentReady(null)).toBe(false);
  });
});
