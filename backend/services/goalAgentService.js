/**
 * goalAgentService.js — LLM "Goal Agent" for the /plans page.
 *
 * Runs a bounded ReAct (reason + act) loop against a single user goal. The
 * agent can:
 *   - inspect the website repository (list tree / read files)
 *   - edit files and commit directly to the default branch via the GitHub API
 *     (only when a GITHUB_TOKEN is configured — otherwise it degrades to
 *     "plan / deliver" mode and never touches code)
 *   - propose a plan and deliver a final result for non-repo goals (budgets,
 *     research, writing, advice, …)
 *
 * Run state is persisted onto the goal's memory item under `data.agent`:
 *   { status, startedAt, updatedAt, goalId, goalTitle, summary, result, steps, error }
 *
 * Only ONE run per goal at a time (in-memory registry). Progress is written
 * to DynamoDB after each loop round so the frontend can poll it live.
 */

const { createCompletion, createBedrockChatCompletion, PROVIDERS } = require('../utils/llmProviders');
const { BEDROCK_MODEL_ID } = require('./bedrockService');
const { updateMemoryItem } = require('./memoryService');
const { logger } = require('../utils/logger');

// ── Configuration ───────────────────────────────────────────────────────────

const REPO = process.env.GOAL_AGENT_REPO || 'tnnrhpwd/portfolio-app';
const BRANCH_OVERRIDE = process.env.GOAL_AGENT_BRANCH || ''; // '' → read GitHub default branch

const MAX_TOOL_ROUNDS = 12;        // LLM loop iterations
const MAX_TOTAL_TOOL_CALLS = 30;   // total tool invocations across all rounds
const MAX_STORED_STEPS = 60;       // cap on persisted progress entries
const MAX_FILE_BYTES = 120 * 1024; // max size of a file the agent may write
const MAX_READ_BYTES = 40 * 1024;  // max bytes of a file returned to the LLM
const STEP_TEXT_MAX = 1000;        // max chars stored per step in DynamoDB

// In-memory registry of active runs (goalId → { startedAt, abort })
const _runs = new Map();

// ── Small helpers ───────────────────────────────────────────────────────────

function truncate(str, n) {
  if (!str) return '';
  const s = String(str);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function getGitHubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function isRunning(goalId) {
  return _runs.has(goalId);
}

function stopGoalAgentRun(goalId) {
  const run = _runs.get(goalId);
  if (run) run.abort = true;
  return !!run;
}

/** Validate + normalize a repo-relative path. Returns null when unsafe. */
function sanitizeRepoPath(input) {
  if (typeof input !== 'string') return null;
  let p = input.trim().replace(/\\/g, '/');
  while (p.startsWith('/')) p = p.slice(1);
  if (p.startsWith('./')) p = p.slice(2);
  if (!p || p.length > 500) return null;
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (segments[0] === '.git') return null;
  return p;
}

/** Encode each path segment so it is safe in a GitHub API URL. */
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function githubApi(method, path, body) {
  const token = getGitHubToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sthopwood-goal-agent',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || text || res.statusText;
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return json;
}

let _defaultBranch = null;
async function getDefaultBranch() {
  if (BRANCH_OVERRIDE) return BRANCH_OVERRIDE;
  if (_defaultBranch) return _defaultBranch;
  const data = await githubApi('GET', `/repos/${REPO}`);
  _defaultBranch = data.default_branch || 'master';
  return _defaultBranch;
}

// ── LLM provider selection ─────────────────────────────────────────────────

function pickProvider() {
  if (PROVIDERS.deepseek.apiKey) {
    return { kind: 'openai', provider: 'deepseek', model: 'deepseek-chat' };
  }
  if (PROVIDERS.bedrock.apiKey) {
    return { kind: 'bedrock', provider: 'bedrock', model: BEDROCK_MODEL_ID };
  }
  return null;
}

async function callLlmWithTools(messages, sel) {
  if (sel.kind === 'bedrock') {
    return createBedrockChatCompletion(messages, {
      maxTokens: 2500,
      temperature: 0.4,
      tools: TOOL_SCHEMAS,
      tool_choice: 'auto',
    });
  }
  return createCompletion(sel.provider, sel.model, messages, {
    maxTokens: 2500,
    temperature: 0.4,
    tools: TOOL_SCHEMAS,
    tool_choice: 'auto',
  });
}

// ── Tool schemas (OpenAI function-calling format) ──────────────────────────

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_repo_tree',
      description: `List the file tree of the website repository (${REPO}) so you can find the right files to edit.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_repo_file',
      description: 'Read the contents of a file in the repository. Pass a path relative to the repo root (e.g. "frontend/src/pages/Home/Home.jsx").',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative file path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_repo_file',
      description: 'Create or update a file in the repository and commit it directly to the default branch. Pass the FULL new file content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative file path to create/update' },
          content: { type: 'string', description: 'Full new content of the file' },
          message: { type: 'string', description: 'Short commit message describing the change' },
        },
        required: ['path', 'content', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description: 'Record a step-by-step plan you will follow so the user can see it in the progress view.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered plan steps' },
        },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deliver_result',
      description: 'Finish the run and hand back the final outcome. Use this for goals that are NOT code changes (budgets, research, writing, advice, planning) — or after you have finished editing code.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-paragraph summary of what was accomplished' },
          details: { type: 'string', description: 'Optional longer deliverable (e.g. the actual budget, the list of commits)' },
        },
        required: ['summary'],
      },
    },
  },
];

// ── Tool executors ──────────────────────────────────────────────────────────

const TOOL_EXECUTORS = {
  async list_repo_tree() {
    if (!getGitHubToken()) {
      return 'GitHub token not configured — I cannot inspect the repository. I will plan instead of editing code.';
    }
    const branch = await getDefaultBranch();
    const data = await githubApi('GET', `/repos/${REPO}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const all = (data.tree || []).map((t) => t.path).filter(Boolean);
    const relevant = all.filter((p) => {
      if (/^(node_modules|\.git|coverage|dist|build|\.next)\//.test(p)) return false;
      if (/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|lock|ico|mp3|mp4|zip)$/.test(p)) return false;
      return true;
    });
    const shown = relevant.slice(0, 400);
    return [
      `Repository file tree (${REPO}, branch ${branch}) — ${relevant.length} relevant paths${relevant.length > 400 ? ' (truncated)' : ''}:`,
      ...shown,
    ].join('\n');
  },

  async read_repo_file(args) {
    const path = sanitizeRepoPath(args?.path);
    if (!path) return 'Error: invalid file path.';
    if (!getGitHubToken()) return 'GitHub token not configured — cannot read the repository.';
    const branch = await getDefaultBranch();
    const data = await githubApi('GET', `/repos/${REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
    if (Array.isArray(data)) {
      const listing = data.map((e) => `${e.type === 'dir' ? '[dir] ' : '[file]'}${e.path}`).join('\n');
      return `"${path}" is a directory. Entries:\n${listing}`;
    }
    if (!data.content) return `File "${path}" is empty or binary.`;
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    if (content.length > MAX_READ_BYTES) {
      return `File "${path}" (${content.length} bytes, showing first ${MAX_READ_BYTES}):\n${content.slice(0, MAX_READ_BYTES)}`;
    }
    return `File "${path}":\n${content}`;
  },

  async write_repo_file(args) {
    const path = sanitizeRepoPath(args?.path);
    if (!path) return 'Error: invalid file path.';
    if (typeof args?.content !== 'string') return 'Error: content must be a string.';
    if (Buffer.byteLength(args.content, 'utf-8') > MAX_FILE_BYTES) {
      return `Error: file too large (max ${MAX_FILE_BYTES} bytes).`;
    }
    if (!getGitHubToken()) {
      return 'GitHub token not configured — I cannot edit code. I will deliver a plan instead.';
    }
    const message = String(args.message || `Update ${path}`).slice(0, 200);
    const branch = await getDefaultBranch();

    // Determine if the file already exists so we can supply its sha (required
    // by the GitHub contents API for updates).
    let sha = null;
    try {
      const existing = await githubApi('GET', `/repos/${REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
      if (existing && !Array.isArray(existing)) sha = existing.sha;
    } catch { /* 404 → new file */ }

    const body = {
      message,
      content: Buffer.from(args.content, 'utf-8').toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    const data = await githubApi('PUT', `/repos/${REPO}/contents/${encodePath(path)}`, body);
    return [
      `Committed "${path}" to ${branch} (${sha ? 'updated existing file' : 'new file'}).`,
      `Commit: ${(data.commit && data.commit.html_url) || (data.commit && data.commit.sha) || 'ok'}`,
    ].join('\n');
  },

  async propose_plan(args, ctx) {
    const steps = (Array.isArray(args?.steps) ? args.steps : [])
      .filter((s) => typeof s === 'string' && s.trim())
      .slice(0, 20);
    if (steps.length === 0) return 'Error: no plan steps provided.';
    const text = `Plan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    pushStep(ctx.state, { kind: 'plan', text: truncate(text, 2000) });
    return 'Plan recorded.';
  },

  async deliver_result(args, ctx) {
    const summary = String(args?.summary || '').trim();
    const details = String(args?.details || '').trim();
    ctx.runCtx.finish = true;
    ctx.runCtx.finalSummary = summary;
    if (details) {
      ctx.state.result = truncate(details, 8000);
      pushStep(ctx.state, { kind: 'result', text: truncate(details, 4000) });
    }
    return 'Result delivered — run complete.';
  },
};

async function executeTool(name, args, ctx) {
  const executor = TOOL_EXECUTORS[name];
  if (!executor) return `Error: unknown tool "${name}".`;
  try {
    return await executor(args || {}, ctx);
  } catch (err) {
    logger.error(`[goalAgent] tool "${name}" failed:`, err.message);
    return `Error executing ${name}: ${err.message}`;
  }
}

// ── Run-state management ────────────────────────────────────────────────────

function pushStep(state, step) {
  state.steps.push({ ts: new Date().toISOString(), ...step });
  if (state.steps.length > MAX_STORED_STEPS) state.steps = state.steps.slice(-MAX_STORED_STEPS);
}

function emptyState(goalId, goal) {
  return {
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    goalId,
    goalTitle: goal?.data?.title || 'Untitled goal',
    summary: '',
    result: '',
    steps: [],
    error: null,
  };
}

async function persistState(userId, goalId, state) {
  state.updatedAt = new Date().toISOString();
  try {
    await updateMemoryItem(userId, goalId, { agent: state });
  } catch (err) {
    // Persisting progress is best-effort — never crash the run because a
    // DynamoDB write hiccuped.
    logger.warn('[goalAgent] persistState failed:', err.message);
  }
}

function summarizeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  return out;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return [
    'You are the Goal Agent for a user\'s sthopwood.com workspace. You autonomously make progress on ONE goal without asking the user questions.',
    '',
    'Determine the nature of the goal:',
    `- If it involves changing or improving the user's website code (repo: ${REPO}), inspect files with list_repo_tree and read_repo_file, then make minimal, correct edits with write_repo_file. Each write_repo_file call commits directly to the default branch.`,
    '- If the goal is NOT about the website repo (budgets, research, writing, advice, planning), DO NOT touch the repo. Produce the actual deliverable and call deliver_result with the full content in `details`.',
    '',
    'Rules:',
    '- Inspect before editing. Prefer small, correct, minimal changes over large rewrites.',
    '- Keep file edits syntactically valid and consistent with the surrounding code.',
    '- Do not create throwaway files unless the goal asks for them.',
    '- Do not ask the user questions — work autonomously and make reasonable assumptions.',
    '- When finished, call deliver_result with a clear summary of what you changed or produced.',
  ].join('\n');
}

function buildUserPrompt(goal) {
  const d = goal?.data || {};
  const parts = ['Work on this goal now:', '', `Title: ${d.title || 'Untitled'}`];
  if (d.description) parts.push(`Description: ${d.description}`);
  if (d.priority) parts.push(`Priority: ${d.priority}`);
  if (d.deadline) parts.push(`Deadline: ${d.deadline}`);
  parts.push('', 'Decide the approach, then take concrete action (propose_plan is optional).');
  return parts.join('\n');
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function _loop(userId, goalId, goal, state, runCtx) {
  const sel = pickProvider();
  if (!sel) {
    state.status = 'failed';
    state.error = 'No LLM provider configured on the server (set DEEPSEEK_API_KEY).';
    pushStep(state, { kind: 'error', text: state.error });
    await persistState(userId, goalId, state);
    return;
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(goal) },
  ];

  let toolCallsTotal = 0;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (runCtx.abort) {
      state.status = 'stopped';
      pushStep(state, { kind: 'error', text: 'Stopped by the user.' });
      await persistState(userId, goalId, state);
      return;
    }

    const response = await callLlmWithTools(messages, sel);
    const choice = response?.choices?.[0];
    const message = choice?.message;

    const text = String(message?.content || '').trim();
    if (text) pushStep(state, { kind: 'thought', text: truncate(text, STEP_TEXT_MAX) });

    if (!message?.tool_calls || message.tool_calls.length === 0) {
      // Free-text final answer
      state.summary = text || 'Agent completed.';
      state.status = 'done';
      await persistState(userId, goalId, state);
      return;
    }

    messages.push(message);

    for (const tc of message.tool_calls) {
      if (runCtx.abort || runCtx.finish) break;
      toolCallsTotal++;
      if (toolCallsTotal > MAX_TOTAL_TOOL_CALLS) {
        runCtx.finish = true;
        break;
      }

      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }

      pushStep(state, { kind: 'tool', text: `Calling ${name}`, meta: { tool: name, args: summarizeArgs(args) } });

      const result = await executeTool(name, args, { userId, goalId, state, runCtx });
      pushStep(state, { kind: 'tool-result', text: truncate(result, STEP_TEXT_MAX), meta: { tool: name } });

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }

    await persistState(userId, goalId, state);

    if (runCtx.finish) {
      state.status = runCtx.abort ? 'stopped' : 'done';
      if (runCtx.finalSummary) state.summary = runCtx.finalSummary;
      if (!state.summary) state.summary = 'Agent completed.';
      await persistState(userId, goalId, state);
      return;
    }
  }

  state.status = 'done';
  if (!state.summary) state.summary = 'Agent reached its step limit.';
  await persistState(userId, goalId, state);
}

/**
 * Start an agent run for a goal. Resolves when the run has finished (or
 * failed). The caller may fire-and-forget this; progress is persisted to the
 * goal item throughout.
 */
async function runGoalAgent({ userId, goalId, goal }) {
  if (_runs.has(goalId)) {
    throw Object.assign(new Error('An agent is already working on this goal.'), { statusCode: 409 });
  }

  const runCtx = { startedAt: new Date().toISOString(), abort: false, finish: false, finalSummary: '' };
  _runs.set(goalId, runCtx);

  const state = emptyState(goalId, goal);
  await persistState(userId, goalId, state);

  try {
    await _loop(userId, goalId, goal, state, runCtx);
  } catch (err) {
    state.status = 'failed';
    state.error = err.message;
    pushStep(state, { kind: 'error', text: err.message });
    await persistState(userId, goalId, state);
    logger.error('[goalAgent] run failed:', err.message);
  } finally {
    _runs.delete(goalId);
  }
}

module.exports = {
  runGoalAgent,
  stopGoalAgentRun,
  isRunning,
  pickProvider,
  sanitizeRepoPath,
  TOOL_SCHEMAS,
};
