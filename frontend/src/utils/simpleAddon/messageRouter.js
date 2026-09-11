/**
 * messageRouter.js — the ONE place that decides where a /net chat message goes.
 *
 * Before this module, "what happens to this message?" was an ordered chain of
 * `if` blocks inside `SimpleChat.jsx`'s `sendMessage`. It worked, but the
 * decision was invisible and untestable — you couldn't assert "a phone message
 * saying 'open notepad on my pc' with no addon online produces an
 * `unreachable` route" without mounting the whole component.
 *
 * `routeMessage()` is a pure function: give it the facts the client already
 * knows, get back a typed decision. The component then just switches on
 * `decision.kind`. The declared transitions (`ROUTE_TRANSITIONS`) are the
 * source for the routing diagram in the docs and are asserted against the
 * implementation by tests, so the diagram can't silently drift.
 *
 * What this module deliberately does NOT do:
 *   - It does not classify action-vs-chat. That is the addon's job
 *     (`simple-addon/server/automation/routing-classifier.js`), which owns the
 *     lexicon. Duplicating it here would create two sources of truth.
 *   - It makes no network calls and reads no globals.
 */

/** Every terminal/non-terminal destination a message can be routed to. */
export const ROUTE_KINDS = Object.freeze({
  SLASH: 'slash',                     // deterministic slash command (/run, /goal, …)
  BLOCKED: 'blocked',                 // client security pre-screen rejected it
  VISION_REQUIRED: 'vision-required', // image attached but only a local model is configured
  PC_RELAY: 'pc-relay',               // explicit "on my pc" → cloud relay to the desktop addon
  UNREACHABLE: 'unreachable',         // the user asked for the PC but no addon is reachable
  AGENT: 'agent',                     // try the addon's O-O-G-P-A loop first
  CHAT_CLOUD: 'chat-cloud',           // portfolio/cloud LLM
  CHAT_LOCAL: 'chat-local',           // addon-local HF model
});

/**
 * Declared transitions, keyed by destination. `agent` is *non-terminal*: when
 * the addon judges the message non-actionable the client falls through to one
 * of its successors. Everything else is terminal. Used for docs + drift tests.
 */
export const ROUTE_TRANSITIONS = Object.freeze({
  [ROUTE_KINDS.SLASH]: [],
  [ROUTE_KINDS.BLOCKED]: [],
  [ROUTE_KINDS.VISION_REQUIRED]: [],
  [ROUTE_KINDS.PC_RELAY]: [],
  [ROUTE_KINDS.UNREACHABLE]: [],
  [ROUTE_KINDS.AGENT]: [ROUTE_KINDS.CHAT_CLOUD, ROUTE_KINDS.CHAT_LOCAL],
  [ROUTE_KINDS.CHAT_CLOUD]: [],
  [ROUTE_KINDS.CHAT_LOCAL]: [],
});

// Explicit "control my desktop from this device" phrasing, e.g. "open edge on
// pc", "on my computer", "on the desktop". Routes through the remote addon
// relay even when the chat provider is otherwise the tool-less cloud LLM.
const PC_CONTROL_RE = /\b(?:on\s+(?:my\s+|the\s+)?|(?:my|the)\s+)(?:pc|computer|desktop|windows\s+(?:pc|machine))\b/i;
export const isPcControlRequest = (text = '') => PC_CONTROL_RE.test(text);

/**
 * Conservative "this is a cloud-only intent" detector.
 *
 * When the addon is (only) reachable over the cloud relay, every plain message
 * costs a full relay round-trip before we discover the addon can't help with
 * e.g. image generation. These patterns catch the intents the *cloud* tool loop
 * owns (generate_image, calculate, explicit web search) so we can skip the
 * addon hop. Deliberately narrow — anything uncertain returns false and takes
 * the normal addon path.
 */
const CLOUD_ONLY_PATTERNS = [
  // Image generation — needs a visual-noun and a make-verb.
  /\b(?:generate|create|draw|render|imagine|design|make|produce)\b[^.?!]{0,40}\b(?:image|picture|photo|artwork|illustration|logo|icon|avatar|wallpaper)\b/i,
  // Explicit "calculate/…" verb — the cloud `calculate` tool owns this.
  /^\s*(?:calculate|compute)\b/i,
  // A bare arithmetic expression, e.g. "2 + 2", "-3.5 * 8%".
  /^\s*[-+]?\d[\d\s+\-*/().^%]*[+\-*/^%][\d\s+\-*/().^%]*\s*[?=]?\s*$/,
  // "what is 2+2" — requires an operator so "what is my name" is NOT matched.
  /^\s*what(?:'s| is)\s+[-+]?\d[\d\s+\-*/().^%]*[+\-*/^%][\d\s+\-*/().^%]*\s*\??\s*$/i,
  // Explicit "search the web/online" (the addon has no search tool).
  /\b(?:search|look\s+up|google|find)\b[^.?!]{0,20}\b(?:web|internet|online)\b/i,
];

export const isCloudOnlyIntent = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  return CLOUD_ONLY_PATTERNS.some((re) => re.test(text));
};

/**
 * Decide where a message should go.
 *
 * @param {object} input
 * @param {string}  input.text
 * @param {boolean} [input.hasImage]
 * @param {string}  [input.provider]              'portfolio' (cloud) | 'local'
 * @param {boolean} [input.slashMatched]          a slash command already matched
 * @param {boolean} [input.securityBlocked]       client pre-screen rejected it
 * @param {boolean} [input.isAddonConnected]      local (LAN/localhost) addon reachable
 * @param {boolean} [input.isRemoteAddonOnline]   addon reachable via cloud relay
 * @param {boolean} [input.isLoggedIn]            user has a token
 * @param {boolean} [input.phoneTargetingDesktop] arrived via ?addon= QR link
 * @returns {{kind:string, reason:string, confidence:number, cloudOnly?:boolean, skippedAddon?:boolean}}
 */
export function routeMessage({
  text = '',
  hasImage = false,
  provider = 'portfolio',
  slashMatched = false,
  securityBlocked = false,
  isAddonConnected = false,
  isRemoteAddonOnline = false,
  isLoggedIn = false,
  phoneTargetingDesktop = false,
} = {}) {
  const decide = (kind, reason, confidence = 1, extra = {}) => ({
    kind, reason, confidence, ...extra,
  });

  // 1. Deterministic slash commands win outright.
  if (slashMatched) return decide(ROUTE_KINDS.SLASH, 'slash-command');

  // 2. Client security pre-screen (UX layer — the server re-checks).
  if (securityBlocked) return decide(ROUTE_KINDS.BLOCKED, 'security-prescreen');

  // 3. A screenshot can only be read by the cloud (vision) model.
  if (hasImage && provider !== 'portfolio') {
    return decide(ROUTE_KINDS.VISION_REQUIRED, 'image-needs-cloud-provider');
  }

  // 4. Explicit "on my pc" phrasing → the desktop must act, even when the chat
  //    provider is otherwise the tool-less cloud LLM.
  if (isPcControlRequest(text) && !isAddonConnected) {
    if (isRemoteAddonOnline && isLoggedIn) {
      return decide(ROUTE_KINDS.PC_RELAY, 'explicit-pc-phrasing-remote-relay');
    }
    return decide(ROUTE_KINDS.UNREACHABLE, 'explicit-pc-phrasing-no-addon');
  }

  // 5. Arrived via a QR/`?addon=` link → intent is explicitly "control my PC".
  if (phoneTargetingDesktop && !isAddonConnected && !isRemoteAddonOnline) {
    return decide(ROUTE_KINDS.UNREACHABLE, 'qr-desktop-target-no-addon');
  }

  // 6. Logic mode: let the addon's O-O-G-P-A loop try the message first —
  //    unless it's a cloud-only intent (skip the expensive relay hop).
  const addonReachable = isAddonConnected || isRemoteAddonOnline;
  if (!hasImage && addonReachable) {
    const cloudOnly = isCloudOnlyIntent(text);
    if (cloudOnly) {
      const kind = provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
      return decide(kind, 'cloud-only-intent-skip-addon', 0.8, { cloudOnly: true, skippedAddon: true });
    }
    return decide(ROUTE_KINDS.AGENT, 'addon-reachable-logic-mode', 0.6);
  }

  // 7. Plain chat — cloud or the addon's local model.
  const kind = provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
  return decide(kind, hasImage ? 'chat-with-image' : 'plain-chat');
}

/**
 * The fall-through decision when the addon says "not actionable". Kept here so
 * the agent's successors in ROUTE_TRANSITIONS stay provably correct.
 */
export function chatFallbackFor(provider = 'portfolio') {
  return provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
}
