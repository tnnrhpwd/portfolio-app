/**
 * repoShared.js — shared repo-access primitives for the two repo-editing
 * agents:
 *
 *   - goalAgentService.js  (the /plans "Goal Agent", edits via the GitHub API)
 *   - repoAgentService.js  (the /net chat repo agent, edits via local git)
 *
 * Single source of truth for: repo identity, the GitHub token, admin gating,
 * repo-path sanitization, and GitHub-API path encoding. Both agents route all
 * repo reads/writes through these so the safety rules can't drift apart.
 */

const REPO = process.env.GOAL_AGENT_REPO || 'tnnrhpwd/portfolio-app';

function getGitHubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

/**
 * Repo access is an admin-only capability: an ordinary user (or a stolen user
 * JWT) must not be able to read source, write files, or drive code to GitHub.
 */
function isAdminContext(ctx) {
  return !!(ctx && (
    ctx.isAdmin === true ||
    (ctx.user && ctx.user.id === process.env.ADMIN_USER_ID)
  ));
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

module.exports = {
  REPO,
  getGitHubToken,
  isAdminContext,
  sanitizeRepoPath,
  encodePath,
};
