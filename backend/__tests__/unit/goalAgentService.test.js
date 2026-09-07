/**
 * goalAgentService.test.js — unit tests for the pure helpers in the goal agent.
 * Only exercises deterministic logic (path sanitization) — no network, no LLM.
 */

const { sanitizeRepoPath, emptyState } = require('../../services/goalAgentService');

describe('goalAgentService.sanitizeRepoPath', () => {
  test('allows normal repo-relative paths', () => {
    expect(sanitizeRepoPath('frontend/src/App.js')).toBe('frontend/src/App.js');
    expect(sanitizeRepoPath('backend/server.js')).toBe('backend/server.js');
    expect(sanitizeRepoPath('docs/README.md')).toBe('docs/README.md');
  });

  test('strips leading slashes and ./', () => {
    expect(sanitizeRepoPath('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRepoPath('./a.js')).toBe('a.js');
  });

  test('rejects path traversal', () => {
    expect(sanitizeRepoPath('../etc/passwd')).toBeNull();
    expect(sanitizeRepoPath('a/../b')).toBeNull();
    expect(sanitizeRepoPath('..\\secret.txt')).toBeNull();
  });

  test('rejects empty segments, dot segments, and .git', () => {
    expect(sanitizeRepoPath('a//b')).toBeNull();
    expect(sanitizeRepoPath('a/./b')).toBeNull();
    expect(sanitizeRepoPath('.git/config')).toBeNull();
    expect(sanitizeRepoPath('')).toBeNull();
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(sanitizeRepoPath('src\\components\\App.jsx')).toBe('src/components/App.jsx');
  });
});

describe('goalAgentService.emptyState (run-history preservation)', () => {
  test('starts fresh when there is no previous agent state', () => {
    const state = emptyState('g1', { data: { title: 'Goal' } });
    expect(state.steps).toEqual([]);
    expect(state.summary).toBe('');
    expect(state.result).toBe('');
    expect(state.history).toEqual([]);
  });

  test('preserves a completed previous run into history instead of erasing it', () => {
    const prev = {
      status: 'done',
      startedAt: '2026-09-06T10:00:00.000Z',
      updatedAt: '2026-09-06T10:05:00.000Z',
      summary: 'Built the thing',
      result: 'Commits: abc123',
      steps: [{ ts: 'x', kind: 'tool', text: 'write_repo_file' }],
      error: null,
    };
    const state = emptyState('g1', { data: { title: 'Goal', agent: prev } });
    expect(state.steps).toEqual([]); // new run starts clean…
    expect(state.history).toHaveLength(1); // …but the old run is retained
    expect(state.history[0].status).toBe('done');
    expect(state.history[0].summary).toBe('Built the thing');
    expect(state.history[0].steps).toHaveLength(1);
  });

  test('labels a mid-run previous state as interrupted', () => {
    const prev = { status: 'running', steps: [{ ts: 'x', kind: 'thought', text: 'thinking' }] };
    const state = emptyState('g1', { data: { title: 'Goal', agent: prev } });
    expect(state.history[0].status).toBe('interrupted');
  });

  test('does not snapshot an empty/idle previous state', () => {
    const state = emptyState('g1', { data: { title: 'Goal', agent: { status: 'idle', steps: [] } } });
    expect(state.history).toEqual([]);
  });

  test('caps retained history at MAX_HISTORY entries', () => {
    let agent = { status: 'done', steps: [], summary: '' };
    for (let i = 0; i < 8; i++) {
      const run = emptyState('g1', { data: { title: 'Goal', agent } });
      agent = {
        status: 'done',
        steps: [{ ts: 'x', kind: 'tool', text: `run ${i}` }],
        summary: `run ${i}`,
        history: run.history,
      };
    }
    const finalState = agent;
    expect(finalState.history.length).toBeLessThanOrEqual(5);
  });
});
