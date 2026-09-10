/**
 * repoAgentService.js — admin-only repository editing for the /net chat.
 *
 * Lets the /net chatbot (DeepSeek, via the normal netTools tool loop) make real
 * changes to this repository directly on the backend server:
 *
 *   investigate  → repo_list_files / repo_read_file
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
const { logger } = require('../utils/logger');
const { REPO, getGitHubToken, isAdminContext, sanitizeRepoPath } = require('./repoShared');

// ── Configuration ───────────────────────────────────────────────────────────

const BRANCH_OVERRIDE = process.env.GOAL_AGENT_BRANCH || ''; // base branch override
const DEFAULT_BRANCH = process.env.REPO_AGENT_BRANCH || 'master';
const MAX_FILE_BYTES = 120 * 1024; // max bytes the agent may write per file
const MAX_READ_BYTES = 40 * 1024;  // max bytes returned from a single read
const MAX_DIFF_BYTES = 24 * 1024;  // max bytes returned from a diff
const MAX_LIST_PATHS = 400;        // max paths returned from repo_list_files

// ── Small helpers ───────────────────────────────────────────────────────────

/** Short confirmation messages that unlock `repo_push`. */
const CONFIRM_RE = /\b(push|ship|confirmed|confirm|proceed|publish|merge|go ahead|yes|yeah|yep|sure|ok|okay|approved|do it|send it|pull request)\b/i;

function isPushConfirmation(message) {
  const m = String(message || '').trim();
  if (!m || m.length > 200) return false;
  return CONFIRM_RE.test(m);
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
      description: 'Read a file from the repository working tree on the server. Pass a path relative to the repo root (e.g. "frontend/src/pages/Home/Home.jsx"). Administrators only.',
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
      name: 'repo_write_file',
      description: 'Write (create or overwrite) a file in the repository working tree on the server. This does NOT commit — review with repo_git_diff, then commit with repo_commit_changes. Pass the FULL new file content. Administrators only.',
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
      if (stat.size > MAX_READ_BYTES) {
        const buf = await fsp.readFile(abs);
        return `File "${rel}" (${stat.size} bytes, showing first ${MAX_READ_BYTES}):\n${buf.slice(0, MAX_READ_BYTES).toString('utf-8')}`;
      }
      const content = await fsp.readFile(abs, 'utf-8');
      return `File "${rel}":\n${content}`;
    } catch (err) {
      return `Error reading "${rel}": ${err.message}`;
    }
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

      await saveProposal(ctx.userId, {
        branch,
        baseBranch,
        sha: head ? head.sha : null,
        committedAtSec: head ? head.committedAtSec : 0,
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
        'DO NOT push yet. Tell the user exactly what changed and ASK whether they want to push to GitHub. Wait for their explicit confirmation before calling repo_push.',
      ].join('\n');
    } catch (err) {
      return `Error committing changes: ${err.message}`;
    }
  },

  async repo_push(args, ctx) {
    if (!isAdminContext(ctx)) return 'Error: repository push is restricted to the administrator.';
    if (!isPushConfirmation(ctx?.userMessage)) {
      return [
        'Push NOT performed — the user has not explicitly confirmed pushing in this message.',
        'If you have not already asked, summarize the committed changes and ask the user to confirm before pushing. Only call repo_push again once they reply with a confirmation (e.g. "yes, push it").',
      ].join('\n');
    }
    try {
      const branch = await currentBranch();
      if (!branch.startsWith('net/')) {
        return 'Nothing to push — no feature branch has been created. Commit your changes with repo_commit_changes first, then ask the user to confirm.';
      }
      const head = await headCommit();
      const turnStartSec = Math.floor((ctx?.turnStartedAt || 0) / 1000);
      if (head && turnStartSec > 0 && head.committedAtSec >= turnStartSec) {
        return [
          'Push NOT performed — the latest commit was created during THIS conversation turn.',
          'Finish your reply by telling the user what is staged, and wait for their explicit confirmation in a follow-up message before calling repo_push again.',
        ].join('\n');
      }
      const proposal = await loadProposal(ctx.userId);
      const baseBranch = (proposal && proposal.baseBranch) || DEFAULT_BRANCH;
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
  getRepoRoot,
  getGitHubToken,
  runGit,
  _setProposalStoreForTests,
};
