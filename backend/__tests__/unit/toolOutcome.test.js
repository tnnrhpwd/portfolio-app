/**
 * toolOutcome.test.js — the taxonomy, tested against the REAL strings this
 * codebase produces.
 *
 * The classification is only worth having if it is right on the messages the
 * tools actually emit, so most of these cases are copied verbatim from
 * `netTools.js`, `repoAgentService.js`, `repoRunner.js`, `pcTools.js` and
 * `toolScopes.js`. A taxonomy tuned on invented examples would classify invented
 * failures correctly and no real ones.
 *
 * The load-bearing property is not the label — it is that the five kinds lead to
 * five DIFFERENT next moves, and that the two that must never be retried
 * (a refusal, a missing target) say so.
 */

const {
  KINDS,
  classifyToolOutcome,
  isRetrySafeTool,
  isFailureText,
  annotateResult,
  noteFor,
  RETRY_SAFE_TOOLS,
} = require('../../services/harness/toolOutcome.js');

const kindOf = (result) => classifyToolOutcome({ result }).kind;

describe('toolOutcome — what counts as a failure', () => {
  it('treats a plain result as success', () => {
    expect(classifyToolOutcome({ result: '2 matches in src/a.js' })).toMatchObject({
      failed: false, kind: null, retryable: false, note: null,
    });
  });

  it('recognises the "Error" forms the tools actually emit', () => {
    // `netTools.executeTool` prefixes most failures with "Error: …" but its
    // catch-all produces "Error executing <tool>: …", and the runner returns
    // "Error: <error>" — all three are failures.
    expect(isFailureText('Error: invalid file path.')).toBe(true);
    expect(isFailureText('Error executing repo_search: ETIMEDOUT')).toBe(true);
    expect(isFailureText('Error: no goals were received.')).toBe(true);
    // A successful result that merely MENTIONS the word error is not a failure.
    expect(isFailureText('Found 3 occurrences of "Error:" in the file')).toBe(false);
    expect(isFailureText('')).toBe(false);
  });

  it('treats a thrown error as a failure even with an empty result', () => {
    const verdict = classifyToolOutcome({ result: '', error: new Error('socket hang up') });
    expect(verdict).toMatchObject({ failed: true, kind: KINDS.TRANSIENT });
  });

  it('does NOT treat a cancelled step as a failure', () => {
    // The turn stopped on purpose; the model is being told so, not handed a
    // problem to solve. Classifying it would make the loop report a false failure.
    const verdict = classifyToolOutcome({ result: 'Cancelled: the user stopped the turn before this step ran.' });
    expect(verdict).toMatchObject({ failed: false, kind: null, note: null });
  });
});

describe('toolOutcome — the five kinds, on real messages', () => {
  it('PERMISSION: a refusal is a decision, not a glitch', () => {
    const cases = [
      'Denied: the user did not approve this step.',
      'Error: repository access is restricted to the administrator.',
      'Error: This tool requires the repo:read capability.',
      'Error: image generation requires cloud AI credits. Not enough credits.',
      'Denied by permission policy: shell_run is not allowed.',
      'Error: the dispatcher refused — global kill switch is on.',
    ];
    for (const result of cases) {
      expect([result, kindOf(result)]).toEqual([result, KINDS.PERMISSION]);
    }
  });

  it('NOT FOUND: the target does not exist, so guessing again is pointless', () => {
    const cases = [
      'Error: Unknown tool "repo_blast". This tool is not available.',
      'Error: unknown task "test:stuff" — allowed: test:file, typecheck',
      'Error: "src/x.js" does not exist — create it with repo_write_file instead.',
      'Error: no such file: src/missing.test.js',
      'Error: "frobnicate" is not one of this PC\'s tools — nothing was run.',
      'Error reading "src/a.js": ENOENT: no such file or directory',
      'Error searching: 0 matches', // a miss reads as absence, so it must not be retried
    ];
    for (const result of cases) {
      expect([result, kindOf(result)]).toEqual([result, KINDS.NOT_FOUND]);
    }
  });

  it('INVALID INPUT: the arguments are the fixable part', () => {
    const cases = [
      'Error: invalid filename "../../etc/passwd".',
      'Error: old_string appears 3 times in "src/a.js" — include more surrounding context to make it unique.',
      'Error: the arguments for "save_goals" were empty or cut off (invalid JSON) — this usually means the output hit the length limit.',
      'Error: content must be a string.',
      'Error: query is too long (max 400 characters).',
      'Error: prompt is too long (max 2000 characters).',
      'Error: task is required. Allowed: test:file, test:backend, typecheck, lint, build.',
      'Error: aspect ratio "7:3" is not supported by this model. Supported: 1:1, 16:9.',
      'Error: old_string and new_string are identical — nothing to change.',
      'Error: memory file too large (max 65536 bytes).',
    ];
    for (const result of cases) {
      expect([result, kindOf(result)]).toEqual([result, KINDS.INVALID_INPUT]);
    }
  });

  it('TRANSIENT: worth the same call again', () => {
    const cases = [
      'Error executing web_search: ThrottlingException: Rate exceeded',
      'Error reading "src/a.js": connect ETIMEDOUT 10.0.0.1:443',
      'Error: socket hang up',
      'Error searching: EAI_AGAIN',
      'Error: the model is temporarily unavailable — try again shortly',
      'Error: too many requests',
      'Error executing generate_image: 503 Service Unavailable',
    ];
    for (const result of cases) {
      expect([result, kindOf(result)]).toEqual([result, KINDS.TRANSIENT]);
    }
  });

  it('TRANSIENT via an error object, when the text says nothing', () => {
    // AWS SDK surfacing: the code/`$retryable` is the signal, not the message.
    const throttled = Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
    expect(classifyToolOutcome({ result: 'Error: request failed', error: throttled }).kind).toBe(KINDS.TRANSIENT);

    const retryable = Object.assign(new Error('flaky'), { $retryable: {} });
    expect(classifyToolOutcome({ result: 'Error: request failed', error: retryable }).kind).toBe(KINDS.TRANSIENT);

    const serverError = Object.assign(new Error('Internal Server Error'), { $metadata: { httpStatusCode: 500 } });
    expect(classifyToolOutcome({ result: 'Error: request failed', error: serverError }).kind).toBe(KINDS.TRANSIENT);
  });

  it('FATAL: broken or disabled, so nothing the model writes will help', () => {
    const cases = [
      'Error: repository not available on this server.',
      'Error: the repository runner is disabled on this server (REPO_RUNNER_DISABLED).',
      'Error: repository access is not configured.',
      'Error: Bedrock model access not enabled for this account/region.',
      "Error executing log_action: Cannot read properties of undefined (reading 'userId')",
    ];
    for (const result of cases) {
      expect([result, kindOf(result)]).toEqual([result, KINDS.FATAL]);
    }
  });

  it('ignores a string that is not a tool result at all', () => {
    // Route-level error text (written straight to the SSE stream) never passes
    // through here — a classifier that guessed at prose would start labelling
    // SUCCESSFUL results as failures.
    expect(classifyToolOutcome({ result: 'Anthropic requires a one-time use case form.' }))
      .toMatchObject({ failed: false, kind: null });
  });
});

describe('toolOutcome — the ordering of the signals', () => {
  it('reads an environment problem as FATAL even though it says "invalid"/"requires"', () => {
    // Both patterns are present; "the server is misconfigured" must win, because
    // the model would otherwise rewrite its arguments forever.
    expect(kindOf('Error: repository not available — the runner requires a configured repo.')).toBe(KINDS.FATAL);
  });

  it('reads a policy refusal as PERMISSION even when it also mentions a limit', () => {
    expect(kindOf('Error: not enough storage space for the generated image(s).')).toBe(KINDS.PERMISSION);
  });

  it('prefers NOT FOUND over INVALID INPUT for a missing snippet', () => {
    // The tool's message contains "was not found in", which also matches the
    // invalid-input vocabulary. "That name doesn't exist" is the better read: the
    // fix is to establish the real name, not to re-send the same one.
    expect(kindOf('Error: old_string was not found in "src/a.js".')).toBe(KINDS.NOT_FOUND);
  });
});

describe('toolOutcome — the instruction attached to each kind', () => {
  it('gives every kind a DIFFERENT next move', () => {
    const notes = Object.values(KINDS).map((kind) => noteFor(kind));
    expect(new Set(notes).size).toBe(5);
    // A note is APPENDED to a result, so it opens with a blank line; the point of
    // the format is that it is greppable and set apart from the tool's own words.
    for (const note of notes) expect(note).toMatch(/\n\nHARNESS: /);
  });

  it('tells the model not to repeat a refusal or a missing target', () => {
    expect(noteFor(KINDS.PERMISSION)).toMatch(/do not retry it and do not rephrase/i);
    expect(noteFor(KINDS.NOT_FOUND)).toMatch(/Do NOT repeat the same name/i);
    expect(noteFor(KINDS.INVALID_INPUT)).toMatch(/ARGUMENTS/i);
    // A transient failure is the ONE kind the model is told to repeat.
    expect(noteFor(KINDS.TRANSIENT)).toMatch(/retrying this step once, unchanged, is the right next move/i);
  });

  it('is honest once the harness has already retried it', () => {
    // Telling the model "retry, it will work" after the harness already retried
    // and failed would invite a third attempt at something that is clearly down.
    const note = noteFor(KINDS.TRANSIENT, { alreadyRetried: true });
    expect(note).toMatch(/already retried this step once/i);
    expect(note).toMatch(/Do not retry a third time/i);
  });

  it('is appended once, never twice', () => {
    const once = annotateResult('Error: invalid filename ""', KINDS.INVALID_INPUT);
    expect(once).toContain('HARNESS: INVALID INPUT');
    expect(annotateResult(once, KINDS.INVALID_INPUT)).toBe(once);
    // A success is never annotated.
    expect(annotateResult('2 matches', null)).toBe('2 matches');
  });
});

describe('toolOutcome — which tools may be repeated by the harness', () => {
  it('allows a transient retry of reads only', () => {
    // Reads of the repo come from their capability, not a list…
    for (const tool of ['repo_search', 'repo_read_file', 'repo_list_files', 'repo_git_status', 'repo_git_diff']) {
      expect([tool, isRetrySafeTool(tool)]).toEqual([tool, true]);
    }
    expect(isRetrySafeTool('pc_status')).toBe(true);
    expect(isRetrySafeTool('get_my_goals')).toBe(true);
  });

  it('refuses to repeat anything that writes, spends, or drives the PC', () => {
    const dangerous = [
      'repo_write_file', 'repo_edit_file', 'repo_commit_changes', 'repo_push',
      'repo_run',            // executes code
      'pc_do',               // drives the user's real machine
      'generate_image',      // spends credits
      'save_goal', 'save_goals', 'save_note', 'log_action', 'submit_support_ticket',
      'update_memory', 'delete_memory', 'update_personality', 'update_behavior',
      'summarize_conversation', // spends a model call
      'unknown_tool',
    ];
    for (const tool of dangerous) {
      expect([tool, isRetrySafeTool(tool)]).toEqual([tool, false]);
    }
  });

  it('keeps its promise about the allowlist: every entry is a read', () => {
    // A guard on the list itself — if someone adds a tool here that writes, this
    // is where it should fail rather than in production.
    const writers = /save|write|edit|commit|push|delete|update|generate|ticket|log_/;
    for (const tool of RETRY_SAFE_TOOLS) {
      expect([tool, writers.test(tool)]).toEqual([tool, false]);
    }
  });
});
