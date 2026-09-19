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
 *
 * It DOES decide which brain takes a message when an addon is reachable, because
 * that answer depends on *how* it is reachable: a locally connected addon gets
 * first refusal (no hop at all), while one reachable only over the relay sends
 * the message to the cloud harness (same hop, strictly more capable). See step 6c.
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
 *
 * One exception is site/repo SOURCE changes (`isSiteSourceChange` below), which
 * are cloud-only by construction: the addon has no repository tools, so routing
 * them there can only waste a local agent run. The same goes for questions about
 * the user's own cloud data and for support/bug reports (`isCloudDataIntent`).
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

/**
 * Repository vocabulary. Unambiguous on its own — the desktop addon has no git
 * or repository tools at all, so these always belong to the cloud tool loop.
 */
const REPO_VOCAB_RE = /\b(?:repo|repository|codebase|source\s+code|pull\s+request)\b|\bgit\s+(?:commit|push|status|diff|checkout|branch|merge)\b|\b(?:commit|push)\s+(?:my|the|these)\s+changes\b/i;

/** "…on this website" / "…the site's code" — the SITE is named as the object. */
const SITE_TARGET_RE = /\b(?:this|the|my|our|its)\s+(?:web\s?site|web\s?app|webapp|front\s?end|back\s?end|codebase|code\s+base)\b/i;

/** A verb that asks for the thing itself to change (not for the PC to do something). */
const SOURCE_CHANGE_VERB_RE = /\b(?:increase|decrease|raise|lower|shorten|lengthen|extend|expand|limit|cap|fix|change|update|adjust|improve|remove|delete|add|rename|rewrite|refactor|resize|restyle|redesign|enable|disable|support|implement|edit|tweak|bump|make|commit|push|deploy)\b/i;

/**
 * "Change this website's own code / the repo it lives in."
 *
 * Only the CLOUD tool loop has `repo_*` tools, so this can never be a desktop
 * agent task — and a connected addon used to swallow it and flail: observed
 * 2026-09-14 on "increase the context length for the net goal description input
 * on this website", where the addon classified it `action` and burned 56 steps
 * (24 screen_captures, no progress) while the chat showed a spinner instead of
 * handing the request to the repo agent.
 *
 * Needs the site/repo to be the named object ("this website", "my repo") —
 * "open my website in chrome" or "click the button on the page" stay with the
 * addon, because `open`/`click` are not source-change verbs.
 */
export const isSiteSourceChange = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  if (REPO_VOCAB_RE.test(text)) return true;
  return SITE_TARGET_RE.test(text) && SOURCE_CHANGE_VERB_RE.test(text);
};

/**
 * Read-only questions about the user's OWN cloud data, and reports that only the
 * cloud tools can file.
 *
 * The desktop addon has no access to any of it — the cloud `get_my_goals` /
 * `get_my_notes` / `submit_support_ticket` tools own it — so routing these to the
 * desktop agent can only flail or guess. Observed 2026-09-14: "what goals do I
 * have saved right now?" was classified `action` and started a local worker that
 * took screenshots of the screen to look for them.
 *
 * Needs a question/read shape AND the cloud-data noun, so "open edge on my pc"
 * and "tidy up my downloads" still belong to the addon.
 */
const CLOUD_DATA_QUESTION_RE = new RegExp(
  '\\b(?:what|which|how many|list|show|tell me|do i have|did i|have i)\\b[^.?!]{0,40}' +
  '\\b(?:goals?|notes?|memor(?:y|ies)|reminders?|support\\s(?:tickets?|requests?))\\b', 'i'
);
const CLOUD_REPORT_RE = new RegExp(
  '\\b(?:bug\\s?report|support\\s(?:ticket|request)|feature\\srequest)\\b' +
  '|\\b(?:submit|file|raise)\\b[^.?!]{0,30}\\b(?:bug\\s?report|report|support\\s(?:ticket|request)|feature\\srequest)\\b', 'i'
);

/** True for a question/read of the user's cloud data, or a report the cloud must file. */
export const isCloudDataIntent = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  return CLOUD_DATA_QUESTION_RE.test(text) || CLOUD_REPORT_RE.test(text);
};

/** Words a short "go on then" answer is built from. */
const AFFIRMATIVE_TOKENS = new Set([
  'yes', 'yeah', 'yep', 'y', 'ok', 'okay', 'sure', 'please', 'do', 'go', 'ahead',
  'proceed', 'confirm', 'confirmed', 'approve', 'approved', 'ship', 'it', 'push',
  'now', 'lgtm', 'correct', 'right', 'fine',
]);

/**
 * A short "go on then" answer — or a literal `push <code>` — i.e. a reply to a
 * question the CLOUD asked, not a fresh instruction.
 *
 * ≤4 words and every word drawn from the affirmative set, so "yes push it",
 * "go ahead", "ship it" and "push a2e3" qualify while "open notepad" and
 * "sure, but also fix the tests" do not.
 */
export const isRepoFlowConfirmation = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.length === 2 && words[0] === 'push' && /^[a-z0-9]{4,8}$/.test(words[1])) return true;
  return words.every((w) => AFFIRMATIVE_TOKENS.has(w));
};

export const isCloudOnlyIntent = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  if (CLOUD_ONLY_PATTERNS.some((re) => re.test(text))) return true;
  return isSiteSourceChange(text) || isCloudDataIntent(text);
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
 * @param {boolean} [input.repoFlowActive]        the last assistant turn used repo_* tools
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
  repoFlowActive = false,
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

  // 6. Which brain takes it. "Reachable" is not one condition: a locally
  //    connected addon is the fast hands for PC work (no hop), while one only
  //    reachable over the relay is better served by the cloud harness (6c).
  const addonReachable = isAddonConnected || isRemoteAddonOnline;

  // 6a. A short confirmation that follows a repository-tool turn continues THAT
  //     cloud conversation: the desktop agent never saw the question (it has no
  //     repo tools), so handing it "yes push it" makes it answer something
  //     unrelated — observed 2026-09-14, when the reply was "I need more context
  //     ... what would you like me to push?" and the change was never pushed.
  if (!hasImage && repoFlowActive && addonReachable && isRepoFlowConfirmation(text)) {
    const kind = provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
    return decide(kind, 'repo-flow-confirmation', 0.9, { skippedAddon: true });
  }

  if (!hasImage && addonReachable) {
    // 6b. Cloud-only intent: the addon cannot run it anyway, so skip the hop.
    const cloudOnly = isCloudOnlyIntent(text);
    if (cloudOnly) {
      const kind = provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
      return decide(kind, 'cloud-only-intent-skip-addon', 0.8, { cloudOnly: true, skippedAddon: true });
    }

    // 6c. The addon is reachable ONLY through the relay — the browser is on a
    //     phone or another machine. The cloud harness is the better brain here,
    //     and it is NOT slower: it speaks the same relay, so reaching the PC costs
    //     the same hop either way. What it adds is everything the addon's own loop
    //     cannot do — the user's cloud data, this repository, and a PC action in
    //     the SAME turn (`pc_do`) — plus a streamed answer, a visible step list, a
    //     Stop button and an approval prompt the user can actually see.
    //
    //     The addon's own loop stays the fast path when the browser IS on that
    //     machine (`isAddonConnected`): there, reaching it costs no hop at all and
    //     its local classifier can disambiguate without a round trip.
    //
    //     Explicit "on my pc" phrasing never reaches here — step 4 already sent it
    //     straight to the relay, which is the user saying which machine they mean.
    if (!isAddonConnected && isRemoteAddonOnline) {
      const kind = provider === 'portfolio' ? ROUTE_KINDS.CHAT_CLOUD : ROUTE_KINDS.CHAT_LOCAL;
      return decide(kind, 'remote-addon-prefer-cloud-harness', 0.7, { skippedAddon: true });
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
