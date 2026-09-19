/**
 * repoRunner.js — the allowlisted command runner behind /net's `repo_run` tool.
 *
 * NET_HARNESS_PLAN.md P3, and §0 property #5: *verification closes.* Until now
 * the repo agent could search, read, edit, commit and push — and could not run
 * anything. So "verified" meant "re-read the diff", which is an assertion, not a
 * check. This is what makes edit → **run the narrowest relevant check** → report
 * possible.
 *
 * ⚠️ This is the most dangerous capability in the harness, and the design is
 * built around that:
 *
 *   1. **There is no command parameter.** The caller picks a TASK from a frozen
 *      map; the argv is written here. A task name that is not in the map cannot
 *      run, so "the model asked for something clever" has nowhere to land.
 *   2. **No shell, ever.** `execFile` with an argv array — no interpolation, no
 *      globbing, no pipes, no quoting to get wrong.
 *   3. **The child gets a SCRUBBED environment.** The backend process holds
 *      `JWT_SECRET`, AWS keys and a GitHub token. A test that prints `process.env`
 *      — or a dependency that logs on failure — would put those in the model's
 *      context and in the step journal. Only a small allowlist is passed down.
 *   4. **Every run is bounded** in time and in output, and the output is shaped
 *      to head + tail: a 40k-line Jest dump is worthless to a model and would
 *      cost more than the turn itself.
 *   5. **A kill switch exists** (`REPO_RUNNER_DISABLED=1`) for the day something
 *      needs to stop running commands *now*, without a deploy.
 *
 * The long-lived entry points (`node_modules/jest/bin/jest.js`, not `npm`) are
 * deliberate: they are the paths this repo's own testing instructions use, and
 * going through `npm` would need a shell on Windows.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/** Hard ceiling on output we hand back to the model, before shaping. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Result budget: head + tail, because the verdict is at one end or the other. */
const RESULT_HEAD_LINES = 60;
const RESULT_TAIL_LINES = 40;
const RESULT_MAX_CHARS = 8000;

/**
 * Environment variables a child may inherit.
 *
 * Everything else — AWS_*, JWT_SECRET, GITHUB_TOKEN, MESSAGE_ENCRYPTION_KEY,
 * SES/S3 creds, the Stripe keys — is dropped. This is the difference between
 * "we ran the tests" and "the tests printed the production secret into a
 * transcript a browser renders".
 *
 * `PATH` is needed to resolve binaries the task itself spawns (jest spawns
 * workers; tsc and vite read tsconfig through node). Windows spells it `Path`,
 * so both are listed rather than guessing the platform.
 */
const SAFE_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'windir',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
  'NODE_ENV', 'NODE_OPTIONS', 'CI', 'LANG', 'LC_ALL', 'TZ',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
];

/** Build the child's environment from the allowlist above. */
function safeEnv(source = process.env) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  // A test run must never sit in watch mode waiting for input that will not come.
  env.CI = '1';
  env.NODE_ENV = env.NODE_ENV || 'test';
  return env;
}

/**
 * The allowlist. `argv[0]` is a JavaScript entry point run by the SAME node
 * binary as this process (`process.execPath`), so nothing depends on a global
 * install or on the shell's PATH.
 *
 * `cwd` is resolved relative to the repository root and must stay inside it.
 */
const TASKS = Object.freeze({
  // Narrow first — this is what the prompt tells the model to reach for.
  'test:file': {
    label: 'one test file',
    description: 'Run ONE test file. Takes `target`, e.g. "backend/__tests__/unit/toolLoop.test.js" or "frontend/src/components/SimpleAddon/StepList.test.jsx".',
    timeoutMs: 180000,
    targetKind: 'test-file',
  },
  'test:backend': {
    label: 'whole backend suite',
    description: 'Run the whole backend Jest suite. Slow — prefer test:file unless you changed something shared.',
    cwd: 'backend',
    argv: ['node_modules/jest/bin/jest.js', '--ci'],
    timeoutMs: 600000,
  },
  typecheck: {
    label: 'frontend typecheck',
    description: 'Type-check the frontend with tsc --noEmit.',
    cwd: 'frontend',
    argv: ['node_modules/typescript/bin/tsc', '--noEmit'],
    timeoutMs: 300000,
  },
  lint: {
    label: 'eslint',
    description: 'Lint the repository with ESLint.',
    cwd: '.',
    argv: ['node_modules/eslint/bin/eslint.js', '.', '--ext', '.js,.jsx,.ts,.tsx'],
    timeoutMs: 300000,
  },
  build: {
    label: 'frontend build',
    description: 'Build the frontend with Vite. Catches CSS and import errors that no test sees.',
    cwd: 'frontend',
    argv: ['node_modules/vite/bin/vite.js', 'build'],
    timeoutMs: 600000,
  },
});

/** Task names, for the tool schema enum and for error messages. */
const TASK_NAMES = Object.freeze(Object.keys(TASKS));

/**
 * A one-line `name (what it does)` list for the tool description.
 *
 * DERIVED from the map above on purpose: the description is the only prompt the
 * model gets about which task to pick, and a hand-written copy would eventually
 * name a task that no longer exists — or miss one that does.
 */
function taskSummary() {
  return TASK_NAMES.map((name) => `${name} (${TASKS[name].label})`).join(', ');
}

/**
 * Which runner owns a path. This is the repo's own mapping (see
 * `.github/instructions/testing.instructions.md`): three independent runners,
 * and using the wrong one produces ~30 phantom failures.
 */
const TEST_ROOTS = Object.freeze([
  { prefix: 'frontend/', root: '.', kind: 'root-jest' },
  { prefix: 'backend/', root: 'backend', kind: 'backend-jest' },
  { prefix: 'simple-addon/', root: '.', kind: 'plain-node' },
]);

/** Where a test file is allowed to live. Nothing else may be executed. */
const ALLOWED_TEST_RE = /\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/;

/**
 * Resolve a `test:file` target into `{ cwd, argv }`.
 *
 * Pure and exported: the validation is the security boundary for this task, so
 * it is tested directly rather than only through a spawned process.
 *
 * @returns {{ok: true, cwd: string, argv: string[], resolved: string} | {ok: false, error: string}}
 */
function resolveTestTarget(target, { repoRoot }) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) return { ok: false, error: 'test:file needs a `target` — the test file to run.' };
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    return { ok: false, error: 'target must be a repo-relative path.' };
  }
  if (raw.split('/').includes('..')) return { ok: false, error: 'target may not contain "..".' };
  if (!ALLOWED_TEST_RE.test(raw)) {
    return { ok: false, error: 'target must be a test file (*.test.js / *.test.jsx / *.spec.js / *.spec.ts / *.spec.tsx).' };
  }

  const tree = TEST_ROOTS.find((t) => raw.startsWith(t.prefix));
  if (!tree) {
    return { ok: false, error: `target must be under one of: ${TEST_ROOTS.map((t) => t.prefix).join(', ')}.` };
  }

  const abs = path.resolve(repoRoot, raw);
  // Belt and braces: the prefix check above already rules this out, but a
  // symlinked directory inside the repo would not be caught by string checks.
  if (!abs.startsWith(path.resolve(repoRoot) + path.sep)) {
    return { ok: false, error: 'target resolves outside the repository.' };
  }
  if (!fs.existsSync(abs)) return { ok: false, error: `no such file: ${raw}` };

  if (tree.kind === 'root-jest') {
    // The ROOT jest config is the canonical frontend runner — running from
    // inside frontend/ makes Jest default to the node environment and every DOM
    // suite dies with "document is not defined".
    return { ok: true, cwd: '.', argv: ['node_modules/jest/bin/jest.js', '--config', 'package.json', '--ci', raw], resolved: raw };
  }
  if (tree.kind === 'backend-jest') {
    const rel = raw.slice('backend/'.length);
    return { ok: true, cwd: 'backend', argv: ['node_modules/jest/bin/jest.js', '--ci', rel], resolved: raw };
  }
  // Addon suites are plain node scripts that print their own PASS/FAIL summary.
  return { ok: true, cwd: '.', argv: [raw], resolved: raw };
}

/**
 * Line shapes that START a failure, per the runners this repo actually uses.
 *
 * ⚠️ **Why head+tail was not enough.** The two ends are where the *verdict* is: a
 * build error appears near the top, the `Test Suites:` / `Tests:` counts at the
 * very end. But a failing Jest run prints its failure DETAIL in the middle — the
 * `●` block, the assertion diff, the code frame — between the two. So a run that
 * failed 3 suites came back to the model as "3 failed, 12 passed" with **nothing
 * about what failed**, and the only way to find out was to go and read the files.
 * That is exactly the "verification is re-reading" consequence G6 set out to
 * remove, and it makes the runner useless in the one case it exists for.
 *
 * Deliberately anchored and specific. A loose `/error/i` would match a passing
 * test whose name mentions error handling, and a signal list that fires on
 * everything keeps nothing. Each pattern matches the FIRST line of a failure
 * block; the lines that follow it are pulled in by `SIGNAL_CONTEXT_LINES`.
 */
const FAILURE_SIGNALS = Object.freeze([
  /^\s*●/,                                // Jest: start of a failed test/suite block
  /^\s*✕/,                                // Jest verbose; the addon scripts' own FAIL mark
  /^(?:FAIL|FAILED)\b/,                   // Jest's per-suite banner
  /^\s*✖/,                                // ESLint stylish summary ("✖ 3 problems")
  /\): error TS\d+/,                      // tsc diagnostic
  /^\s*\d+:\d+\s+(?:error|warning)\s/,    // ESLint stylish, one line per problem
  /^\s*(?:Expected|Received)(?::|\s)/,    // Jest assertion diff
  /^error during build/,                  // Vite
  /^\s*✗/,                                // Vite's own failure mark
  /^\s*AssertionError/,                   // bare assertion from a node script
  /Cannot find module/,
  /^\s*(?:SyntaxError|TypeError|ReferenceError)\b/,
  /^(?:Error|Denied):\s/,                 // this repo's own convention (see AUTOMATION_SECURITY.md)
]);

/**
 * How many lines after a signal belong to that failure's excerpt.
 *
 * A bare signal line is not enough — Jest's `●` is a header, and its diff and code
 * frame follow. Six covers `●` + the diff + the first stack frame without dragging
 * in the next test.
 */
const SIGNAL_CONTEXT_LINES = 6;

/** Ceiling on the excerpt block. 500 lint errors must not refill the budget. */
const MAX_SIGNAL_LINES = 40;

/**
 * Pull the failures out of the part of the output that would otherwise be dropped.
 *
 * Scans only the MIDDLE (a signal in the head or tail is already visible), takes
 * each signal plus a little context, merges overlapping windows, and stops at a
 * hard line budget — reporting how many excerpts it could not fit, so the model
 * knows the extract is incomplete rather than assuming it is the whole story.
 *
 * @returns {{blocks: string[], keptLines: number, groups: number, dropped: number}}
 */
function failureExcerpts(lines, from, to, { maxLines = MAX_SIGNAL_LINES, context = SIGNAL_CONTEXT_LINES } = {}) {
  const blocks = [];
  const kept = new Set();
  let groups = 0;
  let dropped = 0;
  let cursor = from;

  for (let i = from; i < to; i += 1) {
    if (!FAILURE_SIGNALS.some((re) => re.test(lines[i]))) continue;
    // Overlapping windows are one excerpt: two signals four lines apart describe
    // the same failure, and printing the lines twice is worse than printing them once.
    if (i < cursor) continue;

    const end = Math.min(i + context + 1, to);
    // ALL-OR-NOTHING against the budget. A window is added only if it fits whole,
    // because half an excerpt stops at an arbitrary line — and the line it would
    // cut is usually the `Received:` that explains the failure. This also makes
    // `maxLines` a real ceiling rather than an approximate one: a partial window
    // is how the first version overshot it (42 lines against a stated 40).
    if (kept.size + (end - i) > maxLines) { dropped += 1; continue; }

    for (let j = i; j < end; j += 1) kept.add(j);
    blocks.push(lines.slice(i, end).join('\n'));
    groups += 1;
    cursor = end;
  }

  return { blocks, keptLines: kept.size, groups, dropped };
}

/**
 * Shape a process's output for a model: keep the head, the tail, and any
 * failures hiding in the middle; drop the rest, and say how much was dropped.
 *
 * Both ends matter — a Jest failure summary is at the end, a build error near the
 * top — and the middle is where the 40,000 lines of passing tests live. The
 * exception is a FAILURE, which is the one thing in the middle worth keeping: see
 * `FAILURE_SIGNALS`.
 *
 * @returns {{text: string, truncated: boolean, omittedLines: number, totalLines: number,
 *            keptLines: number, excerpts: number}}
 */
function shapeOutput(raw, {
  headLines = RESULT_HEAD_LINES,
  tailLines = RESULT_TAIL_LINES,
  maxChars = RESULT_MAX_CHARS,
} = {}) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const totalLines = lines.length;

  let shaped = text;
  let omittedLines = 0;
  let keptLines = 0;
  let excerpts = 0;
  if (totalLines > headLines + tailLines) {
    const middleEnd = totalLines - tailLines;
    const { blocks, keptLines: kept, groups, dropped } = failureExcerpts(lines, headLines, middleEnd);
    // The excerpts already came out of the middle, so they are not "omitted".
    omittedLines = middleEnd - headLines - kept;
    keptLines = kept;
    excerpts = groups;

    // The plain phrasing is kept when nothing was rescued: an earlier reader (and
    // an earlier test) knows that shape, and inventing a more elaborate note for
    // the common case would be noise.
    const note = groups
      ? `… [${omittedLines} line(s) omitted; ${groups} failure excerpt(s) kept below${dropped ? `, ${dropped} more not shown` : ''}] …`
      : `… [${omittedLines} line(s) omitted] …`;

    shaped = [
      ...lines.slice(0, headLines),
      note,
      ...(blocks.length ? ['', ...blocks, ''] : []),
      ...lines.slice(middleEnd),
    ].join('\n');
  }

  let truncated = omittedLines > 0;
  if (shaped.length > maxChars) {
    // Final guard: a single enormous line (a minified stack, a base64 blob)
    // would otherwise sail past the line budget.
    shaped = `${shaped.slice(0, Math.floor(maxChars * 0.6))}\n… [output clipped at ${maxChars} chars] …\n${shaped.slice(-Math.floor(maxChars * 0.3))}`;
    truncated = true;
  }

  return {
    text: shaped.trim(),
    truncated,
    omittedLines,
    totalLines,
    // Reported so a caller can say "the evidence is in here" without re-parsing.
    keptLines,
    excerpts,
  };
}

let _tasks = TASKS;
/** Test hook: inject a task so the real spawn path can be exercised cheaply. */
function _setTasksForTests(tasks) { _tasks = tasks || TASKS; }

/** Whether execution is switched off by config. */
function runnerDisabled() {
  const v = String(process.env.REPO_RUNNER_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function execFileP(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({
        error,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

/**
 * Run one allowlisted task.
 *
 * @param {object} args
 * @param {string} args.task       one of TASK_NAMES
 * @param {string} [args.target]   required by `test:file`
 * @param {string} args.repoRoot   absolute repo root (cwd is resolved from it)
 * @returns {Promise<{ok: boolean, task: string, command: string, exitCode: number|null,
 *                    timedOut: boolean, durationMs: number, output: string, truncated: boolean, error?: string}>}
 */
async function runTask({ task, target, repoRoot }) {
  const spec = _tasks[task];
  if (!spec) {
    return { ok: false, task, error: `unknown task "${task}" — allowed: ${Object.keys(_tasks).join(', ')}` };
  }
  if (runnerDisabled()) {
    return { ok: false, task, error: 'the repository runner is disabled on this server (REPO_RUNNER_DISABLED).' };
  }
  if (!repoRoot) {
    return { ok: false, task, error: 'repository not available on this server.' };
  }

  let cwd = spec.cwd || '.';
  let argv = spec.argv;
  if (spec.targetKind === 'test-file') {
    const resolved = resolveTestTarget(target, { repoRoot });
    if (!resolved.ok) return { ok: false, task, error: resolved.error };
    cwd = resolved.cwd;
    argv = resolved.argv;
  }
  if (!argv || !argv.length) {
    return { ok: false, task, error: `task "${task}" has no command configured.` };
  }

  const absCwd = path.resolve(repoRoot, cwd);
  if (!absCwd.startsWith(path.resolve(repoRoot))) {
    return { ok: false, task, error: 'task working directory escapes the repository.' };
  }

  // argv[0] is a JS entry point; everything else is a literal argument. Running
  // it with our OWN node binary keeps this independent of PATH and of a shell.
  const [entry, ...rest] = argv;
  const command = `${task}${target ? ` ${target}` : ''}`;
  const startedAt = Date.now();

  logger.info(`[repoRunner] running "${command}" (cwd=${cwd})`);

  const { error, stdout, stderr } = await execFileP(process.execPath, [entry, ...rest], {
    cwd: absCwd,
    env: safeEnv(),
    timeout: spec.timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });

  const durationMs = Date.now() - startedAt;
  const timedOut = !!(error && (error.killed || error.signal === 'SIGKILL'));
  const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
  const combined = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
  const shaped = shapeOutput(combined);

  if (timedOut) {
    return {
      ok: false,
      task,
      command,
      exitCode,
      timedOut: true,
      durationMs,
      output: `${command} was killed after ${Math.round(spec.timeoutMs / 1000)}s (its time limit).\n\n${shaped.text}`,
      truncated: shaped.truncated,
      excerpts: shaped.excerpts,
    };
  }

  return {
    ok: !error,
    task,
    command,
    exitCode,
    timedOut: false,
    durationMs,
    output: shaped.text || '(no output)',
    truncated: shaped.truncated,
    // Carried out of the runner so the caller can say WHAT was kept, not just that
    // something was dropped. See the note in `repoAgentService.repo_run`.
    excerpts: shaped.excerpts,
  };
}

module.exports = {
  runTask,
  resolveTestTarget,
  shapeOutput,
  safeEnv,
  runnerDisabled,
  taskSummary,
  TASKS,
  TASK_NAMES,
  SAFE_ENV_KEYS,
  // The failure vocabulary, exported so the extract is testable directly and so a
  // new runner can be checked against it rather than assumed to fit.
  FAILURE_SIGNALS,
  MAX_SIGNAL_LINES,
  SIGNAL_CONTEXT_LINES,
  _setTasksForTests,
};
