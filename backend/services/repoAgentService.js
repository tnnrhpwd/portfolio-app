/**
 * repoAgentService.js — admin-only repository editing for the /net chat.
 *
 * Lets the /net chatbot (DeepSeek, via the normal netTools tool loop) make real
 * changes to this repository directly on the backend server:
 *
 *   investigate  → repo_search / repo_read_file (page) / repo_list_files
 *   implement    → repo_write_file            (working tree, not committed)
 *   review       → repo_git_status / repo_git_diff
 *   stage        → repo_commit_changes        (git add -A + git commit on a feature branch)
 *   push         → repo_push                  (git push the feature branch, user-confirmed)
 *
 * Changes land on a `net/<slug>-<ts>` feature branch (never `master` directly)
 * so every chat-driven edit becomes a reviewable, revertable PR. The push is
 * the only irreversible step, so `repo_push` is triple-guarded:
 *   1. admin only (same ADMIN_USER_ID check as goalAgentService),
 *   2. the current-turn user message must be an explicit confirmation, and
 *   3. the HEAD commit must be from a *previous* turn (never stage-and-push
 *      in a single shot — even if the user typed "...and push it").
 *
 * Repo identity, the GitHub token, admin gating, and path sanitization are
 * shared with goalAgentService.js via repoShared.js so the safety rules can't
 * drift apart. Git runs against the on-disk clone (cwd = repo root, found by
 * walking up from this file's directory to `.git`); the GitHub token is passed
 * to git via `http.extraHeader` so it never appears in the remote URL or logs.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { REPO, getGitHubToken, isAdminContext, sanitizeRepoPath } = require('./repoShared');
const repoRunner = require('./repoRunner.js');

/** The task list the tool description advertises — derived, never hand-copied. */
const TASK_SUMMARY = repoRunner.taskSummary();

// ── Configuration ───────────────────────────────────────────────────────────

const BRANCH_OVERRIDE = process.env.GOAL_AGENT_BRANCH || ''; // base branch override
const DEFAULT_BRANCH = process.env.REPO_AGENT_BRANCH || 'master';
const MAX_FILE_BYTES = 120 * 1024; // max bytes the agent may write per file
const MAX_READ_BYTES = 40 * 1024;  // max bytes returned from a single read
const MAX_DIFF_BYTES = 24 * 1024;  // max bytes returned from a diff
const MAX_LIST_PATHS = 400;        // max paths returned from repo_list_files

/**
 * Token economics (measured 2026-09-18).
 *
 * The loop re-sends its fixed prefix on EVERY model call — 24 tool schemas
 * (≈3.8K tokens) plus the system prompt — and one repo turn can spend up to 18
 * model calls (1 + 16 rounds + wrap-up). So a tool RESULT is not paid for once:
 * it is re-sent on every later call in the turn, and read results dominate (a
 * whole 40 KB file is ≈10K tokens carried to the end of the turn).
 *
 * Two rules follow, and they are why these limits are LINES PER PAGE rather
 * than "hand back the whole file":
 *   1. a read returns a bounded page whose header carries the total line count
 *      and the offset to ask for next — a truncated answer is a turn-around,
 *      never a dead end (which is what "showing first 40960 bytes" was).
 *   2. searching is far cheaper than reading, so `repo_search` returns
 *      `file:line` matches without file contents, and the agent is told to
 *      search first and read only the region it needs.
 */
const READ_DEFAULT_LINES = 800;    // lines per page when the caller gives no limit
const MAX_READ_LINES = 2000;       // ceiling for one page, whatever is asked for
const SEARCH_DEFAULT_MATCHES = 60; // matching lines returned when not specified
const MAX_SEARCH_MATCHES = 200;    // hard cap on repo_search result lines
const MAX_SEARCH_LINE_CHARS = 240; // one long minified line must not blow the budget
const MAX_SEARCH_QUERY_CHARS = 400;

/** Generated or vendored trees — never worth grepping, and huge if we did. */
const SEARCH_EXCLUDES = [
  ':(exclude)node_modules',
  ':(exclude)dist',
  ':(exclude)build',
  ':(exclude)coverage',
  ':(exclude)*.min.js',
  ':(exclude)*.lock',
];

// ── Small helpers ───────────────────────────────────────────────────────────

/**
 * Push confirmation is deliberately narrow (repo-audit follow-up):
 *
 *   - STRONG tokens ("push", "ship it", "go ahead", …) count anywhere in a
 *     short message, because they unambiguously mean "push";
 *   - WEAK affirmatives ("yes", "ok", "sure", …) only count when the *whole*
 *     message is essentially just that token — so "ok, but also fix the tests"
 *     can no longer unlock a push.
 *
 * Each committed change also gets a one-time confirmation CODE (stored on the
 * proposal); replying `push <code>` is the strongest signal and is the flow the
 * system prompt tells the model to ask for.
 */
const STRONG_PUSH_RE = /(?:\bpush\b|\bship(?:\s+it)?\b|\bgo\s+ahead\b|\bproceed\b|\bapproved\b|\bconfirm(?:ed)?\b)/i;
const WEAK_AFFIRM_RE = /^(?:yes|yeah|yep|y|sure|ok(?:ay)?|do\s+it|go|please\s+do)[\s.!,]*$/i;
const MAX_CONFIRM_LEN = 160;

/** Proposal lifetime — a "ready to push" record goes stale after 30 minutes. */
const PROPOSAL_TTL_MS = 30 * 60 * 1000;

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short, single-use confirmation code (e.g. "7f3a"). */
function newConfirmCode() {
  return crypto.randomBytes(2).toString('hex');
}

function isPushConfirmation(message, proposal = null) {
  const m = String(message || '').trim();
  if (!m || m.length > MAX_CONFIRM_LEN) return false;
  // An exact code match is the strongest signal and short-circuits.
  if (proposal && proposal.code) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(proposal.code)}([^\\p{L}\\p{N}]|$)`, 'iu');
    if (re.test(m)) return true;
  }
  if (STRONG_PUSH_RE.test(m)) return true;
  return WEAK_AFFIRM_RE.test(m);
}

function truncate(str, n) {
  if (!str) return '';
  const s = String(str);
  return s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s;
}

function truncateDiff(text) {
  if (Buffer.byteLength(text, 'utf-8') <= MAX_DIFF_BYTES) return text;
  return text.slice(0, MAX_DIFF_BYTES) + `\n…(diff truncated at ${MAX_DIFF_BYTES} bytes)`;
}

/** Integer arg with a default and bounds — never trust the model's JSON. */
function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Normalise a read request into a bounded page of lines.
 *
 * Pure and exported so the paging arithmetic is testable without a git repo —
 * the failure that matters here is an off-by-one in the "continue with
 * offset=N" header, which would either re-read a line forever or skip one.
 *
 * @param {string} content  the whole file
 * @param {object} [args]   raw tool arguments ({ offset, limit }, both 1-based)
 * @returns {{total:number,start:number,end:number,truncated:boolean,overLimit:boolean,body:string}}
 */
function pageLines(content, args = {}) {
  const lines = String(content ?? '').split('\n');
  // A file that ends with a newline leaves an empty final element. Dropping it
  // makes `total` the number of lines a person would count ("3 lines" for a
  // 3-line file, not 4), which is also the number the model pages against.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;

  const start = Math.min(clampInt(args?.offset, 1, 1, Number.MAX_SAFE_INTEGER), Math.max(total, 1));
  // A limit below 1 is nonsense from a model, and honouring it literally would
  // return a ONE-line page it then re-requests — fall back to a full page.
  const askedLimit = Number(args?.limit);
  const limit = Number.isFinite(askedLimit) && askedLimit >= 1
    ? Math.min(Math.floor(askedLimit), MAX_READ_LINES)
    : READ_DEFAULT_LINES;
  const wanted = lines.slice(start - 1, start - 1 + limit);

  // Accumulate whole lines until the byte cap is reached, so `end` is always a
  // real line and the next offset can never point into the middle of one.
  const kept = [];
  let bytes = 0;
  let cut = false;
  for (const line of wanted) {
    const lineBytes = Buffer.byteLength(line, 'utf-8') + (kept.length ? 1 : 0); // +1 for '\n'
    if (bytes + lineBytes <= MAX_READ_BYTES) {
      kept.push(line);
      bytes += lineBytes;
      continue;
    }
    cut = true;
    // One line longer than the whole cap (a minified bundle): return a bounded
    // piece of it. An empty page would be re-requested at the same offset
    // forever, and returning the line whole costs more than the file it avoided.
    if (!kept.length) kept.push(line.slice(0, MAX_READ_BYTES));
    break;
  }

  const end = start + kept.length - 1;
  return {
    total,
    start,
    end,
    truncated: end < total,
    overLimit: cut,
    body: kept.join('\n'),
  };
}

// ── Git plumbing ────────────────────────────────────────────────────────────

let _repoRoot = null;

/** Walk up from this file (backend/services) until a `.git` dir is found. */
function getRepoRoot() {
  // Test/local hook: point the agent at an arbitrary repo (e.g. a temp clone).
  if (process.env.REPO_AGENT_ROOT) return process.env.REPO_AGENT_ROOT;
  if (_repoRoot) return _repoRoot;
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      _repoRoot = dir;
      return _repoRoot;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve a sanitized repo-relative path to an absolute path (or null). */
function absRepoPath(repoPath) {
  const root = getRepoRoot();
  if (!root) return null;
  return path.join(root, repoPath);
}

/** Run a git command in the repo root and return trimmed stdout. */
function execFileP(file, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || '').trim();
        const e = new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
        e.cause = error;
        reject(e);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

async function runGit(args, opts = {}) {
  const root = getRepoRoot();
  if (!root) {
    throw new Error('Git repository not found on this server (no .git directory at or above backend/).');
  }
  return execFileP('git', args, { cwd: root, ...opts });
}

/**
 * `git grep` exits 1 when nothing matched — that is an answer, not a failure.
 * `runGit` rejects on any non-zero exit, so unwrap that one code here and let
 * everything else (a bad regex, a missing path) surface as a real error.
 */
async function runGitGrep(args) {
  try {
    return await runGit(args);
  } catch (err) {
    if (err?.cause?.code === 1) return '';
    throw err;
  }
}

async function currentBranch() {
  if (BRANCH_OVERRIDE) return BRANCH_OVERRIDE;
  try {
    const b = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (b && b !== 'HEAD') return b;
  } catch { /* detached or missing — fall through */ }
  return DEFAULT_BRANCH;
}

/** Slug from a commit message for a feature-branch name. */
function branchSlug(text) {
  return String(text || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'change';
}

function newBranchName(message) {
  const ts = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(':', '');
  return `net/${branchSlug(message)}-${ts}`;
}

/**
 * Make sure we are on a `net/…` feature branch. Reuses the current one when the
 * repo is already on a feature branch (so a conversation that commits more than
 * once accumulates on one branch); otherwise branches off the current base and
 * carries any staged changes along.
 */
async function ensureFeatureBranch(message, userId) {
  const cur = await currentBranch();
  if (cur.startsWith('net/')) {
    const prop = await loadProposal(userId);
    return { branch: cur, baseBranch: (prop && prop.baseBranch) || DEFAULT_BRANCH };
  }
  const branch = newBranchName(message);
  await runGit(['checkout', '-b', branch]);
  return { branch, baseBranch: cur || DEFAULT_BRANCH };
}

/** HEAD commit `{ sha, committedAtSec }`, or null when the repo has no commits. */
async function headCommit() {
  try {
    const out = (await runGit(['log', '-1', '--format=%H %ct'])).trim();
    const [sha, ct] = out.split(/\s+/);
    const committedAtSec = parseInt(ct, 10);
    return { sha, committedAtSec: Number.isNaN(committedAtSec) ? 0 : committedAtSec };
  } catch {
    return null;
  }
}

/** Push the current branch; authenticate with GITHUB_TOKEN when present. */
async function pushBranch(branch) {
  const token = getGitHubToken();
  if (token) {
    // Pass the credential via http.extraHeader so the token never lands in the
    // remote URL (which git would echo in error messages). Using the env form
    // also keeps the token out of the process argument list.
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    };
    await runGit(
      ['push', `https://github.com/${REPO}.git`, `HEAD:refs/heads/${branch}`],
      { env }
    );
  } else {
    // No server token — rely on the machine's own git credentials (local dev).
    await runGit(['push', 'origin', branch]);
  }
}

// ── Proposal state (explicit "ready to push" record) ───────────────────────
// Persisted per-user so `repo_push` can prove a commit was proposed in a prior
// turn and push exactly that feature branch — never an unrelated local commit.
// Falls back to git-derived checks when DynamoDB is unavailable (local dev).

const PROPOSAL_CREATED_AT = '2000-01-01T00:00:00.000Z';
let _proposalStore = null;

function proposalStore() {
  if (_proposalStore) return _proposalStore;
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const ddb = DynamoDBDocumentClient.from(client);
  _proposalStore = {
    async save(userId, proposal) {
      await ddb.send(new PutCommand({
        TableName: 'Simple',
        Item: {
          id: `csimple_repoagent_${userId}_proposal`,
          text: JSON.stringify(proposal),
          createdAt: PROPOSAL_CREATED_AT,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    async load(userId) {
      const { Item } = await ddb.send(new GetCommand({
        TableName: 'Simple',
        Key: { id: `csimple_repoagent_${userId}_proposal`, createdAt: PROPOSAL_CREATED_AT },
      }));
      if (!Item || !Item.text) return null;
      try { return JSON.parse(Item.text); } catch { return null; }
    },
    async clear(userId) {
      await ddb.send(new DeleteCommand({
        TableName: 'Simple',
        Key: { id: `csimple_repoagent_${userId}_proposal`, createdAt: PROPOSAL_CREATED_AT },
      }));
    },
  };
  return _proposalStore;
}

/** Best-effort proposal persistence — never throws to the caller. */
async function saveProposal(userId, proposal) {
  try { await proposalStore().save(userId, proposal); }
  catch (err) { logger.warn('[repoAgent] proposal save failed:', err.message); }
}
async function loadProposal(userId) {
  try { return await proposalStore().load(userId); }
  catch { return null; }
}
async function clearProposal(userId) {
  try { await proposalStore().clear(userId); } catch { /* best effort */ }
}

/** Test hook: swap the proposal store for an in-memory fake. */
function _setProposalStoreForTests(store) { _proposalStore = store; }

// ── Tool schemas (OpenAI function-calling format) ──────────────────────────

const REPO_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'repo_list_files',
      description: 'List the files in this website\'s repository (tracked by git) so you can find the right files to inspect or edit. Administrators only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_read_file',
      description: 'Read a file — or one page of lines from it — in the repository working tree on the server. Pass a path relative to the repo root (e.g. "frontend/src/pages/Home/Home.jsx"). A large file comes back as a page: the header gives the total line count and the offset to ask for next, so page through it rather than rewriting it blindly. The body has NO line numbers, so copy old_string for repo_edit_file exactly as the code appears. Use repo_search first when you are looking for something rather than reading a file you already know. Administrators only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative file path' },
          offset: { type: 'integer', description: 'First line to return, 1-based (default 1)' },
          limit: { type: 'integer', description: `How many lines to return (default ${READ_DEFAULT_LINES}, max ${MAX_READ_LINES})` },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_search',
      description: 'Search the repository and return matching `file:line` locations with the matching line. Use this FIRST to find where something lives: it costs far less than reading files and it tells you the exact lines to read or edit. Searches git-tracked files only, in the working tree (so your uncommitted edits are found); node_modules, dist, build, coverage, minified files and lockfiles are excluded. Administrators only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The text to find — a plain substring unless regex is true' },
          regex: { type: 'boolean', description: 'Treat query as an extended regular expression (default false = literal substring, which is what you usually want for code you can see)' },
          path: { type: 'string', description: 'Optional repo-relative file or directory to limit the search to, e.g. "frontend/src" or "backend/services/llmService.js"' },
          ignore_case: { type: 'boolean', description: 'Case-insensitive match (default false)' },
          max_results: { type: 'integer', description: `Maximum matching lines to return (default ${SEARCH_DEFAULT_MATCHES}, hard cap ${MAX_SEARCH_MATCHES})` },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_write_file',
      description: 'Write (create or overwrite) a file in the repository working tree on the server. Use this to CREATE a file, or to rewrite one completely. To change part of an EXISTING file prefer repo_edit_file — a full rewrite of a large file can exceed the per-call output limit and come back cut off. This does NOT commit — review with repo_git_diff, then commit with repo_commit_changes. Pass the FULL new file content. Administrators only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative file path to create/update' },
          content: { type: 'string', description: 'Full new content of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_edit_file',
      description: 'Make a targeted edit to an EXISTING repository file: replaces old_string with new_string. Prefer this for any change to a file that already exists — it only needs the changed snippet, so it cannot be cut off the way a full rewrite of a large file can. Read the file first (repo_read_file) and copy old_string EXACTLY, including indentation. old_string must appear exactly once unless replace_all is true. This does NOT commit — review with repo_git_diff, then commit with repo_commit_changes. Administrators only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative file path to edit' },
          old_string: { type: 'string', description: 'Exact existing snippet to replace (include enough surrounding lines to be unique)' },
          new_string: { type: 'string', description: 'Snippet to replace it with' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence (default false — refuses when old_string is ambiguous)' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_run',
      description: `Run one of the project's own checks and get its output. You CANNOT pass a command — pick a task from the fixed list and the exact command is fixed server-side. Run the NARROWEST check that covers your change after editing (usually test:file with the file you touched), and report what it actually said. Tasks: ${TASK_SUMMARY}. Administrators only.`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', enum: repoRunner.TASK_NAMES, description: 'Which check to run.' },
          target: { type: 'string', description: 'Required by test:file — the repo-relative test file, e.g. "backend/__tests__/unit/toolLoop.test.js".' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_git_status',
      description: 'Show the repository git status (current branch and changed files) plus a diff stat. Administrators only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_git_diff',
      description: 'Show the staged and unstaged diffs of your working-tree changes so you can review exactly what will be committed. Administrators only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_commit_changes',
      description: 'Stage all working-tree changes (git add -A) and commit them on a new feature branch (net/<slug>-<timestamp>) — never directly on master. Does NOT push. After committing, summarize what changed and ASK the user whether to push — never push in the same turn. Administrators only.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Short commit message describing the change' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_push',
      description: 'Push the committed feature branch (net/<slug>-<timestamp>) to GitHub and return a compare/pull-request link. ONLY call this after the user has explicitly replied to your "want me to push?" question with a confirmation (e.g. "yes, push it"). This tool refuses to run otherwise. Administrators only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// ── Tool executors ──────────────────────────────────────────────────────────

const REPO_TOOL_EXECUTORS = {
  async repo_list_files(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    try {
      const out = await runGit(['ls-files']);
      const all = out.split('\n').map((s) => s.trim()).filter(Boolean);
      const relevant = all.filter((p) => {
        if (/^(node_modules|\.git|coverage|dist|build|\.next)\//.test(p)) return false;
        if (/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|lock|ico|mp3|mp4|zip|jar)$/i.test(p)) return false;
        return true;
      });
      const shown = relevant.slice(0, MAX_LIST_PATHS);
      return [
        `Repository files (${REPO}) — ${relevant.length} relevant paths${relevant.length > MAX_LIST_PATHS ? ' (truncated)' : ''}:`,
        ...shown,
      ].join('\n');
    } catch (err) {
      return `Error listing repository: ${err.message}`;
    }
  },

  async repo_read_file(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    const rel = sanitizeRepoPath(args?.path);
    if (!rel) return 'Error: invalid file path.';
    const abs = absRepoPath(rel);
    if (!abs) return 'Error: repository not available on this server.';
    try {
      const stat = await fsp.stat(abs);
      if (stat.isDirectory()) {
        const entries = (await fsp.readdir(abs)).slice(0, 200)
          .map((e) => `[entry] ${path.join(rel, e).replace(/\\/g, '/')}`)
          .join('\n');
        return `"${rel}" is a directory. Entries:\n${entries}`;
      }
      const content = await fsp.readFile(abs, 'utf-8');
      const page = pageLines(content, args);
      const header = page.truncated
        ? `File "${rel}" — lines ${page.start}–${page.end} of ${page.total}; continue with offset=${page.end + 1}:`
        : `File "${rel}" (${page.total} lines):`;
      const note = page.overLimit
        ? `\n…(page cut at ${MAX_READ_BYTES} bytes — ask for a smaller limit to see the rest of these lines)`
        : '';
      return `${header}\n${page.body}${note}`;
    } catch (err) {
      return `Error reading "${rel}": ${err.message}`;
    }
  },

  /**
   * Run an allowlisted project check. The argv and the environment come from
   * repoRunner.js — this executor only authorises and reports.
   */
  async repo_run(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    const task = String(args?.task || '').trim();
    if (!task) return `Error: task is required. Allowed: ${repoRunner.TASK_NAMES.join(', ')}.`;

    const result = await repoRunner.runTask({
      task,
      target: args?.target,
      repoRoot: getRepoRoot(),
    });

    if (result.error && !result.output) return `Error: ${result.error}`;

    const status = result.timedOut
      ? 'TIMED OUT'
      : result.ok
        ? 'PASSED'
        : `FAILED (exit ${result.exitCode ?? 'unknown'})`;
    const header = `${result.command || task} — ${status} in ${(result.durationMs / 1000).toFixed(1)}s`;
    // Say WHAT was kept, not just that something was dropped.
    //
    // The old note ("trimmed to the first and last lines") became actively
    // misleading once the shaping started rescuing failures from the middle: a
    // model that reads "first and last lines" concludes the failure detail is not
    // in the result, and goes off to re-read the source — which is the exact
    // behaviour `repo_run` exists to remove. Naming the excerpts is what makes the
    // result trustworthy enough to act on.
    const note = !result.truncated
      ? ''
      : result.excerpts
        ? `\n(output was trimmed to its first and last lines PLUS ${result.excerpts} failure excerpt(s) taken from the middle — the failure detail IS below, so read it before re-reading the source)`
        : '\n(output was trimmed to the first and last lines)';
    return `${header}${note}\n\n${result.output}`;
  },

  async repo_search(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    const query = String(args?.query ?? '');
    if (!query.trim()) return 'Error: query is required.';
    if (query.length > MAX_SEARCH_QUERY_CHARS) {
      return `Error: query is too long (max ${MAX_SEARCH_QUERY_CHARS} characters).`;
    }

    const asRegex = !!args?.regex;
    const maxResults = clampInt(args?.max_results, SEARCH_DEFAULT_MATCHES, 1, MAX_SEARCH_MATCHES);

    // `-e` separates the pattern from the pathspecs, so a query that starts with
    // a dash can never be read as a flag. execFile (not a shell) means the query
    // is passed as one argv element — no quoting or injection surface.
    const gitArgs = ['grep', '--no-color', '-n', '-I', asRegex ? '-E' : '-F'];
    if (args?.ignore_case) gitArgs.push('-i');

    let scope = '.';
    if (args?.path !== undefined) {
      const rel = sanitizeRepoPath(args.path);
      if (!rel) return 'Error: invalid search path.';
      scope = rel;
    }
    gitArgs.push('-e', query, '--', scope, ...SEARCH_EXCLUDES);

    let out;
    try {
      out = await runGitGrep(gitArgs);
    } catch (err) {
      return `Error searching: ${err.message}`;
    }

    const matches = out.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
    const where = args?.path ? ` under "${args.path}"` : '';
    if (!matches.length) {
      return `No matches for ${asRegex ? 'pattern' : 'text'} "${query}"${where}.\n`
        + '(Searched git-tracked text files in the working tree only — node_modules, dist, build, '
        + 'coverage, minified files and lockfiles are excluded, so a miss there is expected.)';
    }

    const shown = matches.slice(0, maxResults).map((l) => truncate(l, MAX_SEARCH_LINE_CHARS));
    const fileCount = new Set(matches.map((l) => l.split(':')[0])).size;
    const more = matches.length > shown.length
      ? ` — showing the first ${shown.length}; narrow the query or pass a path to see the rest`
      : '';
    return [
      `${matches.length} matching line(s) in ${fileCount} file(s)${where}${more}:`,
      ...shown,
    ].join('\n');
  },

  async repo_write_file(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository edits are restricted to the administrator.';
    const rel = sanitizeRepoPath(args?.path);
    if (!rel) return 'Error: invalid file path.';
    if (typeof args?.content !== 'string') return 'Error: content must be a string.';
    if (Buffer.byteLength(args.content, 'utf-8') > MAX_FILE_BYTES) {
      return `Error: file too large (max ${MAX_FILE_BYTES} bytes).`;
    }
    const abs = absRepoPath(rel);
    if (!abs) return 'Error: repository not available on this server.';
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, args.content, 'utf-8');
      return `Wrote "${rel}" (${Buffer.byteLength(args.content, 'utf-8')} bytes) to the working tree. NOT committed yet — review with repo_git_diff, then commit with repo_commit_changes.`;
    } catch (err) {
      return `Error writing "${rel}": ${err.message}`;
    }
  },

  async repo_edit_file(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository edits are restricted to the administrator.';
    const rel = sanitizeRepoPath(args?.path);
    if (!rel) return 'Error: invalid file path.';
    const oldString = args?.old_string;
    const newString = args?.new_string;
    if (typeof oldString !== 'string' || oldString.length === 0) {
      return 'Error: old_string must be a non-empty string.';
    }
    if (typeof newString !== 'string') return 'Error: new_string must be a string.';
    if (oldString === newString) return 'Error: old_string and new_string are identical — nothing to change.';
    const abs = absRepoPath(rel);
    if (!abs) return 'Error: repository not available on this server.';
    try {
      let current;
      try {
        current = await fsp.readFile(abs, 'utf-8');
      } catch {
        return `Error: "${rel}" does not exist — create it with repo_write_file instead.`;
      }

      const occurrences = current.split(oldString).length - 1;
      if (occurrences === 0) {
        return `Error: old_string was not found in "${rel}". Read it with repo_read_file and copy the snippet exactly, including whitespace.`;
      }
      const replaceAll = args?.replace_all === true;
      if (occurrences > 1 && !replaceAll) {
        return `Error: old_string appears ${occurrences} times in "${rel}" — include more surrounding context to make it unique, or pass replace_all: true.`;
      }

      // Function replacement form: `$&`/`$1` in new_string must stay literal.
      const updated = replaceAll
        ? current.split(oldString).join(newString)
        : current.replace(oldString, () => newString);
      if (Buffer.byteLength(updated, 'utf-8') > MAX_FILE_BYTES) {
        return `Error: the edited file would be too large (max ${MAX_FILE_BYTES} bytes).`;
      }

      await fsp.writeFile(abs, updated, 'utf-8');
      return `Edited "${rel}" (${occurrences} replacement${occurrences === 1 ? '' : 's'}). NOT committed yet — review with repo_git_diff, then commit with repo_commit_changes.`;
    } catch (err) {
      return `Error editing "${rel}": ${err.message}`;
    }
  },

  async repo_git_status(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    try {
      const branch = await currentBranch();
      const status = await runGit(['status', '--porcelain=v1', '--branch']);
      const stat = await runGit(['diff', '--stat']);
      return `Branch: ${branch}\n\n${status}\n\nDiff stat:\n${stat || '(no unstaged changes)'}`;
    } catch (err) {
      return `Error reading git status: ${err.message}`;
    }
  },

  async repo_git_diff(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository access is restricted to the administrator.';
    try {
      const staged = await runGit(['diff', '--cached']);
      const unstaged = await runGit(['diff']);
      const parts = [];
      if (staged.trim()) parts.push(`STAGED CHANGES (git diff --cached):\n${truncateDiff(staged)}`);
      if (unstaged.trim()) parts.push(`UNSTAGED CHANGES (git diff):\n${truncateDiff(unstaged)}`);
      if (parts.length === 0) return 'No changes in the working tree (nothing staged or unstaged).';
      return parts.join('\n\n');
    } catch (err) {
      return `Error reading git diff: ${err.message}`;
    }
  },

  async repo_commit_changes(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository edits are restricted to the administrator.';
    const message = String(args?.message || 'Automated change via /net chat').trim().slice(0, 200)
      || 'Automated change via /net chat';
    try {
      await runGit(['add', '-A']);
      const stagedFiles = await runGit(['diff', '--cached', '--name-only']);
      if (!stagedFiles.trim()) return 'No changes to commit — the working tree already matches HEAD.';
      const diffStat = await runGit(['diff', '--cached', '--stat']);

      // Feature-branch isolation: never commit straight to the base branch.
      const { branch, baseBranch } = await ensureFeatureBranch(message, ctx.userId);
      await runGit(['commit', '-m', message]);
      const head = await headCommit();
      const files = stagedFiles.trim().split('\n').map((f) => `- ${f}`).join('\n');

      // Record an explicit, expiring, branch-bound push proposal with a
      // one-time confirmation code. repo_push will only push *this* branch,
      // only before it expires, and only on a matching confirmation.
      const code = newConfirmCode();
      await saveProposal(ctx.userId, {
        branch,
        baseBranch,
        sha: head ? head.sha : null,
        committedAtSec: head ? head.committedAtSec : 0,
        code,
        expiresAt: Date.now() + PROPOSAL_TTL_MS,
      });

      return [
        `Committed ${stagedFiles.trim().split('\n').length} file(s) on feature branch ${branch} (base: ${baseBranch}):`,
        files,
        `Commit: ${head ? head.sha : 'unknown'}`,
        `Message: ${message}`,
        '',
        'Changes:',
        diffStat.trim() || '(no diff stat)',
        '',
        `DO NOT push yet. Tell the user exactly what changed and ASK whether they want to push to GitHub.`,
        `Include this one-time confirmation code in your question so they can reply with it: ${code}`,
        `Suggested wording: "Reply \`push ${code}\` (or just 'yes, push it') to confirm." Wait for their reply before calling repo_push.`,
      ].join('\n');
    } catch (err) {
      return `Error committing changes: ${err.message}`;
    }
  },

  async repo_push(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository push is restricted to the administrator.';
    try {
      // Load the explicit push proposal FIRST and bind everything to it. This
      // is what stops a stray "ok" from pushing an unrelated local commit.
      const proposal = await loadProposal(ctx.userId);
      if (!proposal || !proposal.branch) {
        return 'Nothing to push — no feature branch has been created. Commit your changes with repo_commit_changes first, then ask the user to confirm.';
      }
      if (proposal.expiresAt && Date.now() > proposal.expiresAt) {
        await clearProposal(ctx.userId);
        return 'Push NOT performed — the pending change is stale (older than 30 minutes). Commit again to create a fresh confirmation code.';
      }

      // Require an explicit confirmation bound to THIS proposal (the one-time
      // code, or a strong push phrase, or a short bare "yes").
      if (!isPushConfirmation(ctx?.userMessage, proposal)) {
        return [
          'Push NOT performed — the user has not explicitly confirmed pushing in this message.',
          proposal.code
            ? `Ask the user to reply \`push ${proposal.code}\` (or an explicit "yes, push it"), then call repo_push again.`
            : 'Summarize the committed changes and ask the user to confirm before pushing.',
        ].join('\n');
      }

      const branch = await currentBranch();
      if (!branch.startsWith('net/')) {
        return 'Nothing to push — the repository is not on a feature branch. Commit your changes with repo_commit_changes first.';
      }
      // The committed branch must match the proposed branch — never push a
      // different branch than the one the user was shown and confirmed.
      if (branch !== proposal.branch) {
        return `Refusing to push: the current branch (${branch}) does not match the proposed branch (${proposal.branch}). Re-run repo_commit_changes and ask again.`;
      }

      const head = await headCommit();
      const turnStartSec = Math.floor((ctx?.turnStartedAt || 0) / 1000);
      if (head && turnStartSec > 0 && head.committedAtSec >= turnStartSec) {
        return [
          'Push NOT performed — the latest commit was created during THIS conversation turn.',
          'Finish your reply by telling the user what is staged, and wait for their explicit confirmation in a follow-up message before calling repo_push again.',
        ].join('\n');
      }

      const baseBranch = proposal.baseBranch || DEFAULT_BRANCH;
      await pushBranch(branch);
      await clearProposal(ctx.userId);
      const compareUrl = `https://github.com/${REPO}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}`;
      return [
        `Pushed feature branch ${branch} to GitHub (${REPO}).`,
        head ? `Head commit: ${head.sha}` : '',
        `Review / open a pull request: ${compareUrl}`,
      ].filter(Boolean).join('\n');
    } catch (err) {
      return `Error pushing to GitHub: ${err.message}`;
    }
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  REPO_TOOL_SCHEMAS,
  REPO_TOOL_EXECUTORS,
  // Test/observability exports (pure helpers, no side effects).
  sanitizeRepoPath,
  isAdminContext,
  isPushConfirmation,
  pageLines,
  getRepoRoot,
  getGitHubToken,
  runGit,
  _setProposalStoreForTests,
  // Push-confirmation policy (exported for tests + docs).
  PROPOSAL_TTL_MS,
  newConfirmCode,
};
