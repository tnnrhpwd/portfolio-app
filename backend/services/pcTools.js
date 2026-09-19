/**
 * pcTools.js — the cloud harness's hand on the user's own PC.
 *
 * NET_HARNESS_PLAN.md P2 step 3, and §0 property #4: *both hands work in one
 * loop.* The relay transport landed in step 2; this is the surface the model
 * actually sees.
 *
 * ⚠️ TWO tools, not forty. Exposing the addon's registry schema-by-schema would
 * add ~3–4K tokens to a fixed prefix that is ALREADY the dominant cost of a turn
 * (each call re-sends every schema, and a maxed turn is up to 18 calls). So the
 * model gets one discovery tool and one dispatcher, and the concrete tool name
 * travels as an argument.
 *
 * ⚠️ Neither tool can widen authority. `pc_do` dispatches over the same relay
 * command the addon's own agent already used, and the addon runs it through
 * `registry.executeTool` — so `permissions.js` decides, on the machine that owns
 * the resource, with the user's real policy (category modes, per-tool overrides,
 * dry-run, the shell allow/deny list, and the kill switch). The cloud never sees
 * a credential and never bypasses a gate; it can only ASK.
 *
 * ⚠️ And it tells the truth about that. `pc_status` reports the policy the addon
 * published, so the model can say "this will ask you on your PC" BEFORE doing it,
 * rather than promising something the machine is about to refuse.
 */

/** Longest tool result handed back to the model. */
const MAX_RESULT_CHARS = 8000;

/** How long one dispatched tool may take. Generous: a skill or a wait_for is slow. */
const PC_TOOL_TIMEOUT_MS = 120000;

/**
 * The relay is a controller, not a service, and this module is loaded DURING
 * netTools' own init — so the require is deferred to first use, the same trick
 * the repo tools use to stay clear of a startup cycle.
 */
let _relay = null;
function relay() {
  if (!_relay) _relay = require('../controllers/addonRelayController.js');
  return _relay;
}

/** How a category will behave, in words the model can repeat to the user. */
const MODE_PHRASE = {
  allow: 'runs without asking',
  ask: 'asks you on your PC first',
  deny: 'blocked by your permission policy',
  'dry-run': 'dry-run only — it reports what it WOULD do and does nothing',
};

/** Clip a tool result for the model's context, keeping both ends. */
function clipResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '(no output)';
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS * 0.6)}\n… [${text.length - MAX_RESULT_CHARS} chars omitted] …\n${text.slice(-Math.floor(MAX_RESULT_CHARS * 0.3))}`;
}

/** Render the published catalog: tool names grouped by category, with the mode. */
function describeCatalog(info) {
  const modes = info.policy?.categories || {};
  const byCategory = new Map();
  for (const tool of info.tools) {
    const key = tool.category || 'unknown';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(tool.name);
  }

  const header = `PC "${info.hostname}" is connected${info.platform ? ` (${info.platform})` : ''}. It offers ${info.tools.length} tool(s):`;
  const lines = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, names]) => {
      const mode = modes[category];
      const phrase = mode ? MODE_PHRASE[mode] || mode : 'your PC decides whether to ask';
      return `- ${category} (${phrase}): ${names.join(', ')}`;
    });

  const warnings = [];
  if (info.policy?.globalKillSwitch) {
    warnings.push('⚠️ The emergency kill switch is ON: nothing will run until the user turns it off.');
  }
  if (info.policy?.dryRunMode) {
    warnings.push('⚠️ Dry-run mode is on: tools report what they would do and do nothing.');
  }
  if (info.policy?.autoApproveAll) {
    warnings.push('Note: auto-approve is ON, so tools that would normally ask will run without a prompt.');
  }

  return [
    header,
    ...lines,
    ...warnings,
    '',
    'Run one with pc_do, e.g. {"tool":"screen_capture","args":{}}.',
  ].join('\n');
}

const PC_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'pc_status',
      description: 'List what the user\'s own PC can do right now — the tools the desktop addon offers, grouped by category, and how the user\'s permission policy will treat each one (runs without asking / asks on the PC / blocked). Call this BEFORE any pc_do if you do not already know the tool names from earlier in this conversation. It is answered from the addon\'s last heartbeat, so it is instant and costs nothing on the PC.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pc_do',
      description: 'Run ONE tool on the user\'s own PC (the desktop addon). Get the tool names from pc_status first. The action is subject to that PC\'s permission policy: a category set to "ask" shows the user a prompt on their machine, and they may refuse — so tell the user what you are about to do on their PC before you do it, and never claim it happened until this returns. The result is whatever the tool returned.',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'The tool name from pc_status, e.g. "window_list", "open_app", "shell_run", "skill_run".' },
          args: { type: 'object', description: 'Arguments for that tool, exactly as pc_status\'s category listing and the tool\'s own schema define them (e.g. {"name":"notepad"} for open_app).' },
        },
        required: ['tool'],
      },
    },
  },
];

/**
 * The refusal vocabulary lives in `harness/refusalCause.js`, because three
 * readers need it and none of them owns it: this module renders it for the model,
 * `toolOutcome.js` parses the cause out of a result string, and `stepJournal.js`
 * puts `reaskable` on the step so the UI can offer a retry without re-deriving
 * policy. Re-exported here because this is where the vocabulary is *produced* on
 * the cloud side, and that is where anyone debugging a refusal will look.
 *
 * ⚠️ `reaskable` — whether a fresh attempt could be answered differently — is the
 * distinction the old prose classifier destroyed. A HUMAN said no or was away →
 * yes. A stored SETTING says no → no. Deliberately NOT named `retryable`:
 * `toolOutcome.js` owns that word, it means "the harness may repeat this by
 * itself", and the two disagree on the same refusal.
 */
const { CAUSES, REFUSAL_CAUSES, CAUSE_RE, isReaskableCause } = require('./harness/refusalCause.js');

/**
 * The token format, in the shape a reader wants: one capture for the cause and
 * one for the reason. Kept as a thin alias so the parse below reads as one step.
 */
const REFUSAL_WIRE_RE = CAUSE_RE;

/**
 * Interpret one failed `pc_do` dispatch.
 *
 * Returns `{ prefix, message, cause, reaskable }` — a refusal is `Denied:` (a
 * decision, which the step list shows as its own state and which the failure
 * taxonomy reads as PERMISSION), a fault is `Error:`.
 *
 * The legacy branch exists only for addon builds already in the field, which
 * send no token. It is the regex this replaces, kept so an older desktop is still
 * classified the way it was rather than newly broken — but it is also why the
 * token matters: `/denied|not approved|permission policy/i` misses the kill
 * switch and an expired prompt, and that miss was the bug.
 */
function interpretPcFailure(tool, error) {
  const text = String(error || 'the PC did not say why').trim();

  const wire = REFUSAL_WIRE_RE.exec(text);
  if (wire) {
    const [, cause, reason] = wire;
    const known = REFUSAL_CAUSES[cause];
    if (known) {
      return {
        prefix: 'Denied:',
        cause,
        reaskable: known.reaskable,
        // `Denied (<cause>):` — the parenthetical keeps the machine-readable
        // cause attached to a message that still reads as a sentence. It is what
        // `toolOutcome.CAUSE_LABEL_RE` extracts, so the step record and the client
        // can offer a Retry only where one is honest, without either of them
        // string-matching the prose below it.
        message: `Denied (${cause}): pc_do ${tool} was not run — ${known.why}. The PC reported: ${reason} ${known.next}`,
      };
    }
    // An unrecognised cause is a version skew (a newer addon, an older backend).
    // Say what is known — it IS a refusal — and do not invent semantics.
    return {
      prefix: 'Denied:',
      cause,
      reaskable: false,
      message: `Denied (${cause}): pc_do ${tool} was refused on the PC: ${reason} Do not retry the same call — ask the user how they would like to proceed.`,
    };
  }

  // ── Legacy: an addon that predates the cause token ──────────────────────────
  const looksDenied = /denied|not approved|permission policy/i.test(text);
  if (looksDenied) {
    return {
      prefix: 'Denied:',
      cause: null,
      // Unknown cause ⇒ NOT re-askable. The client must never offer a retry it
      // cannot justify; a missed button is a small loss, a wrong one is a lie.
      reaskable: false,
      message: `Denied: pc_do ${tool} was refused on the PC: ${text}. Do not retry the same call — ask the user whether they want it, or how they would like to proceed.`,
    };
  }
  if (/did not answer/.test(text)) {
    return {
      prefix: 'Error:',
      cause: null,
      reaskable: false,
      message: `Error: pc_do ${tool} was sent to the PC but it did not answer in time. The action may still be waiting for the user to approve it on their machine, or may have run — do NOT repeat it without checking with the user.`,
    };
  }
  return { prefix: 'Error:', cause: null, reaskable: false, message: `Error: ${text}` };
}

const PC_TOOL_EXECUTORS = {
  async pc_status(_args, ctx) {
    const info = await relay().readDeviceTools(ctx?.userId);
    if (!info.deviceId) {
      return 'No PC is connected to this account. The user needs to start the desktop addon and sign in there; you cannot control a PC that has not connected.';
    }
    if (!info.online) {
      return `The user's PC "${info.hostname}" is not responding — the addon is not running (or is asleep). Ask them to start it, then try again.`;
    }
    if (!info.tools.length) {
      return `PC "${info.hostname}" is connected but has not published its tool list yet (an older addon build). Its tools still work with pc_do if you know their names, but you cannot discover them here.`;
    }
    return describeCatalog(info);
  },

  async pc_do(args, ctx) {
    const tool = String(args?.tool || '').trim();
    if (!tool) return 'Error: tool is required — call pc_status to see what this PC offers.';

    const rawArgs = args?.args;
    const toolArgs = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) ? rawArgs : {};

    const info = await relay().readDeviceTools(ctx?.userId);
    if (!info.deviceId) {
      return 'No PC is connected to this account — nothing was run. Start the desktop addon first.';
    }
    if (!info.online) {
      // Prefixed, like every other failure this module returns: an unprefixed
      // sentence is classified as SUCCESS by the harness and shown as a ticked
      // step. See the note on the refusal branch below.
      return `Error: the user's PC "${info.hostname}" is not responding — nothing was run.`;
    }

    // A typo would otherwise cost a full dispatch and a two-minute wait, and the
    // user would see a prompt for a tool that does not exist. Checked against the
    // catalog the addon itself published; the addon still validates the name.
    if (info.tools.length && !info.tools.some((t) => t.name === tool)) {
      const names = info.tools.map((t) => t.name).join(', ');
      return `Error: "${tool}" is not one of this PC's tools — nothing was run. Available: ${names}`;
    }

    const outcome = await relay().dispatchToolToAddon({
      userId: ctx?.userId,
      tool,
      args: toolArgs,
      timeoutMs: PC_TOOL_TIMEOUT_MS,
    });

    if (!outcome.ok) {
      // A refusal and a timeout read very differently to the model: one means
      // "the user said no", the other "we do not know". Say which.
      //
      // The cause comes from the PC (`interpretPcFailure` above), and the PREFIX
      // is load-bearing: the harness classifies a result by its prefix
      // (toolOutcome.js), the step journal decides a step's status the same way,
      // and the client's `tools` event marks success by `!startsWith('Error')`.
      // An unprefixed sentence is read as "this worked", so a refusal was once
      // rendered with a tick beside it.
      const { message } = interpretPcFailure(tool, outcome.error);
      return message;
    }

    return `pc_do ${tool} → ${clipResult(outcome.result)}`;
  },
};

module.exports = {
  PC_TOOL_SCHEMAS,
  PC_TOOL_EXECUTORS,
  // exported for tests
  describeCatalog,
  clipResult,
  PC_TOOL_TIMEOUT_MS,
  interpretPcFailure,
  // Re-exported from harness/refusalCause.js — kept on this module because this
  // is where a cloud-side refusal is produced, so it is where anyone debugging
  // one looks first.
  REFUSAL_CAUSES,
  CAUSES,
  isReaskableCause,
};
