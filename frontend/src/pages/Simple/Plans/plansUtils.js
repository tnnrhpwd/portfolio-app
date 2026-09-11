/**
 * plansUtils.js — pure, dependency-free helpers for the /plans mission-control
 * page.
 *
 * Everything here is a plain function over goal/memory shapes so it can be unit
 * tested without mounting the component (see `plansUtils.test.js`). The page
 * itself stays a thin renderer over these.
 *
 * The canonical goal shape (workspace store, kind='goal') is produced by
 * `workspaceGoalToItem()` and looks like:
 *
 *   { _id, type: 'goal', workspace: true, data: { title, description, status,
 *     priority, deadline, agent, successCriteria, maxSteps, autoAbandon,
 *     createdBy }, createdAt, updatedAt }
 */

// ── O-O-G-P-A loop ──────────────────────────────────────────────────────────

/**
 * The agent's Observe → Orient → Goal → Plan → Action loop, plus the critic's
 * Reflect stage. `stage` values come from the addon's agent loop status
 * (`agent-loop.js` `_setStage`) and are mapped here to display order.
 */
export const OOGPA_STAGES = [
  { key: 'observe', label: 'Observe', short: 'O', stage: 'OBSERVING' },
  { key: 'orient',  label: 'Orient',  short: 'O', stage: 'ORIENTING' },
  { key: 'goal',    label: 'Goal',    short: 'G', stage: 'SELECTING_GOAL' },
  { key: 'plan',    label: 'Plan',    short: 'P', stage: 'PLANNING' },
  { key: 'act',     label: 'Act',     short: 'A', stage: 'ACTING' },
  { key: 'reflect', label: 'Reflect', short: 'R', stage: 'REFLECTING' },
];

const STAGE_LOOKUP = OOGPA_STAGES.reduce((acc, s, i) => {
  acc[s.key.toUpperCase()] = i;
  acc[s.stage] = i;
  return acc;
}, {});

/**
 * Index (0-5) of a loop stage within OOGPA_STAGES, or -1 when the loop is idle
 * / the stage is unknown.
 */
export function stageIndex(stage) {
  if (!stage) return -1;
  const i = STAGE_LOOKUP[String(stage).toUpperCase()];
  return typeof i === 'number' ? i : -1;
}

/** Human label for a raw loop stage value (e.g. 'SELECTING_GOAL' → 'Goal'). */
export function stageLabel(stage) {
  const i = stageIndex(stage);
  return i >= 0 ? OOGPA_STAGES[i].label : 'Idle';
}

/** The three nested loops described in the O-O-G-P-A design. */
export const LOOP_LABELS = {
  inner: 'Inner loop · per action',
  outer: 'Outer loop · per goal re-eval',
  meta: 'Meta loop · per session',
};

// ── Goal / memory vocabulary ────────────────────────────────────────────────

export const STATUS_LABELS = {
  active: 'Active',
  completed: 'Done',
  paused: 'Paused',
  blocked: 'Blocked',
  done: 'Done',
  failed: 'Failed',
};

export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** Goal statuses that mean the goal is finished (no more agent work expected). */
export const TERMINAL_GOAL_STATUS = ['done', 'failed'];

export function isTerminalStatus(status) {
  return TERMINAL_GOAL_STATUS.includes(status);
}

export const AGENT_PHASE_LABELS = {
  idle: 'Not started',
  running: 'Working',
  done: 'Complete',
  stopped: 'Stopped',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

/** Normalize the agent run-state into a small, renderable phase. */
export function agentPhase(agent) {
  const status = agent?.status;
  if (!status || status === 'idle') return 'idle';
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'stopped') return 'stopped';
  if (status === 'interrupted') return 'interrupted';
  return 'failed';
}

/** How many recorded steps the agent has taken on a goal. */
export function agentStepCount(agent) {
  if (!agent) return 0;
  if (Array.isArray(agent.steps)) return agent.steps.length;
  if (typeof agent.steps === 'number') return agent.steps;
  return 0;
}

/**
 * A coarse 0-100 progress read for a goal card. Deliberately conservative:
 * a still-running agent never reads as 100%, and a finished/failed goal reads
 * as terminal — the exact number is an orientation aid, not a promise.
 *
 * @param {object} agent - the goal's agent run-state
 * @param {number} [maxSteps] - the goal's configured step budget (preferred
 *   over `agent.maxSteps`, which is often absent from the mirrored payload)
 */
export function goalProgress(agent, maxSteps) {
  const phase = agentPhase(agent);
  if (phase === 'done') return 100;
  if (phase === 'failed' || phase === 'stopped') return 100;
  if (phase === 'idle') return 0;
  const steps = agentStepCount(agent);
  const budget = (typeof maxSteps === 'number' && maxSteps > 0) ? maxSteps
    : (typeof agent?.maxSteps === 'number' && agent.maxSteps > 0) ? agent.maxSteps
      : 60;
  // Cap a live run at 95% so "still working" never looks finished.
  return Math.max(5, Math.min(95, Math.round((steps / budget) * 100)));
}

// ── Priority mapping (workspace numeric 0-100 ↔ UI label) ───────────────────

export function priorityFromNumber(n) {
  if (typeof n === 'number') {
    if (n >= 90) return 'high';
    if (n <= 10) return 'low';
    return 'medium';
  }
  return 'medium';
}

export function priorityToNumber(label) {
  if (label === 'high') return 90;
  if (label === 'low') return 10;
  return 50;
}

// ── Slug / shape adapters ───────────────────────────────────────────────────

export function slugifyGoalTitle(title, now = Date.now()) {
  let slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  if (!/^[a-z0-9]/.test(slug)) slug = `goal-${slug}`.slice(0, 100);
  if (!slug) slug = `goal-${now.toString(36)}`;
  return slug;
}

/** Adapt a workspace goal entry to the memory-like item shape the UI renders. */
export function workspaceGoalToItem(entry) {
  if (!entry) return null;
  return {
    _id: entry.slug,
    type: 'goal',
    workspace: true,
    data: {
      title: entry.name || 'Untitled goal',
      description: entry.content || '',
      status: entry.status || 'active',
      priority: priorityFromNumber(entry.priority),
      deadline: null,
      agent: entry.agent || null,
      successCriteria: entry.successCriteria || null,
      constraints: entry.constraints || null,
      maxSteps: typeof entry.maxSteps === 'number' ? entry.maxSteps : null,
      autoAbandon: !!entry.autoAbandon,
      createdBy: entry.createdBy || 'user',
    },
    createdAt: entry.createdAtReal || entry.updatedAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

/**
 * Turn a pattern-learner suggestion (addon) into a cloud goal payload.
 * Keeps the honest description + the repeated tool trace in the goal body so
 * the agent has the full context when it plans.
 */
export function suggestionToGoalPayload(suggestion) {
  const title = String(suggestion?.title || 'Suggested automation').trim();
  const tools = Array.isArray(suggestion?.tools) ? suggestion.tools.filter(Boolean) : [];
  const content = [
    suggestion?.description,
    tools.length ? `Detected repeated steps: ${tools.join(' → ')}` : '',
    suggestion?.repeatCount ? `Observed ${suggestion.repeatCount} times.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { title, content, slug: slugifyGoalTitle(title) };
}

// ── Time helpers ────────────────────────────────────────────────────────────

export function timeSince(dateStr, now = Date.now()) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Parse a stored deadline. A bare `YYYY-MM-DD` is interpreted as a *local*
 * calendar day (not UTC midnight — that would shift the day by a timezone and
 * make "due today" flip a few hours early). `endOfDay` pushes it to the last
 * millisecond of that local day for overdue comparisons; the label path keeps
 * midnight.
 */
function parseDeadline(deadline, endOfDay = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(deadline));
  if (m) {
    const [, y, mo, d] = m;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
  }
  return new Date(deadline);
}

export function isOverdue(deadline, status, now = Date.now()) {
  if (!deadline || status === 'completed' || status === 'done') return false;
  const d = parseDeadline(deadline, true);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now;
}

/** Human-friendly deadline copy for a card badge. */
export function deadlineLabel(deadline, now = Date.now()) {
  if (!deadline) return '';
  const d = parseDeadline(deadline);
  if (Number.isNaN(d.getTime())) return String(deadline);
  const days = Math.round((d.getTime() - now) / 86400000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 30) return `${days} days left`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Aggregations ────────────────────────────────────────────────────────────

const STATUS_RANK = { active: 0, blocked: 1, paused: 2, failed: 3, done: 4 };

/** Status buckets the goals view renders, in priority order. */
export const GOAL_GROUP_ORDER = ['active', 'blocked', 'paused', 'failed', 'done'];

export const GOAL_GROUP_LABELS = {
  active: 'In flight',
  blocked: 'Needs you',
  paused: 'Paused',
  failed: 'Failed',
  done: 'Done',
};

/** Sort goals: live work first, then priority, then most recently touched. */
export function sortGoals(goals) {
  return [...goals].sort((a, b) => {
    const ra = STATUS_RANK[a.data?.status] ?? 5;
    const rb = STATUS_RANK[b.data?.status] ?? 5;
    if (ra !== rb) return ra - rb;
    const pa = PRIORITY_ORDER[a.data?.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.data?.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    const ua = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const ub = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return ub - ua;
  });
}

/** Bucket goals by status into the ordered groups the page renders. */
export function groupGoals(goals) {
  const groups = GOAL_GROUP_ORDER.map((status) => ({ status, label: GOAL_GROUP_LABELS[status], items: [] }));
  const byStatus = groups.reduce((acc, g) => { acc[g.status] = g; return acc; }, {});
  for (const goal of sortGoals(goals)) {
    const status = goal.data?.status || 'active';
    const bucket = byStatus[status] || byStatus.active;
    bucket.items.push(goal);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** Headline stats for the goals hero band. */
export function goalStats(goals) {
  const total = goals.length;
  const done = goals.filter((g) => g.data?.status === 'done').length;
  const blocked = goals.filter((g) => g.data?.status === 'blocked').length;
  const paused = goals.filter((g) => g.data?.status === 'paused').length;
  const failed = goals.filter((g) => g.data?.status === 'failed').length;
  const active = total - done - blocked - paused - failed;
  return { total, active, blocked, paused, failed, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** A goal is "agent-ready" when it isn't already finished. */
export function isAgentReady(goal) {
  if (!goal?.data) return false;
  const status = goal.data.status || 'active';
  return !isTerminalStatus(status) && status !== 'paused';
}
