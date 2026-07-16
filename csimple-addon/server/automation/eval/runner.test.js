/**
 * Standalone unit tests for the eval scenario runner's HTTP scenario mode
 * (docs/new/csimple-agent-prompt.md §5.5) — `runner.js` + `http-app.js`.
 *
 * Exercises both the pure assertion-evaluation helpers (no server needed)
 * and a real end-to-end run of an HTTP scenario against the actual
 * `mountAutomation()` Express app booted on an ephemeral localhost port,
 * using the offline/deterministic `/api/skill/capabilities` route so no
 * LLM/network calls are involved.
 *
 * Run with: `node csimple-addon/server/automation/eval/runner.test.js`
 * Exit code 0 on success, 1 on first failure.
 */

const path = require('path');
const {
    evaluateFieldAssertion,
    evaluateHttpExpectations,
    runScenarioFile,
    runScenarioObject,
    closeEvalHttpServer,
} = require('./runner');

let failed = 0;
let total = 0;

function check(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

(async () => {
    // ── evaluateFieldAssertion ──────────────────────────────────────────
    console.log('evaluateFieldAssertion');
    check('minLength passes when long enough', evaluateFieldAssertion('x', [1, 2], { minLength: 1 }).length === 0);
    check('minLength fails when too short', evaluateFieldAssertion('x', [], { minLength: 1 }).length === 1);
    check('minLength fails on non-array/string', evaluateFieldAssertion('x', 5, { minLength: 1 }).length === 1);
    check('maxLength passes within bound', evaluateFieldAssertion('x', [1], { maxLength: 2 }).length === 0);
    check('maxLength fails over bound', evaluateFieldAssertion('x', [1, 2, 3], { maxLength: 2 }).length === 1);
    check('type array passes for arrays', evaluateFieldAssertion('x', [], { type: 'array' }).length === 0);
    check('type array fails for objects', evaluateFieldAssertion('x', {}, { type: 'array' }).length === 1);
    check('type boolean passes', evaluateFieldAssertion('x', true, { type: 'boolean' }).length === 0);
    check('type string fails for number', evaluateFieldAssertion('x', 5, { type: 'string' }).length === 1);
    check('contains passes on substring', evaluateFieldAssertion('x', 'hello world', { contains: 'world' }).length === 0);
    check('contains fails on missing substring', evaluateFieldAssertion('x', 'hello', { contains: 'world' }).length === 1);
    check('matches passes on regex', evaluateFieldAssertion('x', 'abc123', { matches: '^abc' }).length === 0);
    check('matches fails on non-match', evaluateFieldAssertion('x', 'xyz', { matches: '^abc' }).length === 1);
    check('exists true passes when present', evaluateFieldAssertion('x', 'v', { exists: true }).length === 0);
    check('exists true fails when absent', evaluateFieldAssertion('x', undefined, { exists: true }).length === 1);
    check('exists false passes when absent', evaluateFieldAssertion('x', undefined, { exists: false }).length === 0);
    check('equals passes on deep-equal objects', evaluateFieldAssertion('x', { a: 1 }, { equals: { a: 1 } }).length === 0);
    check('equals fails on mismatch', evaluateFieldAssertion('x', { a: 1 }, { equals: { a: 2 } }).length === 1);
    check('bare-value shorthand passes on match', evaluateFieldAssertion('x', 5, 5).length === 0);
    check('bare-value shorthand fails on mismatch', evaluateFieldAssertion('x', 5, 6).length === 1);
    check('undefined assertion is a no-op', evaluateFieldAssertion('x', 5, undefined).length === 0);

    // ── evaluateHttpExpectations ─────────────────────────────────────────
    console.log('\nevaluateHttpExpectations');
    check(
        'status mismatch reported',
        evaluateHttpExpectations({ status: 200 }, { status: 400, body: {} }).length === 1,
    );
    check(
        'ok=true passes when body.ok is true',
        evaluateHttpExpectations({ ok: true }, { status: 200, body: { ok: true } }).length === 0,
    );
    check(
        'ok=true fails when body.ok is falsy',
        evaluateHttpExpectations({ ok: true }, { status: 400, body: { error: 'nope' } }).length === 1,
    );
    check(
        'dotted-path field assertion reaches nested value',
        evaluateHttpExpectations({ 'stats.enabled': true }, { status: 200, body: { stats: { enabled: true } } }).length === 0,
    );
    check(
        'dotted-path field assertion fails when nested value differs',
        evaluateHttpExpectations({ 'stats.enabled': true }, { status: 200, body: { stats: { enabled: false } } }).length === 1,
    );
    check(
        'no expect block never fails',
        evaluateHttpExpectations(undefined, { status: 500, body: null }).length === 0,
    );

    // ── require.env gate applies to http scenarios too ──────────────────
    console.log('\nrequire.env gating (http scenarios)');
    delete process.env.EVAL_TEST_GATE_UNSET;
    const gatedSkip = await runScenarioObject({
        name: 'gated http scenario',
        require: { env: { EVAL_TEST_GATE_UNSET: '1' } },
        http: { method: 'GET', path: '/api/does-not-matter' },
    });
    check('scenario is skipped when required env var is absent', !!gatedSkip.skippedReason);

    // ── End-to-end: run the real offline HTTP scenario file ────────────
    console.log('\nend-to-end HTTP scenario execution');
    const scenarioPath = path.join(__dirname, 'scenarios', '17-skill-capabilities-http.json');
    const report = await runScenarioFile(scenarioPath);
    check('offline capability-summary HTTP scenario passes', report.passed === true, JSON.stringify(report.failures));
    check('report records exactly one HTTP step', report.steps.length === 1 && report.steps[0].mode === 'http');

    // A deliberately-failing HTTP scenario (wrong expected status) should
    // report failures without throwing.
    const failingReport = await runScenarioObject({
        name: 'deliberately failing http scenario',
        http: {
            method: 'POST',
            path: '/api/skill/capabilities',
            body: { skill: { name: 'x', steps: [{ tool: 'click_at', args: { x: 1, y: 1 } }] } },
        },
        expect: { status: 999 },
    });
    check('mismatched status produces a failure, not a throw', failingReport.passed === false && failingReport.failures.length === 1);

    await closeEvalHttpServer();

    console.log(`\nrunner.test: ${total - failed}/${total} complete`);
    console.log(`Results: ${total - failed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
    console.error('[runner.test] fatal:', err);
    process.exit(1);
});
