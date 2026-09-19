/**
 * agentStopMessage.js — what the chat says when an agent run ends without an answer.
 *
 * **The bug this replaces.** An agent run that produced no final answer rendered as:
 *
 *     🤖 **Agent stopped** — goal status=done (goal status=done).
 *     🤖 **Agent stopped** — stalled (stalled).
 *
 * The user's response to that was, correctly, *"it just gave up with a simple
 * error… i gave no description of what it tried"*. Three separate information
 * losses produced it:
 *
 *   1. The addon set `status` and `reason` to the SAME raw stop token, so the
 *      message printed it twice. (Fixed in `stop-reason.js` — the reason is now a
 *      sentence and the status a token.)
 *   2. The addon discarded the useful half of the stall reason — the tick count —
 *      before returning it. (Fixed in `agent-loop.js`.)
 *   3. This side threw away everything else it was holding: the step count was
 *      only rendered on the SUCCESS path, and `stepLog` — which names every tool
 *      the agent tried, with its arguments and whether it worked — was never
 *      shown at all. That log is the direct answer to "what did it try?", and it
 *      was in the response the whole time.
 *
 * So the message is built from evidence the caller already has, and it degrades
 * honestly: with no stepLog it says less rather than inventing detail.
 */

/** How many attempted steps to list. Enough to see the shape of the attempt. */
const MAX_STEPS_SHOWN = 6;

/** Longest single tool result shown inline. */
const MAX_RESULT_CHARS = 140;

/** `snake_case` tool names read as jargon; de-underscore them for display. */
function prettyTool(name) {
  return String(name || 'a tool').replace(/_/g, ' ');
}

/** One line for a step: what it tried, and whether it worked. */
function describeStep(step) {
  const tool = `\`${prettyTool(step?.tool)}\``;
  if (step?.ok) return `${tool} — worked`;
  const why = String(step?.result || '').replace(/\s+/g, ' ').trim();
  if (!why) return `${tool} — failed`;
  const clipped = why.length > MAX_RESULT_CHARS ? `${why.slice(0, MAX_RESULT_CHARS - 1)}…` : why;
  return `${tool} — ${clipped}`;
}

/**
 * Build the message for a run that ended without an answer.
 *
 * @param {object} result  the addon's agent-run response
 * @returns {string} markdown for the assistant bubble
 */
export function agentStopMessage(result = {}) {
  const outcome = result.status || 'stopped';
  const reason = String(result.reason || '').trim();
  const steps = typeof result.steps === 'number' ? result.steps : null;
  const log = Array.isArray(result.stepLog) ? result.stepLog : [];

  // A stop with nothing attempted reads differently from a stop mid-work, and the
  // distinction is the useful part: one means the request never ran at all.
  const heading = steps === 0
    ? '🤖 **Nothing was attempted**'
    : outcome === 'done'
      ? '🤖 **The agent finished without a summary**'
      : '🤖 **The agent stopped before finishing**';

  const lines = [heading, ''];

  // `reason` is a sentence from the addon (`stop-reason.js`). When it is missing —
  // an older addon build — say what is known rather than printing a bare token.
  lines.push(`**Why:** ${reason || `it stopped (${outcome}).`}`);

  if (steps != null) {
    lines.push('');
    lines.push(`**How far it got:** ${steps} step${steps === 1 ? '' : 's'}.`);
  }

  if (log.length) {
    const shown = log.slice(-MAX_STEPS_SHOWN);
    const earlier = log.length - shown.length;
    lines.push('');
    lines.push(earlier > 0
      ? `**What it tried** (last ${shown.length} of ${log.length}):`
      : '**What it tried:**');
    for (const step of shown) lines.push(`- ${describeStep(step)}`);
    if (earlier > 0) lines.push(`- …and ${earlier} earlier step${earlier === 1 ? '' : 's'}.`);
  }

  return lines.join('\n');
}
