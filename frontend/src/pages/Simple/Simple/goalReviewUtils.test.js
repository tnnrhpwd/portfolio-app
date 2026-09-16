/**
 * goalReviewUtils.test.js — grouping, staging and the small readings the
 * "Work on my goals" panel needs.
 */

import {
  PROPOSAL_SECTIONS,
  proposalIcon,
  groupProposals,
  toggleStaged,
  liveStaged,
  reviewAge,
  horizonChange,
  batchSummary,
  batchSummaryText,
  stagedItems,
  lessonToWorkspaceItem,
} from './goalReviewUtils.js';

const item = (id, kind, over = {}) => ({ id, kind, title: id, why: 'because', ...over });

describe('goalReviewUtils · grouping', () => {
  test('sections render in a fixed order and empty ones are dropped', () => {
    const groups = groupProposals([
      item('n1', 'new-goal'),
      item('h1', 'horizon'),
      item('p1', 'plan'),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['horizon', 'plan', 'new-goal']);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(PROPOSAL_SECTIONS.map((s) => s.kind)).toEqual(['horizon', 'split', 'plan', 'new-goal']);
  });

  test('a kind the panel cannot render is not shown at all', () => {
    // The apply step can't execute it, so offering it would be a dead end.
    expect(groupProposals([item('x', 'merge'), item('h1', 'horizon')]).map((g) => g.kind)).toEqual(['horizon']);
    expect(groupProposals(null)).toEqual([]);
  });

  test('every kind has an icon', () => {
    for (const section of PROPOSAL_SECTIONS) expect(proposalIcon(section.kind)).toBe(section.icon);
    expect(proposalIcon('something-else')).toBe('•');
  });
});

describe('goalReviewUtils · staging', () => {
  test('toggling stages and unstages without touching the caller', () => {
    const staged = new Set(['a']);
    const after = toggleStaged(staged, 'b');
    expect([...after]).toEqual(['a', 'b']);
    expect([...staged]).toEqual(['a']);
    expect([...toggleStaged(after, 'a')]).toEqual(['b']);
  });

  test('staged ids that no longer exist are dropped', () => {
    // A refresh replaces the review; an id that is gone can't be applied, so the
    // button must not count it.
    const items = [item('a', 'plan'), item('b', 'plan')];
    expect(liveStaged(new Set(['a', 'gone']), items)).toEqual(['a']);
    expect(liveStaged(new Set(['a']), null)).toEqual([]);
  });

  test('the staged proposals come back in panel order', () => {
    const items = [item('a', 'plan'), item('b', 'horizon'), item('c', 'plan')];
    expect(stagedItems(items, new Set(['c', 'b'])).map((i) => i.id)).toEqual(['b', 'c']);
    expect(stagedItems(null, new Set(['a']))).toEqual([]);
  });

  test('the batch reads as a count of what it will produce', () => {
    // `split` counts as goals because a split creates its children.
    expect(batchSummary(['split', 'child', 'plan'])).toEqual({ count: 3, goals: 2, plans: 1, rescoped: 0 });
    expect(batchSummary([])).toEqual({ count: 0, goals: 0, plans: 0, rescoped: 0 });
    expect(batchSummary(null)).toEqual({ count: 0, goals: 0, plans: 0, rescoped: 0 });
    // A re-scope changes a goal; it does not create one.
    expect(batchSummary(['horizon', 'horizon', 'new-goal']))
      .toEqual({ count: 3, goals: 1, plans: 0, rescoped: 2 });
  });

  test('the batch is described in words that match what it does', () => {
    expect(batchSummaryText(batchSummary(['horizon']))).toBe('1 goal re-scoped');
    expect(batchSummaryText(batchSummary(['horizon', 'horizon', 'plan', 'new-goal'])))
      .toBe('2 goals re-scoped, 1 goal created, 1 plan created');
    expect(batchSummaryText(batchSummary([]))).toBe('');
    expect(batchSummaryText(null)).toBe('');
  });
});

describe('goalReviewUtils · readings', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z');

  test('the age is coarse but honest, and empty when unknown', () => {
    expect(reviewAge('2026-09-15T11:59:30.000Z', now)).toBe('just now');
    expect(reviewAge('2026-09-15T11:40:00.000Z', now)).toBe('20 min ago');
    expect(reviewAge('2026-09-15T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(reviewAge('2026-09-14T09:00:00.000Z', now)).toBe('1 day ago');
    expect(reviewAge('nonsense', now)).toBe('');
    expect(reviewAge(null, now)).toBe('');
  });

  test('a re-scope reads as from → to, with the unset state named', () => {
    const labels = { week: 'This week', quarter: 'This quarter', life: 'Life' };
    expect(horizonChange('life', 'week', labels)).toBe('Life → This week');
    expect(horizonChange(null, 'quarter', labels)).toBe('No horizon → This quarter');
    expect(horizonChange(undefined, undefined, undefined)).toBe('No horizon → No horizon');
  });
});

describe('goalReviewUtils · keeping an observation', () => {
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  test('becomes a lesson item the agent’s own memory can recall', () => {
    const out = lessonToWorkspaceItem('Three quarter goals all block on the same bank login', slugify);
    expect(out.slug).toBe('three-quarter-goals-all-block-on-the-same-bank-login');
    expect(JSON.parse(out.content)).toEqual({
      pattern: 'Three quarter goals all block on the same bank login',
      source: 'goal-review',
      confidence: 0.5,
    });
  });

  test('a long observation is clipped in the name but kept whole in the body', () => {
    const long = 'x'.repeat(200);
    const out = lessonToWorkspaceItem(long, slugify);
    expect(out.name.length).toBeLessThanOrEqual(80);
    expect(out.name.endsWith('…')).toBe(true);
    expect(JSON.parse(out.content).pattern).toHaveLength(200);
  });

  test('nothing comes from nothing', () => {
    expect(lessonToWorkspaceItem('', slugify)).toBeNull();
    expect(lessonToWorkspaceItem(null, slugify)).toBeNull();
  });
});
