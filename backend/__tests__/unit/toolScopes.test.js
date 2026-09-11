/**
 * toolScopes.test.js — unit tests for capability-based tool gating.
 */

const {
  TOOL_SCOPES,
  requiredScope,
  capabilitiesForContext,
  canUseTool,
  filterToolSchemas,
  denialReason,
  BASE_CAPABILITIES,
  ADMIN_CAPABILITIES,
} = require('../../services/toolScopes');

describe('toolScopes.requiredScope', () => {
  test('returns the declared capability for privileged tools', () => {
    expect(requiredScope('repo_read_file')).toBe('repo:read');
    expect(requiredScope('repo_write_file')).toBe('repo:write');
    expect(requiredScope('repo_push')).toBe('repo:push');
  });

  test('returns null (public) for tools with no entry', () => {
    expect(requiredScope('calculate')).toBe(null);
    expect(requiredScope('save_goal')).toBe(null);
    expect(requiredScope('')).toBe(null);
  });
});

describe('toolScopes.capabilitiesForContext', () => {
  test('derives admin capabilities from the legacy isAdmin flag', () => {
    expect(capabilitiesForContext({ isAdmin: true })).toEqual(ADMIN_CAPABILITIES);
  });

  test('ordinary users get base capabilities', () => {
    expect(capabilitiesForContext({ isAdmin: false })).toEqual(BASE_CAPABILITIES);
    expect(capabilitiesForContext({})).toEqual(BASE_CAPABILITIES);
    expect(capabilitiesForContext(null)).toEqual(BASE_CAPABILITIES);
  });

  test('prefers an explicit capabilities array when present', () => {
    expect(capabilitiesForContext({ capabilities: ['repo:read'] })).toEqual(['repo:read']);
  });
});

describe('toolScopes.canUseTool', () => {
  test('public tools are always allowed', () => {
    expect(canUseTool(null, 'calculate')).toBe(true);
    expect(canUseTool({ capabilities: [] }, 'save_goal')).toBe(true);
  });

  test('privileged tools require the matching capability', () => {
    expect(canUseTool({ capabilities: ['repo:read'] }, 'repo_read_file')).toBe(true);
    expect(canUseTool({ capabilities: ['repo:read'] }, 'repo_write_file')).toBe(false);
    expect(canUseTool({ capabilities: ['repo:read'] }, 'repo_push')).toBe(false);
    expect(canUseTool({ capabilities: [] }, 'repo_read_file')).toBe(false);
  });
});

describe('toolScopes.filterToolSchemas', () => {
  const schemas = [
    { type: 'function', function: { name: 'calculate' } },
    { type: 'function', function: { name: 'repo_read_file' } },
    { type: 'function', function: { name: 'repo_push' } },
  ];

  test('hides privileged tools from a plain user', () => {
    const names = filterToolSchemas(schemas, { capabilities: [] }).map((s) => s.function.name);
    expect(names).toEqual(['calculate']);
  });

  test('offers privileged tools to an admin', () => {
    const names = filterToolSchemas(schemas, { isAdmin: true }).map((s) => s.function.name);
    expect(names).toEqual(['calculate', 'repo_read_file', 'repo_push']);
  });

  test('returns null for a null context (no tools)', () => {
    expect(filterToolSchemas(schemas, null)).toBe(null);
  });
});

describe('toolScopes.denialReason', () => {
  test('names the missing capability', () => {
    expect(denialReason('repo_push')).toMatch(/repo:push/);
  });
});

describe('toolScopes.TOOL_SCOPES', () => {
  test('every repo_* tool has a declared scope', () => {
    const repoScoped = Object.keys(TOOL_SCOPES).filter((n) => n.startsWith('repo_'));
    expect(repoScoped.length).toBeGreaterThanOrEqual(7);
    for (const name of repoScoped) {
      expect(TOOL_SCOPES[name]).toMatch(/^repo:/);
    }
  });
});
