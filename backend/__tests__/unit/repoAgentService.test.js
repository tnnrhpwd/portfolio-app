/**
 * repoAgentService.test.js — unit tests for the admin-only repo agent tools.
 *
 * Exercises only deterministic logic (path sanitization, confirmation
 * detection, admin gating, push guards). `child_process.execFile` is mocked so
 * no real git command (or real repository mutation) ever runs in tests.
 */

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const { execFile } = require('child_process');
const repoAgent = require('../../services/repoAgentService');

/** Install mock git handlers keyed by subcommand (first git arg). */
function mockGit(handlers) {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    const sub = Array.isArray(args) ? args[0] : '';
    const handler = handlers[sub];
    let stdout = '';
    let error = null;
    if (typeof handler === 'function') {
      const r = handler(args) || {};
      stdout = r.stdout || '';
      error = r.error || null;
    }
    process.nextTick(() => callback(error, stdout, error ? String(error.message || error) : ''));
  });
}

afterEach(() => {
  execFile.mockReset();
  delete process.env.GITHUB_TOKEN;
  delete process.env.ADMIN_USER_ID;
});

describe('repoAgentService.sanitizeRepoPath', () => {
  test('allows normal repo-relative paths', () => {
    expect(repoAgent.sanitizeRepoPath('frontend/src/App.js')).toBe('frontend/src/App.js');
    expect(repoAgent.sanitizeRepoPath('backend/server.js')).toBe('backend/server.js');
  });

  test('strips leading slashes and ./', () => {
    expect(repoAgent.sanitizeRepoPath('/etc/passwd')).toBe('etc/passwd');
    expect(repoAgent.sanitizeRepoPath('./a.js')).toBe('a.js');
  });

  test('rejects path traversal and .git', () => {
    expect(repoAgent.sanitizeRepoPath('../etc/passwd')).toBeNull();
    expect(repoAgent.sanitizeRepoPath('a/../b')).toBeNull();
    expect(repoAgent.sanitizeRepoPath('a/./b')).toBeNull();
    expect(repoAgent.sanitizeRepoPath('.git/config')).toBeNull();
    expect(repoAgent.sanitizeRepoPath('')).toBeNull();
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(repoAgent.sanitizeRepoPath('src\\components\\App.jsx')).toBe('src/components/App.jsx');
  });
});

describe('repoAgentService.isPushConfirmation', () => {
  test('accepts short confirmation messages', () => {
    expect(repoAgent.isPushConfirmation('yes, push it')).toBe(true);
    expect(repoAgent.isPushConfirmation('push')).toBe(true);
    expect(repoAgent.isPushConfirmation('ship it')).toBe(true);
    expect(repoAgent.isPushConfirmation('go ahead')).toBe(true);
    expect(repoAgent.isPushConfirmation('confirmed')).toBe(true);
  });

  test('rejects implementation requests and empty/long messages', () => {
    expect(repoAgent.isPushConfirmation('implement a new feature')).toBe(false);
    expect(repoAgent.isPushConfirmation('')).toBe(false);
    expect(repoAgent.isPushConfirmation('x'.repeat(300))).toBe(false);
  });
});

describe('repoAgentService.isAdminContext', () => {
  test('accepts the isAdmin flag', () => {
    expect(repoAgent.isAdminContext({ isAdmin: true })).toBe(true);
    expect(repoAgent.isAdminContext({ isAdmin: false })).toBe(false);
    expect(repoAgent.isAdminContext({})).toBe(false);
  });

  test('matches the ADMIN_USER_ID on the user object', () => {
    process.env.ADMIN_USER_ID = 'admin-123';
    expect(repoAgent.isAdminContext({ user: { id: 'admin-123' } })).toBe(true);
    expect(repoAgent.isAdminContext({ user: { id: 'someone-else' } })).toBe(false);
  });
});

describe('repoAgentService.REPO_TOOL_SCHEMAS', () => {
  test('exports the full repo tool set with valid schema shape', () => {
    const names = repoAgent.REPO_TOOL_SCHEMAS.map((t) => t.function.name);
    expect(names).toEqual([
      'repo_list_files',
      'repo_read_file',
      'repo_write_file',
      'repo_git_status',
      'repo_git_diff',
      'repo_commit_changes',
      'repo_push',
    ]);
    for (const tool of repoAgent.REPO_TOOL_SCHEMAS) {
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.parameters).toBeDefined();
    }
  });
});

describe('repoAgentService tool admin gating', () => {
  test('repo_write_file is restricted for non-admins', async () => {
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_write_file(
      { path: 'frontend/src/App.js', content: 'x' },
      { isAdmin: false }
    );
    expect(result).toMatch(/restricted to the administrator/);
  });

  test('repo_commit_changes is restricted for non-admins', async () => {
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_commit_changes(
      { message: 'test' },
      { isAdmin: false }
    );
    expect(result).toMatch(/restricted to the administrator/);
  });

  test('repo_push is restricted for non-admins', async () => {
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { isAdmin: false, userMessage: 'yes, push it' }
    );
    expect(result).toMatch(/restricted to the administrator/);
  });

  test('repo_write_file rejects invalid paths and oversized content', async () => {
    const badPath = await repoAgent.REPO_TOOL_EXECUTORS.repo_write_file(
      { path: '../evil.js', content: 'x' },
      { isAdmin: true }
    );
    expect(badPath).toBe('Error: invalid file path.');

    const huge = await repoAgent.REPO_TOOL_EXECUTORS.repo_write_file(
      { path: 'frontend/src/App.js', content: 'x'.repeat(200 * 1024) },
      { isAdmin: true }
    );
    expect(huge).toMatch(/file too large/);
  });
});

describe('repoAgentService.repo_push', () => {
  test('refuses when the user has not confirmed in this message', async () => {
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { isAdmin: true, userMessage: 'make the button bigger', turnStartedAt: Date.now() }
    );
    expect(result).toMatch(/Push NOT performed/);
    expect(result).toMatch(/has not explicitly confirmed/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('reports nothing to push when not on a feature branch', async () => {
    mockGit({ 'rev-parse': () => ({ stdout: 'master\n' }) });
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { isAdmin: true, userMessage: 'yes, push it', turnStartedAt: Date.now() }
    );
    expect(result).toMatch(/Nothing to push/);
    expect(result).toMatch(/no feature branch/);
  });

  test('refuses a same-turn commit even with a confirmation', async () => {
    mockGit({
      'rev-parse': () => ({ stdout: 'net/test-branch\n' }),
      'log': () => ({ stdout: `abc123 ${Math.floor(Date.now() / 1000)}\n` }),
    });
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { isAdmin: true, userMessage: 'yes, push it', turnStartedAt: Date.now() }
    );
    expect(result).toMatch(/Push NOT performed/);
    expect(result).toMatch(/created during THIS conversation turn/);
  });

  test('pushes the feature branch when confirmed from a previous turn', async () => {
    mockGit({
      'rev-parse': () => ({ stdout: 'net/test-branch\n' }),
      'log': () => ({ stdout: 'abc123 1700000000\n' }),
      push: () => ({ stdout: '' }),
    });
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { isAdmin: true, userMessage: 'yes, push it', turnStartedAt: Date.now() }
    );
    expect(result).toMatch(/Pushed feature branch net\/test-branch/);
    expect(result).toMatch(/compare/);
    expect(result).toContain('abc123');
  });
});
