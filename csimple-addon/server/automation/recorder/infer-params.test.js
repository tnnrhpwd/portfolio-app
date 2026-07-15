/**
 * Standalone unit tests for multi-demonstration parameter inference
 * (recorder/infer-params.js). Fully offline/deterministic — no LLM, no
 * network. Run with:
 *   node csimple-addon/server/automation/recorder/infer-params.test.js
 * Exit code 0 on success, 1 on first failure.
 */

const { inferParams, _collectLeaves, _getAtPath, _setAtPath, _isIgnoredPath, _uniqueParamName } = require('./infer-params');

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

function skill(steps, extra) {
    return { name: 'demo', slug: 'demo', description: '', steps, params: [], metadata: {}, ...extra };
}

// ─── low-level helpers ─────────────────────────────────────────────────────
{
    const leaves = [];
    _collectLeaves({ a: 1, b: { c: 'x' }, d: [1, 2] }, '', leaves);
    check('_collectLeaves finds all primitive leaves', leaves.length === 4);
    check('_collectLeaves nested path', leaves.some(l => l.path === 'b.c' && l.value === 'x'));
    check('_collectLeaves array path', leaves.some(l => l.path === 'd[0]' && l.value === 1));
}
{
    const obj = { args: { text: 'hi', nested: { n: 5 } } };
    check('_getAtPath reads nested', _getAtPath(obj.args, 'nested.n') === 5);
    _setAtPath(obj.args, 'nested.n', 99);
    check('_setAtPath writes nested', obj.args.nested.n === 99);
}
{
    check('_isIgnoredPath ignores x/y', _isIgnoredPath('args.x') && _isIgnoredPath('path[0].y'));
    check('_isIgnoredPath allows text', !_isIgnoredPath('args.text'));
    const used = new Set(['text']);
    check('_uniqueParamName dedupes', _uniqueParamName('args.text', used) === 'text2');
}

// ─── inferParams: requires 2+ demos ────────────────────────────────────────
{
    let threw = false;
    try { inferParams([skill([])]); } catch { threw = true; }
    check('inferParams throws with <2 skills', threw);
}

// ─── inferParams: step count mismatch → no-op ──────────────────────────────
{
    const a = skill([{ tool: 'click_at', args: { x: 1, y: 2 } }]);
    const b = skill([{ tool: 'click_at', args: { x: 1, y: 2 } }, { tool: 'click_at', args: { x: 3, y: 4 } }]);
    const { skill: out, report } = inferParams([a, b]);
    check('step count mismatch → not applied', report.applied === false);
    check('step count mismatch → reason set', typeof report.reason === 'string');
    check('step count mismatch → original steps preserved', out.steps.length === 1);
}

// ─── inferParams: literal schema — typed text varies, coords constant ──────
{
    const a = skill([
        { tool: 'click_at', args: { x: 100, y: 200 } },
        { tool: 'type_text', args: { text: 'hello world' } },
    ]);
    const b = skill([
        { tool: 'click_at', args: { x: 100, y: 200 } },
        { tool: 'type_text', args: { text: 'goodbye moon' } },
    ]);
    const { skill: out, report } = inferParams([a, b]);
    check('typed text promoted to param', report.paramsInferred === 1);
    check('coords NOT promoted (ignored leaf)', out.steps[0].args.x === 100 && out.steps[0].args.y === 200);
    check('text step now templated', /^\$\{param\.\w+\}$/.test(out.steps[1].args.text));
    const paramName = out.steps[1].args.text.match(/\$\{param\.(\w+)\}/)[1];
    check('params array has the inferred param', out.params.some(p => p.name === paramName));
    check('inferred param default is from first demo', out.params.find(p => p.name === paramName).default === 'hello world');
}

// ─── inferParams: abstracted schema (type-based, no .args) ─────────────────
{
    const a = skill([{ type: 'type_text', text: 'foo', target: { name: 'Search' } }]);
    const b = skill([{ type: 'type_text', text: 'bar', target: { name: 'Search' } }]);
    const { skill: out, report } = inferParams([a, b]);
    check('abstracted schema: text promoted', report.paramsInferred === 1);
    check('abstracted schema: target.name constant, untouched', out.steps[0].target.name === 'Search');
    check('abstracted schema: text templated in place', /^\$\{param\.\w+\}$/.test(out.steps[0].text));
}

// ─── inferParams: step kind mismatch at an index → skipped, not fatal ──────
{
    const a = skill([{ tool: 'click_at', args: { x: 1, y: 1 } }, { tool: 'type_text', args: { text: 'a' } }]);
    const b = skill([{ tool: 'click_at', args: { x: 1, y: 1 } }, { tool: 'shell_run', args: { cmd: 'echo hi' } }]);
    const { skill: out, report } = inferParams([a, b]);
    check('kind mismatch step is skipped, not throwing', report.findings.some(f => f.step === '1' && f.skipped));
    check('kind mismatch → original step 1 preserved unmodified', out.steps[1].tool === 'type_text');
}

// ─── inferParams: 3+ demonstrations, all must vary to promote ──────────────
{
    const mk = t => skill([{ tool: 'type_text', args: { text: t } }]);
    const { report } = inferParams([mk('a'), mk('a'), mk('a')]);
    check('identical values across all demos → not promoted', report.paramsInferred === 0);

    const { report: report2 } = inferParams([mk('a'), mk('b'), mk('a')]);
    check('any variance across demos → promoted', report2.paramsInferred === 1);
}

// ─── inferParams: recurses into loop_n_times body ──────────────────────────
{
    const a = skill([{ type: 'loop_n_times', count: 3, body: [{ type: 'type_text', text: 'x' }] }]);
    const b = skill([{ type: 'loop_n_times', count: 3, body: [{ type: 'type_text', text: 'y' }] }]);
    const { skill: out, report } = inferParams([a, b]);
    check('loop body leaf promoted', report.paramsInferred === 1);
    check('loop body step templated', /^\$\{param\.\w+\}$/.test(out.steps[0].body[0].text));
    check('nested finding uses body-qualified step label', report.findings.some(f => f.step === '0.body[0]'));
}

// ─── inferParams: existing params array is preserved and not clobbered ────
{
    const a = skill([{ tool: 'type_text', args: { text: 'a' } }], { params: [{ name: 'text', description: 'preexisting', type: 'string' }] });
    const b = skill([{ tool: 'type_text', args: { text: 'b' } }]);
    const { skill: out } = inferParams([a, b]);
    check('name collision with existing param gets a new unique name', out.params.some(p => p.name === 'text2'));
    check('preexisting param untouched', out.params.find(p => p.name === 'text').description === 'preexisting');
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
