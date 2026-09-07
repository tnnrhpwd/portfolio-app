/**
 * goalAgentController.test.js — unit tests for the pure live-step normalizer
 * used by POST /api/data/goal-agent/step. No network, no DynamoDB writes.
 */

const { normalizeStepEntry } = require('../../controllers/goalAgentController');

describe('goalAgentController.normalizeStepEntry', () => {
  test('maps a successful tool entry to a tool step with meta', () => {
    const steps = normalizeStepEntry({ tool: 'fs_list', args: { path: '/x' }, ok: true, result: '3 files', ts: '2026-09-06T10:00:00.000Z' });
    expect(steps[0]).toMatchObject({
      kind: 'tool',
      text: 'fs_list',
      meta: { tool: 'fs_list', args: { path: '/x' }, ok: true },
      ts: '2026-09-06T10:00:00.000Z',
    });
    expect(steps[1]).toMatchObject({ kind: 'tool-result', text: '3 files' });
  });

  test('maps a failed tool entry to an error step', () => {
    const steps = normalizeStepEntry({ tool: 'fs_write', args: {}, ok: false, result: 'permission denied' });
    expect(steps[0].kind).toBe('error');
    expect(steps[0].text).toBe('fs_write failed');
    expect(steps[0].meta.ok).toBe(false);
    expect(steps[1].kind).toBe('tool-result');
    expect(steps[1].text).toBe('permission denied');
  });

  test('produces only a tool step when there is no result', () => {
    const steps = normalizeStepEntry({ tool: 'open_app', ok: true });
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('tool');
  });

  test('coerces non-object args to {} and defaults the tool label', () => {
    const steps = normalizeStepEntry({ args: 'nope', ok: true });
    expect(steps[0].meta.args).toEqual({});
    expect(steps[0].meta.tool).toBe('step');
  });

  test('truncates long results to STEP_TEXT_MAX', () => {
    const big = 'x'.repeat(2000);
    const steps = normalizeStepEntry({ tool: 'shell', ok: true, result: big });
    expect(steps[1].text.length).toBeLessThanOrEqual(1000);
  });

  test('defaults ts to now when absent', () => {
    const steps = normalizeStepEntry({ tool: 'toolA', ok: true });
    expect(typeof steps[0].ts).toBe('string');
    expect(new Date(steps[0].ts).getTime()).not.toBeNaN();
  });
});
