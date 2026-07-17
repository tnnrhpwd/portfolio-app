/**
 * Pure unit tests for marketplaceCapabilities.js (§4.5/§6.2 server-side
 * capability-mismatch re-enforcement). No DynamoDB/network involved.
 */

const { summarizeCapabilities, TOOL_CATEGORY_MAP, CATEGORY_SEVERITY } = require('./marketplaceCapabilities');

describe('summarizeCapabilities', () => {
    test('throws on an invalid skill (no steps array)', () => {
        expect(() => summarizeCapabilities({})).toThrow();
        expect(() => summarizeCapabilities(null)).toThrow();
    });

    test('computes actualCategories from flattened steps', () => {
        const result = summarizeCapabilities({
            steps: [
                { tool: 'fs_read', args: {} },
                { tool: 'fs_write', args: {} },
            ],
        });
        expect(result.actualCategories.sort()).toEqual(['safe-read', 'sandboxed-write']);
        expect(result.toolCounts).toEqual({ fs_read: 1, fs_write: 1 });
    });

    test('no declaredCategories means no mismatches, even with dangerous tools', () => {
        const result = summarizeCapabilities({
            steps: [{ tool: 'shell_run', args: { command: 'rm -rf /' } }],
        });
        expect(result.mismatches).toEqual([]);
        expect(result.declaredCategories).toEqual([]);
    });

    test('flags a mismatch when declared categories understate actual risk', () => {
        const result = summarizeCapabilities({
            steps: [{ tool: 'shell_run', args: { command: 'echo hi' } }],
            declaredCategories: ['safe-read'],
        });
        expect(result.mismatches).toEqual([{ category: 'shell', tool: 'shell_run' }]);
    });

    test('no mismatch when the actual category is covered by the declaration', () => {
        const result = summarizeCapabilities({
            steps: [{ tool: 'shell_run', args: { command: 'echo hi' } }],
            declaredCategories: ['shell'],
        });
        expect(result.mismatches).toEqual([]);
    });

    test('an unregistered/unknown tool resolves to the "unknown" category and is flagged', () => {
        const result = summarizeCapabilities({
            steps: [{ tool: 'totally_made_up_tool', args: {} }],
            declaredCategories: ['safe-read'],
        });
        expect(result.actualCategories).toEqual(['unknown']);
        expect(result.mismatches).toEqual([{ category: 'unknown', tool: 'totally_made_up_tool' }]);
    });

    test('recurses into loop body steps', () => {
        const result = summarizeCapabilities({
            steps: [{
                tool: 'skill_run', // control-flow-ish step won't matter here; use body directly
                body: [{ tool: 'process_kill', args: {} }],
            }],
            declaredCategories: ['safe-read'],
        });
        // Both the outer step's own tool (skill_run → system) AND the body's
        // process_kill → destructive should be flattened and counted.
        expect(result.toolCounts.process_kill).toBe(1);
        expect(result.mismatches.some(m => m.tool === 'process_kill' && m.category === 'destructive')).toBe(true);
    });

    test('mismatches are sorted most-severe-first', () => {
        const result = summarizeCapabilities({
            steps: [
                { tool: 'clipboard_write', args: {} }, // sandboxed-write
                { tool: 'process_kill', args: {} }, // destructive
                { tool: 'shell_run', args: {} }, // shell
            ],
            declaredCategories: [],
        });
        // declaredCategories empty => no mismatches; re-run with a declaration
        // that excludes everything to exercise ordering.
        const result2 = summarizeCapabilities({
            steps: [
                { tool: 'clipboard_write', args: {} },
                { tool: 'process_kill', args: {} },
                { tool: 'shell_run', args: {} },
            ],
            declaredCategories: ['safe-read'],
        });
        expect(result.mismatches).toEqual([]);
        const severities = result2.mismatches.map(m => CATEGORY_SEVERITY.indexOf(m.category));
        const sorted = [...severities].sort((a, b) => b - a);
        expect(severities).toEqual(sorted);
    });

    test('TOOL_CATEGORY_MAP has no empty/invalid category values', () => {
        for (const [tool, category] of Object.entries(TOOL_CATEGORY_MAP)) {
            expect(typeof tool).toBe('string');
            expect(CATEGORY_SEVERITY).toContain(category);
        }
    });

    test('ignores non-object and _marker steps', () => {
        const result = summarizeCapabilities({
            steps: [null, undefined, { tool: '_marker' }, { tool: 'fs_read', args: {} }],
        });
        expect(result.toolCounts).toEqual({ fs_read: 1 });
    });
});
