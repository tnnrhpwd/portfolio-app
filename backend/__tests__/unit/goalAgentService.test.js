/**
 * goalAgentService.test.js — unit tests for the pure helpers in the goal agent.
 * Only exercises deterministic logic (path sanitization) — no network, no LLM.
 */

const { sanitizeRepoPath } = require('../../services/goalAgentService');

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
