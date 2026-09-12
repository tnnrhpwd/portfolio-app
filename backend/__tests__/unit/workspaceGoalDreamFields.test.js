/**
 * workspaceGoalDreamFields.test.js — the goal fields the Dream board lives on.
 *
 * A dream tile stores its picture and its aspiration line on the goal itself
 * (`vision`, `cover`, `targetDate`) rather than in a separate store, so two
 * things have to be true or a board silently degrades:
 *
 *   1. **Validation** — the values must be bounded strings, and the date must be
 *      the same bare `YYYY-MM-DD` the planner already parses.
 *   2. **Carry-forward** — `upsertWorkspaceItem` writes a WHOLE item with
 *      PutCommand, so any field the caller doesn't send is *deleted*. Every
 *      other writer (the addon flipping `status`, `save_goal` from /net) sends
 *      a partial body, so without carry-forward the agent would wipe a user's
 *      cover the next time it touched their goal.
 *
 * The third case is the deliberate exception: an *explicitly empty* value means
 * "clear it", because otherwise a vision line could never be removed.
 *
 * The AWS SDK is mocked at the doc-client boundary, as in
 * csimpleListPagination.test.js.
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

const { upsertWorkspaceItem } = require('../../controllers/workspaceController');

const USER = 'u1';

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

async function put(body, { existing = null, kind = 'goal', slug = 'half-marathon' } = {}) {
    arrange(existing);
    const res = mockRes();
    const next = jest.fn();
    await upsertWorkspaceItem(
        { user: { id: USER }, params: { kind, slug }, body },
        res,
        next
    );
    return { res, next, item: writtenItem() };
}

describe('goal dream-board fields', () => {
    test('a new dream persists its vision, cover and target date', async () => {
        const { res, next, item } = await put({
            name: 'Half marathon',
            content: 'Train steadily',
            vision: 'Cross the line feeling strong',
            cover: 'health',
            targetDate: '2027-04-18',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(item.vision).toBe('Cross the line feeling strong');
        expect(item.cover).toBe('health');
        expect(item.targetDate).toBe('2027-04-18');
    });

    test('an uploaded cover URL is accepted', async () => {
        const url = 'https://cdn.example.com/users/u1/generated/1_dream.jpg';
        const { item } = await put({ name: 'Dream', content: 'x', cover: url });
        expect(item.cover).toBe(url);
    });

    test('a partial update carries the dream fields forward', async () => {
        // What the addon / save_goal does: flip status, say nothing about the tile.
        const existing = {
            id: `csimple_ws_${USER}_goal_half-marathon`,
            createdAt: '2000-01-01T00:00:00.000Z',
            kind: 'goal',
            slug: 'half-marathon',
            name: 'Half marathon',
            text: 'Train steadily',
            status: 'active',
            priority: 90,
            vision: 'Cross the line feeling strong',
            cover: 'health',
            targetDate: '2027-04-18',
        };

        const { item } = await put({ name: 'Half marathon', content: 'Train steadily', status: 'done' }, { existing });

        expect(item.status).toBe('done');
        // The whole point: none of these were in the body.
        expect(item.vision).toBe('Cross the line feeling strong');
        expect(item.cover).toBe('health');
        expect(item.targetDate).toBe('2027-04-18');
    });

    test('an explicitly empty value clears the field', async () => {
        const existing = {
            id: `csimple_ws_${USER}_goal_half-marathon`,
            createdAt: '2000-01-01T00:00:00.000Z',
            kind: 'goal',
            slug: 'half-marathon',
            name: 'Half marathon',
            text: 'Train steadily',
            vision: 'Cross the line feeling strong',
            cover: 'health',
            targetDate: '2027-04-18',
        };

        const { item } = await put({ name: 'Half marathon', content: 'x', vision: '', cover: '', targetDate: '' }, { existing });

        // PutCommand replaces the whole item, so an omitted key really is gone.
        expect(item).not.toHaveProperty('vision');
        expect(item).not.toHaveProperty('cover');
        expect(item).not.toHaveProperty('targetDate');
    });

    test('a cover can be swapped without touching the vision line', async () => {
        const existing = {
            id: `csimple_ws_${USER}_goal_dream`,
            createdAt: '2000-01-01T00:00:00.000Z',
            kind: 'goal',
            slug: 'dream',
            name: 'Dream',
            text: 'x',
            vision: 'Keep this',
            cover: 'home',
        };

        const { item } = await put({ name: 'Dream', content: 'x', cover: 'money' }, { existing, slug: 'dream' });

        expect(item.cover).toBe('money');
        expect(item.vision).toBe('Keep this');
    });

    test('rejects an over-long vision or cover', async () => {
        const long = await put({ name: 'Dream', content: 'x', vision: 'v'.repeat(281) });
        expect(long.res.status).toHaveBeenCalledWith(400);
        expect(long.item).toBeNull();
        expect(long.next).toHaveBeenCalled();

        const wide = await put({ name: 'Dream', content: 'x', cover: 'c'.repeat(601) });
        expect(wide.res.status).toHaveBeenCalledWith(400);
    });

    test('rejects anything but a bare YYYY-MM-DD target date', async () => {
        for (const bad of ['18/04/2027', '2027-4-18', '2027-04-18T10:00:00Z', 'tomorrow']) {
            const { res, item } = await put({ name: 'Dream', content: 'x', targetDate: bad });
            expect(res.status).toHaveBeenCalledWith(400);
            expect(item).toBeNull();
        }
    });

    test('rejects a non-string cover', async () => {
        const { res } = await put({ name: 'Dream', content: 'x', cover: { key: 'home' } });
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('does not write dream fields onto a non-goal kind', async () => {
        const { item } = await put(
            { name: 'Note', content: 'x', vision: 'not a goal', cover: 'home' },
            { kind: 'notebook', slug: 'a-note' }
        );
        expect(item).not.toHaveProperty('vision');
        expect(item).not.toHaveProperty('cover');
    });
});
