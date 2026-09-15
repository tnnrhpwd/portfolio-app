/**
 * workspaceGoalHorizon.test.js — the optional `horizon` on every goal.
 *
 * A horizon is how far out a goal is aimed (`week` → `life`), and it is the ONLY
 * thing that makes a "dream" a dream: a dream is a goal with the longest horizon,
 * not a separate kind of object. Three things have to hold or the model is worse
 * than not having it at all:
 *
 *   1. **Validation** — only the four buckets, and a bad value must not be
 *      written at all (a goal in a bucket no UI knows about is invisible).
 *   2. **Carry-forward** — both goal writers Put the WHOLE item, so any field a
 *      caller doesn't send is deleted. `Plans.handleStatusChange`, the addon's
 *      `goal_update` and `save_goal` from /net all send partial bodies; without
 *      carry-forward the next status flip would erase the horizon.
 *   3. **Selection** — a `year`/`life` goal is a CONTAINER (plan it, then work
 *      the pieces), so it must never be picked while something nearer is waiting,
 *      while a goal with NO horizon must rank as actionable. Every goal written
 *      before horizons existed has no horizon, and none of them may be demoted
 *      for lacking a label.
 *
 * The AWS SDK is mocked at the doc-client boundary, as in
 * workspaceGoalDreamFields.test.js.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    DeleteCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ kind: 'scan', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ kind: 'update', input })),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/secretCrypto', () => ({
    encryptString: (value) => value,
    decryptString: (value) => value,
}));

const { upsertWorkspaceItem, getNextGoal } = require('../../controllers/workspaceController');
const { upsertGoal, isContainerHorizon } = require('../../services/workspaceGoals');

const USER = 'u1';
const HORIZONS = ['week', 'quarter', 'year', 'life'];

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** The item the final PutCommand wrote. */
function writtenItem() {
    const puts = mockSend.mock.calls.map((c) => c[0]).filter((c) => c?.kind === 'put');
    return puts.length ? puts[puts.length - 1].input.Item : null;
}

/**
 * @param {object|null} existing - The currently stored item (null → new goal)
 */
function arrange(existing = null) {
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => {
        if (cmd.kind === 'get') return existing ? { Item: existing } : {};
        return {};
    });
}

/** Rows a goal scan returns, i.e. what getNextGoal sees. */
function arrangeScan(items) {
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => {
        if (cmd.kind === 'scan') return { Items: items };
        if (cmd.kind === 'get') return {};
        return {};
    });
}

async function put(body, { existing = null, kind = 'goal', slug = 'retire-at-60' } = {}) {
    arrange(existing);
    const res = mockRes();
    const next = jest.fn();
    await upsertWorkspaceItem({ user: { id: USER }, params: { kind, slug }, body }, res, next);
    return { res, next, item: writtenItem() };
}

const goalRow = (slug, horizon, priority = 50) => ({
    id: `csimple_ws_${USER}_goal_${slug}`,
    createdAt: '2000-01-01T00:00:00.000Z',
    kind: 'goal',
    slug,
    name: slug,
    text: '',
    status: 'active',
    priority,
    ...(horizon ? { horizon } : {}),
});

async function pickNext(items) {
    arrangeScan(items);
    const res = mockRes();
    await getNextGoal({ user: { id: USER } }, res, jest.fn());
    return res.json.mock.calls[0][0].goal;
}

describe('goal horizon — validation and storage', () => {
    test('a new goal persists its horizon', async () => {
        const { res, next, item } = await put({ name: 'Retire at 60', content: 'Build the pot', horizon: 'life' });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(item.horizon).toBe('life');
    });

    test('accepts every horizon the UI offers', async () => {
        for (const horizon of HORIZONS) {
            const { res, item } = await put({ name: 'Goal', content: 'x', horizon });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(item.horizon).toBe(horizon);
        }
    });

    test('rejects an unknown horizon without writing anything', async () => {
        for (const bad of ['month', 'WEEK', 'someday', '10y', true]) {
            const { res, item } = await put({ name: 'Goal', content: 'x', horizon: bad });
            expect(res.status).toHaveBeenCalledWith(400);
            expect(item).toBeNull();
        }
    });

    test('an explicitly empty horizon clears it', async () => {
        const existing = {
            id: `csimple_ws_${USER}_goal_retire-at-60`,
            createdAt: '2000-01-01T00:00:00.000Z',
            kind: 'goal',
            slug: 'retire-at-60',
            name: 'Retire at 60',
            text: 'x',
            horizon: 'life',
        };

        const { item } = await put({ name: 'Retire at 60', content: 'x', horizon: '' }, { existing });

        // PutCommand replaces the whole item, so an omitted key really is gone.
        expect(item).not.toHaveProperty('horizon');
    });

    test('an unrelated write carries the horizon forward', async () => {
        // Exactly what a status flip sends: no horizon in the body at all.
        const existing = {
            id: `csimple_ws_${USER}_goal_retire-at-60`,
            createdAt: '2000-01-01T00:00:00.000Z',
            kind: 'goal',
            slug: 'retire-at-60',
            name: 'Retire at 60',
            text: 'x',
            status: 'active',
            horizon: 'life',
        };

        const { item } = await put({ name: 'Retire at 60', content: 'x', status: 'paused' }, { existing });

        expect(item.status).toBe('paused');
        expect(item.horizon).toBe('life');
    });

    test('the horizon rides along in the list entry, not just the full one', async () => {
        // /plans groups by it straight off the list read — one request, no
        // per-goal GET.
        const { res } = await put({ name: 'Retire at 60', content: 'x', horizon: 'year' });
        const body = res.json.mock.calls[0][0];
        expect(body.horizon).toBe('year');
    });

    test('a goal with no horizon reports null rather than a default bucket', async () => {
        const { res } = await put({ name: 'Pick up groceries', content: 'x' });
        expect(res.json.mock.calls[0][0].horizon).toBeNull();
    });
});

describe('goal horizon — which goal the agent picks up', () => {
    test('work at a nearer horizon wins over a long-term goal, whatever the priority', async () => {
        const next = await pickNext([goalRow('retire-at-60', 'life', 100), goalRow('groceries', 'week', 10)]);
        expect(next.slug).toBe('groceries');
    });

    test('a goal with no horizon counts as actionable', async () => {
        // The compatibility rule: nothing may be demoted for predating horizons.
        const next = await pickNext([goalRow('retire-at-60', 'life', 100), goalRow('legacy-goal', null, 10)]);
        expect(next.slug).toBe('legacy-goal');
    });

    test('a container goal is still returned when it is the only thing runnable', async () => {
        // It gets a planning run — see goalAgentService.buildUserPrompt.
        const next = await pickNext([goalRow('retire-at-60', 'life', 50)]);
        expect(next.slug).toBe('retire-at-60');
        expect(next.horizon).toBe('life');
    });

    test('priority still decides within the same horizon', async () => {
        const next = await pickNext([goalRow('a', 'quarter', 20), goalRow('b', 'quarter', 90)]);
        expect(next.slug).toBe('b');
    });

    test('nothing runnable still yields a null goal', async () => {
        expect(await pickNext([{ ...goalRow('done-goal', 'week'), status: 'done' }])).toBeNull();
    });
});

describe('goal horizon — the canonical goal service', () => {
    const existing = {
        id: `csimple_ws_${USER}_goal_retire-at-60`,
        createdAt: '2000-01-01T00:00:00.000Z',
        kind: 'goal',
        slug: 'retire-at-60',
        name: 'Retire at 60',
        text: 'x',
        horizon: 'life',
        tags: ['marketplace', 'retire'],
    };

    test('upsertGoal carries the horizon forward when the caller omits it', async () => {
        // save_goal from /net: a title and a description, nothing else.
        arrange(existing);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x' });
        expect(writtenItem().horizon).toBe('life');
    });

    test('upsertGoal sets and clears the horizon', async () => {
        arrange(null);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x', horizon: 'year' });
        expect(writtenItem().horizon).toBe('year');

        arrange(existing);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x', horizon: '' });
        expect(writtenItem()).not.toHaveProperty('horizon');
    });

    test('upsertGoal drops an unrecognised horizon instead of storing it', async () => {
        arrange(null);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x', horizon: 'decade' });
        expect(writtenItem()).not.toHaveProperty('horizon');
    });

    test('upsertGoal no longer wipes tags a caller never mentioned', async () => {
        arrange(existing);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x' });
        expect(writtenItem().tags).toEqual(['marketplace', 'retire']);
    });

    test('an explicit tag array still replaces the stored tags', async () => {
        arrange(existing);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x', tags: ['fresh'] });
        expect(writtenItem().tags).toEqual(['fresh']);

        arrange(existing);
        await upsertGoal(USER, { name: 'Retire at 60', content: 'x', tags: [] });
        expect(writtenItem()).not.toHaveProperty('tags');
    });

    test('isContainerHorizon splits the vocabulary where the agent needs it to', () => {
        expect(isContainerHorizon('week')).toBe(false);
        expect(isContainerHorizon('quarter')).toBe(false);
        // Unset is NOT a container: "no claim" must behave like plain work.
        expect(isContainerHorizon(null)).toBe(false);
        expect(isContainerHorizon(undefined)).toBe(false);
        expect(isContainerHorizon('year')).toBe(true);
        expect(isContainerHorizon('life')).toBe(true);
    });
});
