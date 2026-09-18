/**
 * toolLoop.js — THE tool-call loop for the /net harness.
 *
 * Before this, the same idea existed twice: `runToolLoop()` in `llmService.js`
 * (used by the non-streaming `callLLMApi`) and an inlined copy inside
 * `streamCompressionRequest()` (the streaming route). They had already drifted
 * once — the act-vs-answer nudge had to be wired into both — and every later
 * harness phase (the step journal, cancellation, the approval gate, the failure
 * taxonomy) would have needed the same double edit. One implementation, one
 * place to hook.
 *
 * Why the loop takes `call` and `executeToolCall` as arguments instead of
 * requiring them: it makes the loop testable with fakes and keeps it free of
 * provider, DynamoDB and capability knowledge. `llmService` owns routing
 * (`makeLLMCall`) and execution (`executeToolCall`); this file owns the
 * *sequence*.
 *
 * Contract:
 *
 *   loop:  call → (model asks for tools?) → execute → feed results back → call
 *          … until the model stops asking, or `maxRounds` is spent.
 *
 *   `messages` is mutated in place, which is what the providers require.
 *
 * Returns:
 *   response     the final provider response (may still contain tool_calls when
 *                the round budget ran out — see `exhausted`)
 *   toolResults  [{ tool, args, result }] in execution order
 *   rounds       how many rounds actually ran
 *   nudged       whether the act-vs-answer retry was spent
 *   exhausted    true when the loop stopped because `maxRounds` was reached
 *                while the model STILL wanted tools. The caller uses this to
 *                decide between "the answer is already in hand" and "ask for a
 *                prose wrap-up": a loop that ended with text needs no wrap-up.
 */

const { actNudgeFor, appendSystemNote } = require('../turnIntent.js');

/**
 * Max tool-call rounds per turn (prevents runaway loops).
 *
 * Was 3 — far too tight for the repo workflow. 8 and then 12 still came up short:
 * the live run that leaked a tool marker had already edited the file and only
 * wanted to re-read it to verify, i.e. it was cut off in the *checking* phase.
 * 16 leaves room for investigate → edit → retry a bad snippet → verify → answer.
 * A round is only spent when the model actually asks for a tool, so a normal chat
 * turn costs nothing extra.
 */
const MAX_TOOL_ROUNDS = 16;

/**
 * Appended to the system prompt when a turn has spent every tool round, so the
 * next call comes back as prose instead of another tool request.
 */
const TOOL_LIMIT_NOTICE = '\n\nTOOL LIMIT REACHED: you have used every tool round available for this turn. Reply to the user NOW in plain text — say what you changed, what could not be completed and why, and what to do next. Do not call any more tools, and do not output tool-call syntax, JSON, bracketed tool notes, or file contents.';

/**
 * Output-token ceiling for a turn that has tools in play.
 *
 * The per-tier cap (1-4K) is sized for chat prose, but a tool call's ARGUMENTS
 * come out of the same output budget — and `repo_write_file` takes an entire
 * file as one argument. At 4096 the arguments for a 17 KB file (≈5K tokens) were
 * cut off mid-JSON on every attempt, so the write never happened, the model
 * retried the same doomed call, and the turn burned every round (observed live
 * 2026-09-14). Haiku 4.5 allows up to 64K output; 16K covers roughly a 60 KB
 * file. Anything larger should go through `repo_edit_file`, which needs only a
 * snippet instead of the whole file.
 */
const TOOL_TURN_MAX_TOKENS = 16384;

/** No-op sink so the loop never needs a logger to run (tests pass fakes). */
const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

/**
 * Parse a tool call's JSON arguments.
 *
 * Bedrock/Claude emits tool-call arguments as a JSON string. When the model's
 * output is cut off at the max-token ceiling mid-call (stop reason "length"),
 * that string can be empty or invalid JSON. Detect that case and flag it so the
 * caller can feed a corrective message back to the model instead of silently
 * treating the call as `{}` — the old behaviour made tools like save_goals no-op
 * while the model still claimed it had saved everything.
 *
 * Lives here (not in llmService) because the journal needs the same answer to
 * describe a step's arguments, and two parsers would eventually disagree about
 * what a truncated call looks like.
 */
function parseToolArguments(toolCall) {
  const raw = toolCall?.function?.arguments;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { args: null, truncated: true };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed, truncated: false };
    }
    return { args: null, truncated: true };
  } catch {
    return { args: null, truncated: true };
  }
}

/**
 * Run the tool-call loop.
 *
 * @param {object} args
 * @param {(messages: object[], options: object) => Promise<object>} args.call
 * @param {(toolCall: object, toolContext: object) => Promise<{fnName: string, fnArgs: object|null, result: string}>} args.executeToolCall
 * @param {object[]} args.messages                mutated in place
 * @param {object} args.llmOptions                must carry `tools` to arm the loop
 * @param {object|null} args.toolContext
 * @param {number} [args.maxRounds]
 * @param {(info: {toolCall: object, name: string, round: number, maxRounds: number}) => void} [args.onToolStart]  before execution
 * @param {(info: {toolCall: object, name: string, round: number, result: string, error: Error|null}) => void} [args.onToolEnd]  after execution
 * @param {() => boolean} [args.isCancelled]     checked BETWEEN rounds and before each tool
 * @param {(info: object) => Promise<{allow: boolean, reason?: string}|void>} [args.beforeTool]
 *        the approval gate; `{allow:false}` means the tool does NOT run and the
 *        model is told why
 * @param {{debug: Function, warn: Function}} [args.logger]
 */
async function runToolLoop({
  call,
  executeToolCall,
  messages,
  llmOptions,
  toolContext,
  maxRounds = MAX_TOOL_ROUNDS,
  onToolStart = null,
  onToolEnd = null,
  isCancelled = null,
  beforeTool = null,
  logger = NOOP_LOGGER,
}) {
  if (typeof call !== 'function' || typeof executeToolCall !== 'function') {
    throw new Error('runToolLoop requires `call` and `executeToolCall` functions.');
  }

  const cancelled = () => !!(isCancelled && isCancelled());

  let response = await call(messages, llmOptions);
  const toolResults = [];
  let rounds = 0;
  let nudgeUsed = false;

  while (llmOptions?.tools && rounds < maxRounds) {
    // Cancellation is cooperative and only ever at a SAFE BOUNDARY: a tool is
    // never interrupted mid-flight (a half-applied edit is worse than a
    // completed one), so the turn stops before the next step instead.
    if (cancelled()) break;

    const choice = response?.choices?.[0];
    const calls = choice?.message?.tool_calls;
    if (!calls || calls.length === 0) {
      // Harness recovery for the reported failure: the user asked for an
      // OUTCOME and the model replied with prose alone ("I'll add that goal for
      // you" — and nothing happened). One retry, with the tools still offered
      // and a note saying so. `rounds === 0` bounds it to a turn that never
      // acted at all; `nudgeUsed` bounds it to one retry, so a model that sticks
      // to prose is believed.
      if (!nudgeUsed && rounds === 0) {
        const nudge = actNudgeFor(toolContext);
        if (nudge && appendSystemNote(messages, nudge)) {
          nudgeUsed = true;
          logger.debug('🔁 /net turn asked for an outcome but the model only replied — retrying once with an act nudge.');
          response = await call(messages, llmOptions);
          continue;
        }
      }
      break; // No tool calls — the model is done.
    }

    rounds++;
    logger.debug(`🔧 Tool call round ${rounds}: ${calls.length} tool(s) requested`);
    messages.push(choice.message);

    for (const toolCall of calls) {
      const requestedName = toolCall.function?.name || 'unknown';
      if (onToolStart) onToolStart({ toolCall, name: requestedName, round: rounds, maxRounds });

      let outcome;
      let error = null;

      if (cancelled()) {
        // Every tool the turn skips still gets a result. Leaving a tool_call
        // without its tool_result would make the history an illegal request for
        // the next provider call, and the model would have no idea why the turn
        // stopped.
        outcome = {
          fnName: requestedName,
          fnArgs: null,
          result: 'Cancelled: the user stopped the turn before this step ran.',
        };
      } else {
        const verdict = beforeTool
          ? await beforeTool({ toolCall, name: requestedName, round: rounds, maxRounds })
          : null;
        if (verdict && verdict.allow === false) {
          outcome = {
            fnName: requestedName,
            fnArgs: null,
            result: `Denied: ${verdict.reason || 'the user did not approve this step.'}`,
          };
        } else {
          try {
            outcome = await executeToolCall(toolCall, toolContext);
          } catch (err) {
            // A throwing executor used to reject the whole turn — the user saw a
            // bare error and lost every step that had already succeeded. A tool
            // failure is INFORMATION the model can act on, so it becomes the
            // tool's result instead. (P6 of NET_HARNESS_PLAN.md classifies these
            // into retry / re-plan / ask; for now they all read as errors.)
            error = err;
            logger.warn?.(`🔧 Tool "${requestedName}" threw — feeding the error back to the model: ${err.message}`);
            outcome = { fnName: requestedName, fnArgs: null, result: `Error: ${err.message}` };
          }
        }
      }

      // Prefer the executor's own name: it is resolved from the same call the
      // provider made, so a missing `function.name` cannot mislabel a result.
      const name = outcome.fnName || requestedName;
      toolResults.push({ tool: name, args: outcome.fnArgs, result: outcome.result });
      // `name` is what the flattened activity log labels the result with.
      messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: outcome.result });

      if (onToolEnd) {
        onToolEnd({ toolCall, name, round: rounds, result: outcome.result, error });
      }
    }

    if (cancelled()) break;
    response = await call(messages, llmOptions);
  }

  const wasCancelled = cancelled();
  // "The budget ran out, and the model was still asking for tools" — as opposed
  // to "the model stopped asking", which leaves its answer already in `response`.
  const stillAsking = response?.choices?.[0]?.message?.tool_calls;
  const exhausted = !wasCancelled && !!(llmOptions?.tools && rounds >= maxRounds && stillAsking?.length);

  return { response, toolResults, rounds, nudged: nudgeUsed, exhausted, cancelled: wasCancelled };
}

module.exports = {
  runToolLoop,
  parseToolArguments,
  MAX_TOOL_ROUNDS,
  TOOL_LIMIT_NOTICE,
  TOOL_TURN_MAX_TOKENS,
};
