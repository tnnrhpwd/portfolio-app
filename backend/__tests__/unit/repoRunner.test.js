/**
 * repoRunner.test.js — the allowlisted runner behind `repo_run`.
 *
 * This is the most dangerous capability in the harness, so the tests are about
 * the CONTAINMENT, not the happy path:
 *
 *   - a target that is not a test file under a known root never runs
 *   - the child process does not inherit the server's secrets  ← the big one
 *   - every run is bounded in time and in output
 *   - the kill switch actually switches it off
 *
 * The integration cases spawn REAL child processes (a temp script run by this
 * same node binary), because the things worth proving — environment scrubbing,
 * timeout, output shaping — only exist at the process boundary.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRunner = require('../../services/repoRunner');
const { getRepoRoot } = require('../../services/repoAgentService');

let tmp;
const REPO = getRepoRoot();

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reporunner-'));
  const write = (name, body) => fs.writeFileSync(path.join(tmp, name), body);

  write('echo.js', 'console.log("hello from child");');
  write('fail.js', 'console.error("boom: 3 assertions failed");\nprocess.exit(3);');
  write('slow.js', 'setTimeout(() => {}, 60000);');
  write('noisy.js', 'for (let i = 1; i <= 500; i++) console.log("line " + i);');
  write('show-env.js', [
    'console.log("JWT:" + (process.env.JWT_SECRET === undefined ? "absent" : "LEAKED"));',
    'console.log("AWS:" + (process.env.AWS_SECRET_ACCESS_KEY === undefined ? "absent" : "LEAKED"));',
    'console.log("GITHUB:" + (process.env.GITHUB_TOKEN === undefined ? "absent" : "LEAKED"));',
    'console.log("CI:" + process.env.CI);',
  ].join('\n'));

  repoRunner._setTasksForTests({
    demo: { label: 'demo', cwd: '.', argv: ['echo.js'], timeoutMs: 20000 },
    failing: { label: 'failing', cwd: '.', argv: ['fail.js'], timeoutMs: 20000 },
    slow: { label: 'slow', cwd: '.', argv: ['slow.js'], timeoutMs: 600 },
    noisy: { label: 'noisy', cwd: '.', argv: ['noisy.js'], timeoutMs: 20000 },
    envcheck: { label: 'envcheck', cwd: '.', argv: ['show-env.js'], timeoutMs: 20000 },
    escaping: { label: 'escaping', cwd: '..', argv: ['echo.js'], timeoutMs: 20000 },
    test: { label: 'one test file', targetKind: 'test-file', timeoutMs: 20000 },
  });
});

afterAll(() => {
  repoRunner._setTasksForTests(null);
  delete process.env.JWT_SECRET;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.REPO_RUNNER_DISABLED;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('resolveTestTarget — the validation that is the security boundary', () => {
  const resolve = (target) => repoRunner.resolveTestTarget(target, { repoRoot: REPO });

  test('rejects anything that is not a test file under a known tree', () => {
    expect(resolve('')).toMatchObject({ ok: false });
    expect(resolve('backend/server.js')).toMatchObject({ ok: false });          // not a test file
    expect(resolve('/etc/passwd')).toMatchObject({ ok: false });                // absolute
    expect(resolve('C:/Windows/system32/x.test.js')).toMatchObject({ ok: false });
    expect(resolve('../../etc/passwd.test.js')).toMatchObject({ ok: false });   // traversal
    expect(resolve('scripts/bootstrap.ps1')).toMatchObject({ ok: false });      // outside every tree
    expect(resolve('node_modules/jest/foo.test.js')).toMatchObject({ ok: false });
  });

  test('reports a file that does not exist rather than running nothing', () => {
    expect(resolve('backend/__tests__/unit/not-a-real-file.test.js')).toMatchObject({
      ok: false,
      error: expect.stringContaining('no such file'),
    });
  });

  test('frontend files run under the ROOT jest config, from the repo root', () => {
    // Running from inside frontend/ makes Jest default to the node environment
    // and every DOM suite dies with "document is not defined" — the wrong-runner
    // symptom this repo's instructions warn about.
    const out = resolve('frontend/src/components/SimpleAddon/StepList.test.jsx');
    expect(out).toMatchObject({ ok: true, cwd: '.' });
    expect(out.argv).toEqual([
      'node_modules/jest/bin/jest.js', '--config', 'package.json', '--ci',
      'frontend/src/components/SimpleAddon/StepList.test.jsx',
    ]);
  });

  test('backend files run from inside backend, with the path made relative', () => {
    const out = resolve('backend/__tests__/unit/toolLoop.test.js');
    expect(out).toMatchObject({ ok: true, cwd: 'backend' });
    expect(out.argv).toEqual([
      'node_modules/jest/bin/jest.js', '--ci', '__tests__/unit/toolLoop.test.js',
    ]);
  });

  test('addon files run as plain node scripts, which is how the addon runs them', () => {
    const out = resolve('simple-addon/server/automation/recorder/compiler.test.js');
    expect(out).toMatchObject({ ok: true, cwd: '.' });
    expect(out.argv).toEqual(['simple-addon/server/automation/recorder/compiler.test.js']);
  });

  test('accepts the spec-file spellings too', () => {
    expect(resolve('backend/__tests__/unit/toolLoop.test.js').ok).toBe(true);
    expect(repoRunner.resolveTestTarget('backend/x/y.spec.ts', { repoRoot: REPO }))
      .toMatchObject({ ok: false }); // tree check still applies
  });
});

describe('shapeOutput', () => {
  test('leaves a short result alone', () => {
    const out = repoRunner.shapeOutput('one\ntwo\nthree');
    expect(out).toMatchObject({ truncated: false, omittedLines: 0, totalLines: 3 });
    expect(out.text).toBe('one\ntwo\nthree');
  });

  test('keeps the head and the tail, and says how much it dropped', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const out = repoRunner.shapeOutput(lines.join('\n'));

    expect(out.truncated).toBe(true);
    expect(out.omittedLines).toBe(300 - 60 - 40); // 200
    expect(out.text).toContain('line 1');
    expect(out.text).toContain('line 300');
    expect(out.text).toContain('[200 line(s) omitted]');
    expect(out.text).not.toContain('line 150');
  });

  test('a single enormous line is clipped, not passed through', () => {
    const out = repoRunner.shapeOutput('x'.repeat(50000));
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThan(9000);
    expect(out.text).toContain('output clipped');
  });
});

/**
 * The middle is where a FAILING run keeps its evidence.
 *
 * Head+tail stored the verdict — "Test Suites: 3 failed" is at the end — and threw
 * away the reason, so the model learned that something failed and nothing about
 * what. These cases are built from real Jest / tsc / ESLint output shapes.
 */
describe('shapeOutput — the failures in the middle', () => {
  /** A Jest run: chatter, then a failure block in the middle, then the summary. */
  const jestRun = ({ failures = 1, filler = 200 } = {}) => {
    const lines = [];
    for (let i = 0; i < 60; i += 1) lines.push(`  ✓ passes ${i}`);
    for (let i = 0; i < filler; i += 1) lines.push(`  ✓ filler ${i}`);
    for (let f = 0; f < failures; f += 1) {
      lines.push(`  ● suite ${f} › does the thing`);
      lines.push('');
      lines.push('    expect(received).toBe(expected)');
      lines.push('');
      lines.push(`    Expected: ${f}`);
      lines.push(`    Received: ${f + 1}`);
      lines.push('      at Object.<anonymous> (src/x.js:12:5)');
      lines.push('');
    }
    for (let i = 0; i < filler; i += 1) lines.push(`  ✓ filler b${i}`);
    lines.push('Test Suites: 1 failed, 1 passed, 2 total');
    lines.push('Tests:       1 failed, 199 passed, 200 total');
    return lines.join('\n');
  };

  test('keeps the assertion diff instead of only the counts', () => {
    const out = repoRunner.shapeOutput(jestRun());

    expect(out.truncated).toBe(true);
    expect(out.text).toContain('● suite 0 › does the thing');
    expect(out.text).toContain('Expected: 0');
    expect(out.text).toContain('Received: 1');
    // …and still the verdict, which was never the problem.
    expect(out.text).toContain('Tests:       1 failed, 199 passed, 200 total');
    expect(out.excerpts).toBe(1);
  });

  test('accounts for every line: head + tail + kept + omitted = total', () => {
    // The off-by-one that matters. The excerpts come OUT of the middle, so counting
    // them as omitted too would overstate what was dropped — and a model told "340
    // lines omitted" when the failures are right there reads a truncated run as an
    // empty one.
    const out = repoRunner.shapeOutput(jestRun());
    const head = 60;
    const tail = 40;

    expect(head + tail + out.keptLines + out.omittedLines).toBe(out.totalLines);
    expect(out.omittedLines).toBeLessThan(out.totalLines - head - tail);
  });

  test('says the extract is partial when it had to drop excerpts', () => {
    // 12 failures at 7 lines each exceeds the 40-line budget. The model must be
    // told the list is truncated, or it will treat 5 excerpts as the whole story.
    const out = repoRunner.shapeOutput(jestRun({ failures: 12 }));

    expect(out.excerpts).toBeGreaterThan(0);
    expect(out.text).toMatch(/failure excerpt\(s\) kept below, \d+ more not shown/);
    expect(out.keptLines).toBeLessThanOrEqual(repoRunner.MAX_SIGNAL_LINES);
  });

  test('does not reprint a failure that was already visible in the head', () => {
    // Only the middle is scanned. A signal inside the retained head is already on
    // screen, and duplicating it would spend the budget twice.
    const lines = [];
    lines.push('FAIL __tests__/unit/early.test.js');
    lines.push('  ● suite › broke immediately');
    for (let i = 0; i < 300; i += 1) lines.push(`  ✓ filler ${i}`);
    lines.push('Tests:       1 failed, 300 passed');

    const out = repoRunner.shapeOutput(lines.join('\n'));

    expect(out.excerpts).toBe(0);
    // 303 lines total, 60 kept as head, 40 as tail, so the middle is 203 — which
    // is what "omitted" counts. The plain note is used when nothing was rescued.
    expect(out.totalLines).toBe(303);
    expect(out.omittedLines).toBe(203);
    expect(out.text).toContain('[203 line(s) omitted]');
    expect(out.text.match(/broke immediately/g)).toHaveLength(1);
  });

  test('fires on the other runners too, not just Jest', () => {
    const build = ['vite v5', ...Array.from({ length: 200 }, (_, i) => `  ok ${i}`), 'error during build:', 'Expected identifier in class selector'];
    const tsc = ['> tsc', ...Array.from({ length: 200 }, (_, i) => `  ok ${i}`), 'src/Net.tsx(12,5): error TS2322: Type mismatch.'];
    const lint = ['> eslint', ...Array.from({ length: 200 }, (_, i) => `  ok ${i}`), '  12:5  error  unused  no-unused-vars'];

    expect(repoRunner.shapeOutput(build.join('\n')).text).toContain('Expected identifier in class selector');
    expect(repoRunner.shapeOutput(tsc.join('\n')).text).toContain('error TS2322');
    expect(repoRunner.shapeOutput(lint.join('\n')).text).toContain('no-unused-vars');
  });

  test('the excerpt count reaches the caller, so the tool can describe the trim', () => {
    // The result note is built in `repoAgentService.repo_run`, and it has to say
    // what was KEPT. The old wording ("trimmed to the first and last lines") stops
    // being merely vague once failures are rescued from the middle: a model that
    // reads it concludes the failure detail is absent and goes to re-read the
    // source — the exact behaviour `repo_run` exists to remove.
    const out = repoRunner.shapeOutput(jestRun());

    expect(out.excerpts).toBeGreaterThan(0);
    expect(typeof out.excerpts).toBe('number');
  });

  test('reports zero excerpts when nothing was rescued', () => {
    // So the tool can fall back to the plain note rather than claiming evidence it
    // does not have.
    const lines = Array.from({ length: 300 }, (_, i) => `plain ${i}`);
    expect(repoRunner.shapeOutput(lines.join('\n')).excerpts).toBe(0);
  });

  test('does not mistake a passing line for a failure', () => {
    // The vocabulary is anchored for this reason: a loose /error/i would match
    // every passing test whose NAME mentions errors, and pull 200 of them into the
    // extract — which is the same as keeping nothing.
    const lines = [];
    for (let i = 0; i < 60; i += 1) lines.push(`  ✓ passes ${i}`);
    for (let i = 0; i < 200; i += 1) lines.push(`  ✓ handles the error case ${i}`);
    for (let i = 0; i < 40; i += 1) lines.push(`  ✓ tail ${i}`);

    const out = repoRunner.shapeOutput(lines.join('\n'));

    expect(out.excerpts).toBe(0);
    expect(out.text).toContain('[200 line(s) omitted]');
  });

  test('a failure hides nothing else: the head and tail survive intact', () => {
    const out = repoRunner.shapeOutput(jestRun());

    // Order is the reading order of a CI log: context, then evidence, then verdict.
    expect(out.text).toContain('✓ passes 0');
    expect(out.text).toContain('✓ filler b199');
    expect(out.text.indexOf('✓ passes 0')).toBeLessThan(out.text.indexOf('● suite 0'));
    expect(out.text.indexOf('● suite 0')).toBeLessThan(out.text.indexOf('Test Suites:'));
  });
});

describe('safeEnv', () => {
  test('drops the secrets the backend process holds', () => {
    const env = repoRunner.safeEnv({
      PATH: '/usr/bin', HOME: '/home/x',
      JWT_SECRET: 'nope', AWS_SECRET_ACCESS_KEY: 'nope', GITHUB_TOKEN: 'nope',
      MESSAGE_ENCRYPTION_KEY: 'nope', STRIPE_SECRET_KEY: 'nope',
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/x');
    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.MESSAGE_ENCRYPTION_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  test('forces CI so a runner never sits waiting for input', () => {
    expect(repoRunner.safeEnv({ PATH: '/usr/bin' }).CI).toBe('1');
  });
});

describe('the tool description list', () => {
  test('names every task, derived rather than hand-copied', () => {
    const summary = repoRunner.taskSummary();
    for (const name of repoRunner.TASK_NAMES) expect(summary).toContain(name);
    // The narrow one must still be in the list — it is what the prompt tells the
    // model to reach for first.
    expect(repoRunner.TASK_NAMES).toContain('test:file');
    expect(repoRunner.TASK_NAMES).toContain('typecheck');
  });
});

describe('runTask — real child processes', () => {
  test('runs an allowlisted task and reports PASSED with its output', async () => {
    const res = await repoRunner.runTask({ task: 'demo', repoRoot: tmp });
    expect(res).toMatchObject({ ok: true, task: 'demo', exitCode: 0, timedOut: false });
    expect(res.output).toContain('hello from child');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('a non-zero exit is a FAILED result, not an exception', async () => {
    const res = await repoRunner.runTask({ task: 'failing', repoRoot: tmp });
    expect(res).toMatchObject({ ok: false, exitCode: 3, timedOut: false });
    expect(res.output).toContain('boom: 3 assertions failed');
  });

  test('⚠️ the child does NOT inherit the server\'s secrets', async () => {
    process.env.JWT_SECRET = 'super-secret-value';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret-value';
    process.env.GITHUB_TOKEN = 'github-secret-value';

    const res = await repoRunner.runTask({ task: 'envcheck', repoRoot: tmp });

    expect(res.output).toContain('JWT:absent');
    expect(res.output).toContain('AWS:absent');
    expect(res.output).toContain('GITHUB:absent');
    expect(res.output).toContain('CI:1');
    expect(res.output).not.toContain('LEAKED');
  });

  test('a noisy run comes back bounded, with both ends intact', async () => {
    const res = await repoRunner.runTask({ task: 'noisy', repoRoot: tmp });
    expect(res.truncated).toBe(true);
    expect(res.output).toContain('line 1');
    expect(res.output).toContain('line 500');
    expect(res.output.length).toBeLessThan(9000);
  });

  test('a task that overruns its time limit is killed and reported as such', async () => {
    const res = await repoRunner.runTask({ task: 'slow', repoRoot: tmp });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.output).toMatch(/was killed after/);
  });

  test('a working directory that escapes the repository is refused', async () => {
    const res = await repoRunner.runTask({ task: 'escaping', repoRoot: tmp });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/escapes the repository/);
  });

  test('an unknown task name has nowhere to land', async () => {
    const res = await repoRunner.runTask({ task: 'rm -rf /', repoRoot: tmp });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/unknown task/);
  });

  test('the kill switch switches it off', async () => {
    process.env.REPO_RUNNER_DISABLED = '1';
    const res = await repoRunner.runTask({ task: 'demo', repoRoot: tmp });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/disabled on this server/);
    expect(repoRunner.runnerDisabled()).toBe(true);
    delete process.env.REPO_RUNNER_DISABLED;
  });

  test('test:file refuses a bad target before spawning anything', async () => {
    const res = await repoRunner.runTask({ task: 'test', target: 'package.json', repoRoot: tmp });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/must be a test file/);
  });

  test('no repository means no run', async () => {
    const res = await repoRunner.runTask({ task: 'demo', repoRoot: null });
    expect(res).toMatchObject({ ok: false });
  });
});
