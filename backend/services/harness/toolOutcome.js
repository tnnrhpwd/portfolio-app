/**
 * toolOutcome.js — classify a failed step, so the model gets an INSTRUCTION
 * instead of a message.
 *
 * G9 of NET_HARNESS_PLAN.md. Before this, every failure reached the model as one
 * flat string — `Error: <whatever>` — and the loop added nothing to it. That is
 * the difference between a tool that returns data and a harness that runs a
 * loop: a competent engineer reading "Error: old_string was not found in x.js"
 * does not send the same edit again, and a model with nothing but that string
 * very often does. The five failure modes below need five DIFFERENT next moves,
 * and the string alone does not say which:
 *
 *   transient     a glitch (rate limit, timeout, reset) — retry, and it will work
 *   invalid-input the ARGUMENTS were wrong — fix them, do not repeat them
 *   not-found     the target does not exist — find the real one, do not guess again
 *   permission    a DECISION was made (policy, refusal, no credits) — repeating is
 *                 pointless and re-asking is worse
 *   fatal         everything else — stop and report
 *
 * So every failure now leaves the loop carrying its kind, a one-line instruction
 * written for that kind, and (for the one case where it is safe) whether the
 * harness already retried it.
 *
 * **Retrying is a decision, not a reflex.** A transient failure on a
 * `read`-scoped tool is retried ONCE by the loop itself, without spending a model
 * round — a flaky network read should not cost a round trip through the model.
 * Nothing else is ever auto-retried, because "transient" is a property of the
 * error while "safe to repeat" is a property of the TOOL: re-running
 * `generate_image` costs credits, re-running `save_goal` writes a second goal, and
 * a `pc_do` drives the user's real machine. That list is therefore explicit and
 * conservative — it names what has been verified, not what looks plausible.
 */

const { TOOL_SCOPES } = require('../toolScopes.js');

/** The five ways a step can fail. */
const KINDS = Object.freeze({
  TRANSIENT: 'transient',
  INVALID_INPUT: 'invalid-input',
  NOT_FOUND: 'not-found',
  PERMISSION: 'permission',
  FATAL: 'fatal',
});

/**
 * Signals, most specific first. Order matters: a message often matches several
 * patterns, and the first one that fits decides which next move the model is
 * told to make — so "repository not available on this server" must be read as
 * environment broken (fatal), never as a bad argument from the model.
 */
const SIGNALS = [
  {
    kind: KINDS.PERMISSION,
    // A refusal from a policy, a gate, or a quota. Also the loop's own
    // `Denied:` (an unapproved step) and the addon's "Denied by permission
    // policy" text, which arrives through pc_do as the tool's result.
    re: /\bdenied\b|\bnot approved\b|permission policy|not permitted|not allowed|forbidden|unauthorized|restricted to the administrator|capability|not enough (?:storage|credits)|requires cloud ai credits|kill switch|dry-?run/i,
  },
  {
    kind: KINDS.NOT_FOUND,
    // The named thing isn't there. Includes the runner's "unknown task", the PC's
    // "is not one of this PC's tools", ENOENT from git/fs, and a search that found
    // nothing (`repo_search` reports "0 matches", and a miss must not read as
    // "try again" — it is the model's cue to look somewhere else).
    re: /not found|no such file|does not exist|enoent|unknown tool|unknown task|is not one of|no matches|\b0 matches\b|no such (?:file|directory|branch)/i,
  },
  {
    kind: KINDS.FATAL,
    // The server or the feature is broken, disabled, or misconfigured. Nothing the
    // model writes will change it — so this is checked BEFORE invalid-input, which
    // would otherwise read "not available"/"requires" as something to fix.
    re: /repository not available|not configured|not enabled|disabled on this server|runner is disabled|model access not enabled/i,
  },
  {
    kind: KINDS.INVALID_INPUT,
    // The arguments can be fixed by the model: wrong shape, too long, empty,
    // a snippet that doesn't match, an unsupported option.
    re: /invalid|must be|is required|are required|requires a|are empty|was empty|cut off|no goals were received|no valid|too long|too large|max \d+|unsupported|not supported|identical|appears \d+ times|out of range/i,
  },
  {
    kind: KINDS.TRANSIENT,
    // Worth another try as-is.
    re: /throttl|rate ?limit|too many requests|timed? ?out|timeout|etimedout|econnreset|econnrefused|eai_again|socket hang up|temporarily|try again|is busy|unavailable right now|\b50[234]\b/i,
  },
];

/** AWS SDK / error-object signals that the message text alone would miss. */
const TRANSIENT_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'RequestTimeout',
  'RequestTimeoutException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'InternalServerException',
  'BEDROCK_THROTTLED',
  'ProvisionedThroughputExceededException',
  'TimeoutError',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

/**
 * Tools that may be repeated safely, so a transient failure can be retried by the
 * loop itself. Everything here is a pure READ that costs nothing measurable.
 *
 * Deliberately NOT here: `generate_image` (credits), anything that writes
 * (`save_goal`, `save_note`, `update_memory`, memory/personality/behavior files,
 * `repo_write_file`, `repo_edit_file`, `repo_commit_changes`, `repo_push`),
 * `repo_run` (executes code and takes time), `pc_do` (drives the user's real
 * machine), and `summarize_conversation` (spends a model call). A read of the
 * repo is covered by its `repo:read` capability rather than being listed.
 */
const RETRY_SAFE_TOOLS = new Set([
  'pc_status',
  'calculate',
  'get_current_datetime',
  'get_my_goals',
  'get_my_notes',
]);

/**
 * The refusal CAUSE, when the producer labelled one.
 *
 * `pcTools.interpretPcFailure` writes a refusal as `Denied (<cause>): …`, where
 * the parenthetical comes from a closed vocabulary (see `refusalCause.js`: kill
 * switch, policy deny, user declined, prompt expired). That is a field encoded in
 * a string, not prose — so this is an exact, anchored match, and anything that
 * does not fit yields null rather than a confident wrong answer.
 *
 * It exists because "a decision was made" is not specific enough to act on: a
 * refusal a PERSON made or missed can be re-asked, and one a stored SETTING made
 * cannot. Only the producer knows which, and the step record has to carry it for
 * the UI to offer a retry that is not a lie.
 */
const { CAUSE_LABEL_RE } = require('./refusalCause.js');

/** True when repeating this tool cannot change state or spend money. */
function isRetrySafeTool(toolName) {
  if (!toolName) return false;
  if (RETRY_SAFE_TOOLS.has(toolName)) return true;
  return TOOL_SCOPES[toolName] === 'repo:read';
}

/**
 * Does this result string read as a failure at all?
 *
 * The vocabulary is deliberately tiny and shared with the rest of the harness:
 * `Error: ` is what every tool prefixes a failure with, `Error executing <tool>: `
 * is `netTools`' catch-all, and `Denied: ` is what the loop's approval gate — and
 * the PC relay's own refusal — produce. A refusal counts as a failure here even
 * though the journal gives it its own status: either way the step did not do what
 * was asked, and the model must not be told it succeeded.
 */
function isFailureText(result) {
  const text = String(result ?? '').trim();
  return /^(?:Error|Denied)(?::|\s)/.test(text);
}

/**
 * Classify a step's outcome.
 *
 * @param {object} args
 * @param {string} [args.result]  the result string the tool produced
 * @param {Error}  [args.error]   the error a throwing executor raised, if any
 * @returns {{failed: boolean, kind: string|null, retryable: boolean, note: string|null}}
 *   `retryable` means the HARNESS may repeat it by itself (see
 *   `isRetrySafeTool`); it is not advice for the model.
 */
function classifyToolOutcome({ result = '', error = null } = {}) {
  const text = String(result ?? '').trim();

  // The loop's own synthetic results. A cancelled step is not a failure — the
  // turn stopped on purpose and the model is being told so, not handed a problem.
  if (/^Cancelled:/.test(text)) {
    return { failed: false, kind: null, cause: null, retryable: false, note: null };
  }

  const failed = !!error || isFailureText(text);
  if (!failed) return { failed: false, kind: null, cause: null, retryable: false, note: null };

  const haystack = `${error ? `${error.name || ''} ${error.message || ''} ` : ''}${text}`;
  const code = error?.code || error?.name || '';
  const awsRetryable = !!(error && (error.$retryable || error.$metadata?.httpStatusCode >= 500));

  let kind = null;
  if (TRANSIENT_CODES.has(String(code)) || awsRetryable) {
    kind = KINDS.TRANSIENT;
  } else {
    for (const signal of SIGNALS) {
      if (signal.re.test(haystack)) { kind = signal.kind; break; }
    }
  }
  if (!kind) kind = KINDS.FATAL;

  return {
    failed: true,
    kind,
    // Carried, not re-derived. `cause` is null for every refuser that did not
    // label itself (the harness's own approval gate, an older addon), and the
    // reader must treat null as "unknown", never as "retryable".
    cause: CAUSE_LABEL_RE.exec(text)?.[1] || null,
    retryable: kind === KINDS.TRANSIENT,
    note: noteFor(kind),
  };
}

/**
 * The instruction appended to a failure. Written for the MODEL, so it says the
 * next move rather than restating the problem — the tool's own message already
 * describes the problem.
 */
function noteFor(kind, { alreadyRetried = false } = {}) {
  switch (kind) {
    case KINDS.TRANSIENT:
      return alreadyRetried
        ? '\n\nHARNESS: TRANSIENT failure — the harness already retried this step once and it failed the same way. Do not retry a third time: report what could not be done.'
        : '\n\nHARNESS: TRANSIENT failure — a temporary glitch (rate limit, timeout, connection), not a mistake in the request. Retrying this step once, unchanged, is the right next move.';
    case KINDS.INVALID_INPUT:
      return '\n\nHARNESS: INVALID INPUT — the ARGUMENTS were the problem, not the environment. Fix them and retry once. Do NOT send the same arguments again.';
    case KINDS.NOT_FOUND:
      return '\n\nHARNESS: NOT FOUND — the target does not exist. Do NOT repeat the same name: establish the correct one first (list, search, or read it).';
    case KINDS.PERMISSION:
      return '\n\nHARNESS: REFUSED — this was a decision, not a glitch. It will fail identically if repeated, so do not retry it and do not rephrase it. Tell the user what was refused and what you need from them.';
    default:
      return '\n\nHARNESS: FAILED — this is not retryable. Do not repeat it; say what could not be done, and what you would need to proceed.';
  }
}

/** Append a failure's instruction to its result, unless it is already there. */
function annotateResult(result, kind, options) {
  const text = String(result ?? '');
  if (!kind || text.includes('\n\nHARNESS: ')) return text;
  return `${text}${noteFor(kind, options)}`;
}

module.exports = {
  KINDS,
  classifyToolOutcome,
  isRetrySafeTool,
  isFailureText,
  noteFor,
  annotateResult,
  RETRY_SAFE_TOOLS,
  TRANSIENT_CODES,
};
