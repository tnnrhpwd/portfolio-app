/**
 * Offline unit tests for the backend's server-side scrub re-enforcement
 * (docs/new/csimple-agent-prompt.md §4.5/§6.1). No DynamoDB required.
 *
 * Mirrors the coverage of csimple-addon/server/automation/recorder/
 * scrub.test.js since this module is a deliberate port of that logic — see
 * marketplaceScrub.js's header comment for why it's duplicated rather than
 * required across the repo/deploy boundary.
 */
const { scrubForPublish } = require('./marketplaceScrub');

function skillWith(steps, params = []) {
    return { steps, params };
}

describe('scrubForPublish', () => {
    test('clean skill produces no findings and is returned unchanged', () => {
        const input = skillWith([{ tool: 'click_at', args: { x: 1, y: 2 } }]);
        const { skill, report } = scrubForPublish(input);
        expect(report.clean).toBe(true);
        expect(report.findingCount).toBe(0);
        expect(skill.steps[0].args.x).toBe(1);
    });

    test('Windows user-profile path is promoted to ${param.userProfile}', () => {
        const input = skillWith([
            { tool: 'shell_run', args: { command: 'dir C:\\Users\\tanne\\Documents\\Secrets' } },
        ]);
        const { skill, report } = scrubForPublish(input);
        expect(skill.steps[0].args.command).toBe('dir ${param.userProfile}');
        expect(report.findings.some(f => f.kind === 'path')).toBe(true);
        expect(JSON.stringify(report)).not.toContain('tanne');
        expect(skill.params.some(p => p.name === 'userProfile')).toBe(true);
    });

    test('the userProfile param is only added once across multiple path occurrences', () => {
        const input = skillWith([
            { tool: 'shell_run', args: { command: 'copy C:\\Users\\bob\\a.txt C:\\Users\\bob\\b.txt' } },
        ]);
        const { skill } = scrubForPublish(input);
        expect(skill.params.filter(p => p.name === 'userProfile')).toHaveLength(1);
    });

    test.each([
        ['github-token', 'ghp_' + 'a'.repeat(36)],
        ['aws-access-key', 'AKIA' + 'B'.repeat(16)],
        ['slack-token', 'xoxb-1111111111-abcdefghij'],
        ['openai-key', 'sk-' + 'x'.repeat(24)],
    ])('redacts a %s-shaped secret without leaking it into the report', (_kindName, secret) => {
        const input = skillWith([{ tool: 'text_type', args: { text: `token=${secret}` } }]);
        const { skill, report } = scrubForPublish(input);
        expect(skill.steps[0].args.text).not.toContain(secret);
        expect(report.findings.some(f => f.kind === 'secret')).toBe(true);
        expect(JSON.stringify(report)).not.toContain(secret);
    });

    test('drops image-shaped arg keys entirely', () => {
        const input = skillWith([
            { tool: 'screenshot_check', args: { condition: 'dialog closed', screenshot: 'data:image/png;base64,AAAA' } },
        ]);
        const { skill, report } = scrubForPublish(input);
        expect(skill.steps[0].args.screenshot).toBeUndefined();
        expect(report.findings.some(f => f.kind === 'image')).toBe(true);
    });

    test('redacts a data-url string value even under a generic key name', () => {
        const input = skillWith([{ tool: 'type_text', args: { text: 'data:image/png;base64,' + 'A'.repeat(50) } }]);
        const { skill, report } = scrubForPublish(input);
        expect(skill.steps[0].args.text).toBe('[SCREENSHOT REMOVED]');
        expect(report.findings.some(f => f.kind === 'image')).toBe(true);
    });

    test('drops oversized inline strings as binary-ish', () => {
        const input = skillWith([{ tool: 'type_text', args: { text: 'a'.repeat(25_000) } }]);
        const { skill } = scrubForPublish(input);
        expect(skill.steps[0].args.text).toBe('[SCREENSHOT REMOVED]');
    });

    test('recurses into loop_n_times/loop_until_key step bodies', () => {
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
        expect(skill.steps[0].body[0].args.command).toBe('echo ${param.userProfile}');
        expect(report.findings.some(f => f.step.includes('.body[0]'))).toBe(true);
    });

    test('never mutates the input skill', () => {
        const input = skillWith([{ tool: 'shell_run', args: { command: 'dir C:\\Users\\carol\\x' } }]);
        scrubForPublish(input);
        expect(input.steps[0].args.command).toBe('dir C:\\Users\\carol\\x');
    });

    test('throws on an invalid skill shape', () => {
        expect(() => scrubForPublish({})).toThrow();
        expect(() => scrubForPublish(null)).toThrow();
    });
});
