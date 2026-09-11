/**
 * netChatContext.js — build the tool-execution context for a /net chat turn.
 *
 * This logic used to be copy-pasted (and slowly drifting) in two places in
 * llmService.js: `processCompressionRequest` and `streamCompressionRequest`.
 * Both now call `buildToolContext()` so admin/capability/turn metadata can't
 * diverge between the streaming and non-streaming paths.
 *
 * Two request shapes enable tools:
 *   1. the JSON `{ message, conversationHistory }` payload the addon sends, and
 *   2. the web /net chat's plain `Net:…` text form (`isNetChat === true`).
 */

const { capabilitiesForContext } = require('./toolScopes');

function baseContext(req) {
  return {
    userId: req.user.id,
    userEmail: req.user.email || null,
    userName: req.user.nickname || req.user.name || null,
  };
}

/**
 * @param {object} args
 * @param {object} args.req          Express request (needs `req.user`).
 * @param {string} args.userInput    The `Net:` payload or bearer text.
 * @param {boolean} args.isNetChat   Whether this is a /net chat request.
 * @returns {{toolContext: object|null, behaviorFile: string, activeAgent: any, userMessageForContext: string}}
 */
function buildToolContext({ req, userInput, isNetChat }) {
  let toolContext = null;
  let behaviorFile = 'default.txt';
  let activeAgent = null;
  let userMessageForContext = '';

  try {
    const parsed = JSON.parse(userInput);
    if (parsed.message && Array.isArray(parsed.conversationHistory)) {
      toolContext = baseContext(req);
      behaviorFile = parsed.behaviorFile || 'default.txt';
      activeAgent = parsed.activeAgent || null;
      userMessageForContext = parsed.message || '';
    }
  } catch {
    // Not a JSON Net: chat payload.
  }

  // The web /net chat posts plain "Net:…" text (not the addon's JSON shape),
  // so enable tools for it too.
  if (!toolContext && isNetChat) {
    toolContext = baseContext(req);
    userMessageForContext = userInput;
  }

  if (toolContext) {
    toolContext.isAdmin = !!(req.user && req.user.id === process.env.ADMIN_USER_ID);
    // Capability list is derived once here (see toolScopes.js) so both the
    // schema filter and the execution gate agree.
    toolContext.capabilities = capabilitiesForContext(toolContext);
    toolContext.turnStartedAt = Date.now();
    toolContext.userMessage = userMessageForContext || '';
  }

  return { toolContext, behaviorFile, activeAgent, userMessageForContext };
}

module.exports = { buildToolContext };
