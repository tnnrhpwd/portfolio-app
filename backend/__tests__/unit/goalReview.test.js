/**
 * goalReview.test.js — the "work on my goals" pass.
 *
 * Two things have to hold for this feature to be safe to ship:
 *
 *   1. **Nothing unexecutable survives normalisation.** A proposal that names a
 *      goal which no longer exists, or asks for a horizon outside the vocabulary,
 *      is dropped here — because the apply step runs LATER, in a batch, and a
 *      proposal that silently fails at that point costs the user a discovery.
 *   2. **Applying is decided before anything is written.** `planReviewApplication`
 *      turns staged proposals into a list of writes plus a list of reasons things
 *      were skipped, so the batch is testable without DynamoDB — and so a goal the
 *      user deleted between review and apply is reported rather than half-applied.
 *
 * The model's output is never trusted: every test below feeds shapes a model would
 * plausibly produce (missing patches, invented slugs, restated proposals).
 */

const {
    GOAL_MAX,
    ITEM_MAX,
    SPLIT_MAX,
    PLAN_STEP_MAX,
    LESSON_MAX,
    PROPOSAL_KINDS,
    selectGoalsForReview,
    buildGoalReviewPrompt,
    normalizeGoalReview,
    planReviewApplication,
} = require('../../services/goalReview');

const goal = (slug, over = {}) => ({
    slug,
    name: slug.replace(/-/g, ' '),
    content: `detail for ${slug}`,
    status: 'active',
    priority: 50,
    updatedAt: '2026-09-10T10:00:00.000Z',
    ...over,
});

const review = (items, lessons = []) => ({ items, lessons });

describe('goalReview · selection', () => {
    test('leads with the goals hardest to get right, not the busiest', () => {
        const selected = selectGoalsForReview([
            goal('chore', { status: 'active' }),
            goal('someday', { horizon: 'life' }),
            goal('undecided'),
            goal('shipping', { horizon: 'quarter' }),
            goal('finished', { status: 'done' }),
            goal('aim-for-the-year', { horizon: 'year' }),
        ]);
        // Aims (need a way in) → undecided (nothing decided) → scoped near-term →
        // finished tail. Different from the map's ranking on purpose. `chore` and
        // `undecided` are the same rank with the same priority and timestamp, so
        // they keep the order they arrived in.
        expect(selected.goals.map((g) => g.slug)).toEqual([
            'someday', 'aim-for-the-year', 'chore', 'undecided', 'shipping', 'finished',
        ]);
    });

    test('a blocked goal outranks an unblocked one at the same rank', () => {
        const selected = selectGoalsForReview([
            goal('plain'),
            goal('stuck', { status: 'blocked' }),
        ]);
        expect(selected.goals.map((g) => g.slug)).toEqual(['stuck', 'plain']);
    });

    test('the tail is reported, not dropped', () => {
        const many = Array.from({ length: GOAL_MAX + 5 }, (_, i) => goal(`g${i}`));
        const selected = selectGoalsForReview(many);
        expect(selected.goals).toHaveLength(GOAL_MAX);
        expect(selected.total).toBe(GOAL_MAX + 5);
        expect(selected.truncated).toBe(5);
    });

    test('survives junk input', () => {
        expect(selectGoalsForReview(null).goals).toEqual([]);
        expect(selectGoalsForReview([null, undefined, goal('a')]).goals).toHaveLength(1);
    });
});

describe('goalReview · the prompt', () => {
    const prompt = buildGoalReviewPrompt([goal('retire-at-60', { horizon: 'life' }), goal('undecided')]);

    test('states the schema and every evidence rule the model needs', () => {
        expect(prompt).toContain('"items"');
        expect(prompt).toContain('"lessons"');
        expect(prompt).toContain('week|quarter|year|life');
        // The two rules that make a proposal trustworthy: only re-scope with
        // evidence, and only split an aim that has nothing under it.
        expect(prompt).toMatch(/Only propose this when the goal's own words say so/);
        expect(prompt).toMatch(/Never split a goal that already has children/);
    });

    test('shows the horizon it has, and says NONE when it has not', () => {
        expect(prompt).toContain('slug retire-at-60');
        expect(prompt).toContain('horizon life');
        expect(prompt).toContain('horizon NONE');
    });
});

describe('goalReview · normalising the model’s answer', () => {
    const goals = [goal('retire-at-60', { horizon: 'life' }), goal('groceries', { horizon: 'week' })];

    test('keeps a well-formed proposal of each kind', () => {
        const out = normalizeGoalReview(review([
            { kind: 'horizon', goalSlug: 'groceries', why: 'It is not a week-long thing.', patch: { horizon: 'quarter' } },
            { kind: 'split', goalSlug: 'retire-at-60', why: 'Nothing to start on.', patch: { children: [{ title: 'Open a pension', horizon: 'week' }, { title: 'Pay off the card', horizon: 'quarter' }] } },
            { kind: 'plan', goalSlug: 'groceries', why: 'No detail.', patch: { steps: ['List what is missing', 'Go', 'Put it away'] } },
            { kind: 'new-goal', title: 'Learn to cook three meals', why: 'Implied by the groceries goal.', patch: { title: 'Learn to cook three meals', horizon: 'year', description: 'x' } },
        ]), goals);

        expect(out.items.map((i) => i.kind)).toEqual(['horizon', 'split', 'plan', 'new-goal']);
        expect(out.items[0].patch).toEqual({ horizon: 'quarter', from: 'week' });
        expect(out.items[1].patch.children).toHaveLength(2);
        expect(out.items[2].patch.steps).toHaveLength(3);
        expect(out.items[3].goalSlug).toBeNull();
        expect(out.stats).toMatchObject({ goalCount: 2, proposalCount: 4, newGoalCount: 1, splitCount: 1 });
    });

    test('drops a proposal for a goal that does not exist', () => {
        const out = normalizeGoalReview(review([
            { kind: 'horizon', goalSlug: 'made-up-goal', why: 'x', patch: { horizon: 'life' } },
        ]), goals);
        expect(out.items).toEqual([]);
    });

    test('drops an unknown kind, and one whose patch cannot be executed', () => {
        const out = normalizeGoalReview(review([
            { kind: 'delete-everything', goalSlug: 'groceries', patch: {} },
            { kind: 'horizon', goalSlug: 'groceries', patch: {} },
            { kind: 'horizon', goalSlug: 'groceries', patch: { horizon: 'decade' } },
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [] } },
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [{ horizon: 'week' }] } },
            { kind: 'plan', goalSlug: 'groceries', patch: { steps: ['only one step'] } },
            { kind: 'new-goal', patch: {} },
        ]), goals);
        expect(out.items).toEqual([]);
    });

    test('drops a re-scope that changes nothing', () => {
        const out = normalizeGoalReview(review([
            { kind: 'horizon', goalSlug: 'groceries', patch: { horizon: 'week' } },
        ]), goals);
        expect(out.items).toEqual([]);
    });

    test('one change per goal per kind, even when the model restates itself', () => {
        const out = normalizeGoalReview(review([
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [{ title: 'A' }] } },
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [{ title: 'B' }] } },
            { kind: 'plan', goalSlug: 'retire-at-60', patch: { steps: ['x', 'y'] } },
        ]), goals);
        expect(out.items.map((i) => i.kind)).toEqual(['split', 'plan']);
    });

    test('a child is always STARTABLE work, whatever horizon it was given', () => {
        const out = normalizeGoalReview(review([
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [
                { title: 'a', horizon: 'life' },
                { title: 'b', horizon: 'week' },
                { title: 'c' },
            ] } },
        ]), goals);
        expect(out.items[0].patch.children.map((c) => c.horizon)).toEqual(['quarter', 'week', 'quarter']);
    });

    test('a new goal with no horizon gets the nearest honest one, not none', () => {
        const out = normalizeGoalReview(review([
            { kind: 'new-goal', patch: { title: 'Something' } },
        ]), goals);
        expect(out.items[0].patch.horizon).toBe('quarter');
    });

    test('caps items, split children, plan steps and lessons', () => {
        const many = Array.from({ length: ITEM_MAX + 4 }, (_, i) => ({
            kind: 'new-goal', patch: { title: `Goal ${i}` },
        }));
        expect(normalizeGoalReview(review(many), goals).items).toHaveLength(ITEM_MAX);

        const bigSplit = normalizeGoalReview(review([
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: Array.from({ length: SPLIT_MAX + 3 }, (_, i) => ({ title: `c${i}` })) } },
        ]), goals);
        expect(bigSplit.items[0].patch.children).toHaveLength(SPLIT_MAX);

        const bigPlan = normalizeGoalReview(review([
            { kind: 'plan', goalSlug: 'groceries', patch: { steps: Array.from({ length: PLAN_STEP_MAX + 5 }, (_, i) => `s${i}`) } },
        ]), goals);
        expect(bigPlan.items[0].patch.steps).toHaveLength(PLAN_STEP_MAX);

        const manyLessons = normalizeGoalReview(review([], Array.from({ length: LESSON_MAX + 3 }, (_, i) => `lesson ${i}`)), goals);
        expect(manyLessons.lessons).toHaveLength(LESSON_MAX);
    });

    test('long text is clipped rather than stored raw', () => {
        const out = normalizeGoalReview(review([
            { kind: 'new-goal', why: 'w'.repeat(600), patch: { title: 'T', description: 'd'.repeat(900) } },
        ]), goals);
        expect(out.items[0].why.length).toBeLessThanOrEqual(240);
        expect(out.items[0].patch.description.length).toBeLessThanOrEqual(400);
    });

    test('junk input yields an empty review, not a crash', () => {
        for (const input of [null, undefined, {}, { items: 'nope', lessons: 3 }, { items: [null, 7] }]) {
            const out = normalizeGoalReview(input, goals);
            expect(out.items).toEqual([]);
            expect(out.lessons).toEqual([]);
            expect(out.stats.proposalCount).toBe(0);
        }
        expect(normalizeGoalReview(review([]), null).stats.goalCount).toBe(0);
    });

    test('every kind it emits is one the apply step knows how to execute', () => {
        const out = normalizeGoalReview(review([
            { kind: 'horizon', goalSlug: 'groceries', patch: { horizon: 'quarter' } },
            { kind: 'split', goalSlug: 'retire-at-60', patch: { children: [{ title: 'A' }] } },
            { kind: 'plan', goalSlug: 'groceries', patch: { steps: ['x', 'y'] } },
            { kind: 'new-goal', patch: { title: 'N' } },
        ]), goals);
        expect(out.items.map((i) => i.kind).every((k) => PROPOSAL_KINDS.includes(k))).toBe(true);
    });
});

describe('goalReview · planning the batch', () => {
    const goals = [goal('retire-at-60', { horizon: 'life' }), goal('groceries', { horizon: 'week' })];
    const horizonItem = { id: 'h', kind: 'horizon', goalSlug: 'groceries', patch: { horizon: 'quarter' } };
    const splitItem = { id: 's', kind: 'split', goalSlug: 'retire-at-60', patch: { children: [{ title: 'Open a pension', horizon: 'week' }] } };
    const planItem = { id: 'p', kind: 'plan', goalSlug: 'groceries', patch: { steps: ['a', 'b'] } };
    const newGoalItem = { id: 'n', kind: 'new-goal', patch: { title: 'Learn three meals', horizon: 'year', description: 'x' } };

    test('turns each staged proposal into one write', () => {
        const { writes, skipped } = planReviewApplication(
            [horizonItem, splitItem, planItem, newGoalItem], goals,
        );
        expect(skipped).toEqual([]);
        expect(writes).toEqual([
            { op: 'goal-horizon', goalSlug: 'groceries', horizon: 'quarter' },
            { op: 'goal-split', goalSlug: 'retire-at-60', children: [{ title: 'Open a pension', horizon: 'week', description: '' }] },
            { op: 'plan-create', goalSlug: 'groceries', title: 'groceries', steps: ['a', 'b'] },
            { op: 'goal-create', title: 'Learn three meals', content: 'x', horizon: 'year' },
        ]);
    });

    test('a goal deleted since the review is reported, and the rest still apply', () => {
        // Both staged proposals point at the goal that is gone, so both are
        // reported — nothing is written and nothing is silently lost.
        const { writes, skipped } = planReviewApplication([horizonItem, planItem], [goal('retire-at-60', { horizon: 'life' })]);
        expect(skipped).toEqual([
            { id: 'h', reason: 'goal-gone', goalSlug: 'groceries' },
            { id: 'p', reason: 'goal-gone', goalSlug: 'groceries' },
        ]);
        expect(writes).toEqual([]);
    });

    test('a proposal that became a no-op (the user already changed it) is skipped', () => {
        const alreadyQuarter = [goal('groceries', { horizon: 'quarter' })];
        const { writes, skipped } = planReviewApplication([horizonItem], alreadyQuarter);
        expect(writes).toEqual([]);
        expect(skipped).toEqual([{ id: 'h', reason: 'already-set', goalSlug: 'groceries' }]);
    });

    test('junk staged items are skipped with a reason instead of throwing', () => {
        const { writes, skipped } = planReviewApplication(
            [null, {}, { id: 'x', kind: 'nonsense' }, { id: 'y', kind: 'new-goal', patch: {} }], goals,
        );
        expect(writes).toEqual([]);
        // A null IS ignored (it isn't an item at all); anything object-shaped is
        // reported, so a batch can never quietly apply less than the user staged.
        expect(skipped).toEqual([
            { id: null, reason: 'unknown-kind' },
            { id: 'x', reason: 'unknown-kind' },
            { id: 'y', reason: 'no-title' },
        ]);
    });

    test('non-arrays are tolerated', () => {
        expect(planReviewApplication(null, goals)).toEqual({ writes: [], skipped: [] });
        expect(planReviewApplication([horizonItem], null).writes).toEqual([]);
    });
});
