/**
 * goalMap.test.js — the /plans Map view's normaliser (backend/services/goalMap.js).
 *
 * The model's answer is not trusted, so each rule the prompt asks for has a test
 * here that breaks it: an invented slug, a duplicate, a self-dependency, a
 * category that was never declared, more categories than fit, and the case that
 * matters most — a goal the model simply forgot.
 */

const {
    CATEGORY_MAX,
    DEPENDS_MAX,
    FALLBACK_CATEGORY,
    buildGoalMapPrompt,
    goalMapStats,
    normalizeGoalMap,
    selectGoalsForMap,
} = require('../../services/goalMap');

const goal = (slug, over = {}) => ({
    slug,
    name: over.name || slug,
    status: over.status || 'active',
    priority: typeof over.priority === 'number' ? over.priority : 50,
    updatedAt: over.updatedAt || '2026-09-01T00:00:00.000Z',
    vision: over.vision || null,
    content: over.content || null,
    targetDate: over.targetDate || null,
});

describe('goalMap.selectGoalsForMap', () => {
    test('keeps live work and reports the tail it dropped', () => {
        const goals = [
            goal('a', { status: 'done' }),
            goal('b', { status: 'active' }),
            goal('c', { status: 'blocked' }),
            goal('d', { status: 'paused' }),
            goal('e', { status: 'done' }),
        ];
        const picked = selectGoalsForMap(goals, { max: 3 });
        expect(picked.goals.map((g) => g.slug)).toEqual(['b', 'c', 'd']);
        expect(picked.total).toBe(5);
        expect(picked.truncated).toBe(2);

        expect(selectGoalsForMap(goals).goals).toHaveLength(5);
        expect(selectGoalsForMap(null).goals).toEqual([]);
    });

    test('orders by status, then priority, then recency', () => {
        const goals = [
            goal('low', { status: 'active', priority: 10, updatedAt: '2026-09-09T00:00:00.000Z' }),
            goal('high', { status: 'active', priority: 90, updatedAt: '2026-09-01T00:00:00.000Z' }),
            goal('newer', { status: 'active', priority: 90, updatedAt: '2026-09-10T00:00:00.000Z' }),
            goal('done', { status: 'done', priority: 100 }),
        ];
        expect(selectGoalsForMap(goals).goals.map((g) => g.slug)).toEqual(['newer', 'high', 'low', 'done']);
    });
});

describe('goalMap.buildGoalMapPrompt', () => {
    test('carries the schema, the rules and one line per goal', () => {
        const prompt = buildGoalMapPrompt([
            goal('build-site', { name: 'Build the site', status: 'active', vision: 'Ship by spring' }),
            goal('learn-piano', { name: 'Learn piano', status: 'done' }),
        ]);
        expect(prompt).toContain('Return ONLY this JSON shape');
        expect(prompt).toContain('"dependsOn"');
        expect(prompt).toContain('Goals (2):');
        expect(prompt).toContain('build-site');
        expect(prompt).toContain('"Build the site"');
        expect(prompt).toContain('vision: Ship by spring');
        // The slug is the contract between the prompt and the normaliser, so it
        // has to be in the line, not only in the name.
        expect(prompt).toContain('- learn-piano | "Learn piano"');
    });
});

describe('goalMap.normalizeGoalMap', () => {
    const goals = [
        goal('build-site'),
        goal('write-copy'),
        goal('learn-piano'),
        goal('buy-milk'),
    ];

    test('keeps a well-formed answer as it came', () => {
        const map = normalizeGoalMap({
            categories: [
                { id: 'web', label: 'Web development' },
                { id: 'music', label: 'Music' },
                { id: 'life', label: 'Life admin' },
            ],
            nodes: [
                { slug: 'build-site', category: 'web', order: 1 },
                { slug: 'write-copy', category: 'web', order: 2, dependsOn: ['build-site'] },
                { slug: 'learn-piano', category: 'music', order: 1 },
                { slug: 'buy-milk', category: 'life', order: 1 },
            ],
        }, goals);

        expect(map.categories.map((c) => c.id)).toEqual(['web', 'music', 'life']);
        expect(map.nodes.map((n) => n.slug)).toEqual(['build-site', 'write-copy', 'learn-piano', 'buy-milk']);
        expect(map.nodes[1].dependsOn).toEqual(['build-site']);
        expect(map.stats).toMatchObject({ goalCount: 4, mappedCount: 4, categoryCount: 3, edgeCount: 1 });
        expect(map.categories.some((c) => c.id === FALLBACK_CATEGORY.id)).toBe(false);
    });

    test('drops an invented slug and an edge to it', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [
                { slug: 'build-site', category: 'web', order: 1, dependsOn: ['a-goal-that-does-not-exist'] },
                { slug: 'hallucinated-goal', category: 'web', order: 2 },
            ],
        }, [goal('build-site')]);

        expect(map.nodes.map((n) => n.slug)).toEqual(['build-site']);
        expect(map.nodes[0].dependsOn).toEqual([]);
    });

    test('a goal the model forgot is appended rather than lost', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [{ slug: 'build-site', category: 'web', order: 1 }],
        }, [goal('build-site'), goal('learn-piano'), goal('buy-milk')]);

        expect(map.nodes.map((n) => n.slug)).toEqual(['build-site', 'learn-piano', 'buy-milk']);
        expect(map.nodes.filter((n) => n.category === FALLBACK_CATEGORY.id)).toHaveLength(2);
        expect(map.stats.appendedCount).toBe(2);
        // "Other" is always the LAST lane, so the model's own order survives.
        expect(map.categories[map.categories.length - 1].id).toBe(FALLBACK_CATEGORY.id);
    });

    test('a repeated slug is placed once, at its first position', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [
                { slug: 'build-site', category: 'web', order: 2 },
                { slug: 'build-site', category: 'web', order: 5 },
            ],
        }, [goal('build-site')]);

        expect(map.nodes).toHaveLength(1);
        expect(map.nodes[0].order).toBe(2);
    });

    test('self-dependencies, duplicates and unknown prerequisites are removed', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [{
                slug: 'build-site',
                category: 'web',
                order: 1,
                dependsOn: ['build-site', 'write-copy', 'write-copy', 'nope'],
            }, { slug: 'write-copy', category: 'web', order: 2 }],
        }, [goal('build-site'), goal('write-copy')]);

        const node = map.nodes.find((n) => n.slug === 'build-site');
        expect(node.dependsOn).toEqual(['write-copy']);
    });

    test('caps prerequisites per goal', () => {
        const many = ['a', 'b', 'c', 'd'].map((slug) => goal(slug));
        const map = normalizeGoalMap({
            categories: [{ id: 'x', label: 'X' }],
            nodes: [
                { slug: 'a', category: 'x', order: 1 },
                { slug: 'b', category: 'x', order: 2 },
                { slug: 'c', category: 'x', order: 3 },
                { slug: 'd', category: 'x', order: 4, dependsOn: ['a', 'b', 'c'] },
            ],
        }, many);
        expect(map.nodes.find((n) => n.slug === 'd').dependsOn).toHaveLength(DEPENDS_MAX);
    });

    test('a category used but never declared is derived from its id', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [
                { slug: 'build-site', category: 'web', order: 1 },
                { slug: 'learn-piano', category: 'music', order: 1 },
            ],
        }, [goal('build-site'), goal('learn-piano')]);

        expect(map.categories.map((c) => c.id)).toEqual(['web', 'music']);
        // Its label falls back to the id rather than inventing a prettier name.
        expect(map.categories[1].label).toBe('music');
    });

    test('more categories than fit fold into the catch-all', () => {
        const goalsFor = Array.from({ length: CATEGORY_MAX + 2 }, (_, i) => goal(`g${i}`));
        const map = normalizeGoalMap({
            categories: goalsFor.map((g, i) => ({ id: `c${i}`, label: `C${i}` })),
            nodes: goalsFor.map((g, i) => ({ slug: g.slug, category: `c${i}`, order: 1 })),
        }, goalsFor);

        // The cap bounds the model's OWN categories; the catch-all is added on top.
        expect(map.categories).toHaveLength(CATEGORY_MAX + 1);
        expect(map.categories[CATEGORY_MAX].id).toBe(FALLBACK_CATEGORY.id);
        const folded = map.nodes.filter((n) => n.category === FALLBACK_CATEGORY.id);
        expect(folded).toHaveLength(2);
    });

    test('survives a model that answered with prose, nulls or nothing', () => {
        for (const raw of [null, undefined, {}, { nodes: 'nope' }, { categories: [null, 7] }]) {
            const map = normalizeGoalMap(raw, [goal('build-site')]);
            // Every goal still lands somewhere: the fallback is the floor.
            expect(map.nodes.map((n) => n.slug)).toEqual(['build-site']);
            expect(map.categories.map((c) => c.id)).toEqual([FALLBACK_CATEGORY.id]);
        }
        expect(normalizeGoalMap({}, []).nodes).toEqual([]);
    });

    test('ignores malformed categories and truncates a long label', () => {
        const map = normalizeGoalMap({
            categories: [
                { id: 'NOT A SLUG', label: 'A very long category label that should be trimmed' },
                { label: '' },
                { id: 'web', label: 'Web' },
            ],
            nodes: [{ slug: 'build-site', category: 'web', order: 1 }],
        }, [goal('build-site')]);

        // The unusable entry is skipped, and every id that survives is slug-shaped
        // (ids travel through URLs, class names and `dependsOn` strings).
        expect(map.categories).toHaveLength(2);
        expect(map.categories.map((c) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.id))).toEqual([true, true]);
        expect(map.categories.map((c) => c.id)).toContain('web');
        expect(map.categories.every((c) => c.label.length <= 28)).toBe(true);
    });

    test('a goal with an unusable slug is not in the map at all', () => {
        const map = normalizeGoalMap({
            categories: [{ id: 'web', label: 'Web' }],
            nodes: [{ slug: 'build-site', category: 'web', order: 1 }],
        }, [goal('build-site'), { slug: 'Not A Slug', name: 'broken' }, null]);

        expect(map.nodes.map((n) => n.slug)).toEqual(['build-site']);
        expect(map.stats.goalCount).toBe(1);
    });
});

describe('goalMap.goalMapStats', () => {
    test('reads the stats off a map, and returns zeros for nothing', () => {
        const map = normalizeGoalMap({}, [goal('a')]);
        expect(goalMapStats(map)).toEqual(map.stats);
        expect(goalMapStats(null)).toMatchObject({ goalCount: 0, mappedCount: 0 });
    });
});
