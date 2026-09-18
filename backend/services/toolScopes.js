/**
 * toolScopes.js — capability-based gating for /net chat tools.
 *
 * Before this, privilege was a single `toolContext.isAdmin` boolean plus a
 * name-prefix hack (`toolsForContext` stripped anything starting with `repo_`).
 * Two parallel checks that had to be kept in sync — and it made it impossible
 * to grant a *narrower* privilege (e.g. read-only repo browsing) or to say
 * which capability a denial was about.
 *
 * Now every privileged tool declares the capability it needs, in ONE map:
 *
 *   - `filterToolSchemas()` hides tools the context can't use (so the model is
 *     never even offered them), and
 *   - `assertToolAllowed()` / the `executeTool` gate refuses them server-side
 *     (defense in depth — the model can hallucinate a tool name).
 *
 * Tools with no entry are public (available to every signed-in /net chat).
 */

/** tool name → required capability. Absent ⇒ public. */
const TOOL_SCOPES = Object.freeze({
  // Repository read (safe: source disclosure only).
  repo_list_files: 'repo:read',
  repo_read_file: 'repo:read',
  repo_search: 'repo:read',
  repo_git_status: 'repo:read',
  repo_git_diff: 'repo:read',
  // Repository write (mutates the working tree / creates a branch).
  repo_write_file: 'repo:write',
  repo_edit_file: 'repo:write',
  repo_commit_changes: 'repo:write',
  // Running a command. Its own capability, not folded into repo:write: this is
  // the one that EXECUTES code, and a future read-only or write-only admin
  // should be able to get edits without getting execution.
  repo_run: 'repo:run',
  // Pushing to GitHub — the only irreversible step.
  repo_push: 'repo:push',
});

/** Capabilities an ordinary signed-in user gets. */
const BASE_CAPABILITIES = Object.freeze([]);
/** Capabilities granted to the administrator. */
const ADMIN_CAPABILITIES = Object.freeze(['repo:read', 'repo:write', 'repo:run', 'repo:push']);

/**
 * tool name → approval mode (`ask` = confirm with the user first). Absent ⇒ allow.
 *
 * ⚠️ This is a CONTROL gate, not a security boundary. Capability scoping above
 * is what stops a non-admin from touching the repository; this decides whether
 * the operator wants the agent to take a particular step, and it only works when
 * the caller has somewhere to ask (see `beforeTool` in harness/toolLoop.js).
 *
 * Why `repo_commit_changes` and not `repo_push`: push already has a STRONGER,
 * message-bound gate (`isPushConfirmation` + a one-time proposal code in
 * repoAgentService.js) which a button click deliberately cannot satisfy — the
 * confirmation has to be the user's own words. Adding a prompt there would be
 * friction that only looks like safety. Commit is the step where the agent's
 * work stops being a draft, and it is the natural place to intervene.
 *
 * The addon's own tools are NOT listed here: their approval policy is owned by
 * the addon (`simple-addon/server/automation/permissions.js`) and is enforced on
 * the machine that owns the resource. One policy per machine — see
 * NET_HARNESS_PLAN.md ADR-4.
 */
const TOOL_POLICY = Object.freeze({
  repo_commit_changes: 'ask',
});

const POLICY_ALLOW = 'allow';

/** The approval mode for a tool. Anything unlisted is allowed. */
function policyFor(toolName) {
  if (!toolName) return POLICY_ALLOW;
  return Object.prototype.hasOwnProperty.call(TOOL_POLICY, toolName)
    ? TOOL_POLICY[toolName]
    : POLICY_ALLOW;
}

/** True when the harness must ask before running `toolName`. */
function requiresApproval(toolName) {
  return policyFor(toolName) === 'ask';
}

const PUBLIC = null;

/** The capability a tool requires, or null when it is public. */
function requiredScope(toolName) {
  if (!toolName) return PUBLIC;
  return Object.prototype.hasOwnProperty.call(TOOL_SCOPES, toolName)
    ? TOOL_SCOPES[toolName]
    : PUBLIC;
}

/**
 * Resolve the capability list for a context. Prefers an explicit
 * `capabilities` array (set when the context is built); falls back to deriving
 * it from the legacy `isAdmin` flag so older call sites keep working.
 */
function capabilitiesForContext(toolContext) {
  if (!toolContext) return BASE_CAPABILITIES;
  if (Array.isArray(toolContext.capabilities)) return toolContext.capabilities;
  return toolContext.isAdmin ? ADMIN_CAPABILITIES : BASE_CAPABILITIES;
}

/** True when the context may invoke `toolName`. Public tools are always true. */
function canUseTool(toolContext, toolName) {
  const scope = requiredScope(toolName);
  if (!scope) return true;
  return capabilitiesForContext(toolContext).includes(scope);
}

/**
 * Filter an OpenAI-style tool-schema list down to what the context may use.
 * Schemas are `{ type:'function', function:{ name } }`.
 */
function filterToolSchemas(schemas, toolContext) {
  if (!toolContext) return null;
  if (!Array.isArray(schemas)) return schemas;
  return schemas.filter((schema) => canUseTool(toolContext, schema?.function?.name));
}

/** Human-readable denial reason naming the missing capability. */
function denialReason(toolName) {
  const scope = requiredScope(toolName);
  return scope
    ? `tool "${toolName}" requires the "${scope}" capability, which this session does not have`
    : `tool "${toolName}" is not permitted`;
}

module.exports = {
  TOOL_SCOPES,
  TOOL_POLICY,
  BASE_CAPABILITIES,
  ADMIN_CAPABILITIES,
  requiredScope,
  policyFor,
  requiresApproval,
  capabilitiesForContext,
  canUseTool,
  filterToolSchemas,
  denialReason,
};
