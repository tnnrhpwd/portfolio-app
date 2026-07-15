/**
 * Standalone unit tests for the privacy scrub pass (recorder/scrub.js).
 *
 * Run with: `node csimple-addon/server/automation/recorder/scrub.test.js`
 * Exit code 0 on success, 1 on first failure.
 */

const { scrubForPublish } = require('./scrub');

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

function skillWith(steps, params = []) {
    return { name: 'demo', slug: 'demo', description: '', steps, params, metadata: {} };
}

// ─── clean skill → no findings ─────────────────────────────────────────────
{
    const input = skillWith([{ tool: 'click_at', args: { x: 1, y: 2 } }]);
    const { skill, report } = scrubForPublish(input);
    check('clean skill → clean=true', report.clean === true);
    check('clean skill → findingCount 0', report.findingCount === 0);
    check('clean skill → steps unchanged', skill.steps[0].args.x === 1);
}

// ─── Windows user path → param.userProfile ─────────────────────────────────
{
    const input = skillWith([
        { tool: 'shell_run', args: { command: 'dir C:\\Users\\tanne\\Documents\\Secrets' } },
    ]);
    const { skill, report } = scrubForPublish(input);
    check('path scrub → command rewritten', skill.steps[0].args.command === 'dir ${param.userProfile}');
    check('path scrub → finding recorded with kind=path', report.findings.some(f => f.kind === 'path'));
    check('path scrub → report never carries raw path', !JSON.stringify(report).includes('tanne'));
    check('path scrub → param added to skill.params', skill.params.some(p => p.name === 'userProfile'));
}

// ─── Path param is only added once across multiple occurrences ────────────
{
    const input = skillWith([
        { tool: 'shell_run', args: { command: 'copy C:\\Users\\bob\\a.txt C:\\Users\\bob\\b.txt' } },
    ]);
    const { skill } = scrubForPublish(input);
    check('path scrub → param added exactly once', skill.params.filter(p => p.name === 'userProfile').length === 1);
}

// ─── Secret-shaped strings redacted ────────────────────────────────────────
{
    const cases = [
        ['github-token', 'ghp_' + 'a'.repeat(36)],
        ['aws-access-key', 'AKIA' + 'B'.repeat(16)],
        ['slack-token', 'xoxb-1111111111-abcdefghij'],
        ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYc0wCM'],
        ['openai-key', 'sk-' + 'x'.repeat(24)],
    ];
    for (const [kindName, secret] of cases) {
        const input = skillWith([{ tool: 'text_type', args: { text: `token=${secret}` } }]);
        const { skill, report } = scrubForPublish(input);
        check(`secret scrub (${kindName}) → redacted`, !skill.steps[0].args.text.includes(secret));
        check(`secret scrub (${kindName}) → finding recorded`, report.findings.some(f => f.kind === 'secret'));
        check(`secret scrub (${kindName}) → report never carries raw secret`, !JSON.stringify(report).includes(secret));
    }
}

// ─── Image/screenshot-shaped values dropped ────────────────────────────────
{
    const input = skillWith([
        { tool: 'screenshot_check', args: { condition: 'dialog closed', screenshot: 'data:image/png;base64,AAAA' } },
    ]);
    const { skill, report } = scrubForPublish(input);
    check('image key dropped', skill.steps[0].args.screenshot === undefined);
    check('image key drop → finding recorded', report.findings.some(f => f.kind === 'image'));
}

{
    const input = skillWith([{ tool: 'type_text', args: { text: 'data:image/png;base64,' + 'A'.repeat(50) } }]);
    const { skill, report } = scrubForPublish(input);
    check('data-url string value redacted even under a generic key', skill.steps[0].args.text === '[SCREENSHOT REMOVED]');
    check('data-url string value → finding recorded', report.findings.some(f => f.kind === 'image'));
}

// ─── Oversized inline strings treated as binary-ish and dropped ──────────
{
    const input = skillWith([{ tool: 'type_text', args: { text: 'a'.repeat(25_000) } }]);
    const { skill } = scrubForPublish(input);
    check('oversized string dropped', skill.steps[0].args.text === '[SCREENSHOT REMOVED]');
}

// ─── Recurses into loop bodies ─────────────────────────────────────────────
{
    const input = skillWith([
        {
            type: 'loop_n_times',
            times: 3,
            body: [
                { tool: 'shell_run', args: { command: 'echo C:\\Users\\alice\\file.txt' } },
            ],
        },
    ]);
    const { skill, report } = scrubForPublish(input);
    check('loop body scrubbed', skill.steps[0].body[0].args.command === 'echo ${param.userProfile}');
    check('loop body finding uses nested step label', report.findings.some(f => f.step.includes('.body[0]')));
}

// ─── Does not mutate the input skill ───────────────────────────────────────
{
    const input = skillWith([{ tool: 'shell_run', args: { command: 'dir C:\\Users\\carol\\x' } }]);
    scrubForPublish(input);
    check('input skill left untouched', input.steps[0].args.command === 'dir C:\\Users\\carol\\x');
}

// ─── Invalid input ──────────────────────────────────────────────────────────
{
    let threw = false;
    try { scrubForPublish({}); } catch { threw = true; }
    check('invalid skill (no steps) throws', threw);
}

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
