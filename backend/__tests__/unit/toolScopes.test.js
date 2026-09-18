/**
 * toolScopes.test.js — unit tests for capability-based tool gating.
 */

const {
  TOOL_SCOPES,
  TOOL_POLICY,
  requiredScope,
  policyFor,
  requiresApproval,
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
    expect(requiredScope('repo_edit_file')).toBe('repo:write');
    expect(requiredScope('repo_push')).toBe('repo:push');
    // Execution is its own capability, not folded into repo:write — the one that
    // runs commands must be grantable (and revocable) separately.
    expect(requiredScope('repo_run')).toBe('repo:run');
  });

  test('returns null (public) for tools with no entry', () => {
    expect(requiredScope('calculate')).toBe(null);
    expect(requiredScope('save_goal')).toBe(null);
    expect(requiredScope('')).toBe(null);
  });
});

describe('toolScopes.policyFor', () => {
  test('asks before the step where the work stops being a draft', () => {
    expect(policyFor('repo_commit_changes')).toBe('ask');
    expect(requiresApproval('repo_commit_changes')).toBe(true);
  });

  test('everything else is allowed — including repo_push, which has a stronger gate', () => {
    // repo_push is deliberately NOT prompted: its existing confirmation is bound
    // to the user's own message plus a one-time proposal code, which a button
    // click must not be able to satisfy.
    expect(policyFor('repo_push')).toBe('allow');
    expect(policyFor('repo_write_file')).toBe('allow');
    expect(policyFor('calculate')).toBe('allow');
    expect(requiresApproval('repo_push')).toBe(false);
  });

  test('an unknown or missing name never prompts', () => {
    expect(policyFor('something_new')).toBe('allow');
    expect(policyFor('')).toBe('allow');
    expect(policyFor(null)).toBe('allow');
    expect(policyFor(undefined)).toBe('allow');
    expect(requiresApproval(null)).toBe(false);
  });

  test('the policy map only names tools that exist in the scope map', () => {
    // A typo here would silently disable the prompt it was meant to add.
    for (const name of Object.keys(TOOL_POLICY)) {
      expect(Object.prototype.hasOwnProperty.call(TOOL_SCOPES, name)).toBe(true);
    }
  });
});

describe('toolScopes.capabilitiesForContext', () => {
  test('derives admin capabilities from the legacy isAdmin flag', () => {
    expect(capabilitiesForContext({ isAdmin: true })).toEqual(ADMIN_CAPABILITIES);
    expect(capabilitiesForContext({ isAdmin: true })).toContain('repo:run');
    expect(capabilitiesForContext({ isAdmin: true })).toContain('repo:push');
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
    { type: 'function', function: { name: 'repo_run' } },
    { type: 'function', function: { name: 'repo_push' } },
  ];

  test('hides privileged tools from a plain user', () => {
    const names = filterToolSchemas(schemas, { capabilities: [] }).map((s) => s.function.name);
    // Execution is never even OFFERED to a non-admin: hiding it here is
    // usability, and executeTool refuses it server-side regardless.
    expect(names).toEqual(['calculate']);
  });

  test('offers privileged tools to an admin', () => {
    const names = filterToolSchemas(schemas, { isAdmin: true }).map((s) => s.function.name);
    expect(names).toEqual(['calculate', 'repo_read_file', 'repo_run', 'repo_push']);
  });

  test('a write-only context gets edits but NOT execution', () => {
    const names = filterToolSchemas(schemas, { capabilities: ['repo:write'] }).map((s) => s.function.name);
    expect(names).toEqual(['calculate']);
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
