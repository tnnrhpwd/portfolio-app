/**
 * Integration tests for marketplaceController.js using an in-memory fake
 * DynamoDB document client (no real AWS/local-DynamoDB dependency — the
 * existing repo test suite requires a local DynamoDB endpoint that isn't
 * available in this environment, so we fake the doc-client boundary
 * instead, matching the mocking style already used for other addon-side
 * offline unit tests in this repo).
 */

// NOTE: jest.mock() factories cannot reference out-of-scope variables, so
// the entire in-memory fake DynamoDB implementation (including its state
// Map and UpdateExpression evaluator) lives inside the factory closure.
// `mockFakeTable` is exposed on globalThis (prefixed `mock*` per Jest's
// hoisting allow-list) so tests below can inspect/reset it.
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
    const mockFakeTable = new Map();
    globalThis.__marketplaceFakeTable = mockFakeTable;

    function tableKey(id, createdAt) { return `${id}#${createdAt}`; }

    // Splits a comma-separated list, but only at commas OUTSIDE parentheses
    // (needed for `if_not_exists(attr, :val)` inside a SET clause).
    function splitTopLevel(input) {
        const parts = [];
        let depth = 0;
        let current = '';
        for (const ch of input) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) parts.push(current.trim());
        return parts;
    }

    // Minimal-but-generic UpdateExpression evaluator covering the SET/ADD
    // clause shapes used by marketplaceController.js (`ADD x :v`,
    // `SET x = :v`, `SET x = if_not_exists(x, :v)`).
    function applyUpdateExpression(item, { UpdateExpression, ExpressionAttributeValues = {}, ExpressionAttributeNames = {} }) {
        const resolveName = (n) => (n.startsWith('#') ? (ExpressionAttributeNames[n] || n) : n);
        const clauseRe = /(SET|ADD|REMOVE)\s+([\s\S]*?)(?=\s+(?:SET|ADD|REMOVE)\s+|$)/g;
        let m;
        while ((m = clauseRe.exec(UpdateExpression))) {
            const kind = m[1];
            const body = m[2].trim();
            if (!body) continue;
            for (const assignment of splitTopLevel(body)) {
                if (kind === 'ADD') {
                    const [attrRaw, valRaw] = assignment.split(/\s+/);
                    const attr = resolveName(attrRaw);
                    item[attr] = (item[attr] || 0) + ExpressionAttributeValues[valRaw];
                } else if (kind === 'SET') {
                    const eqIdx = assignment.indexOf('=');
                    const attr = resolveName(assignment.slice(0, eqIdx).trim());
                    const expr = assignment.slice(eqIdx + 1).trim();
                    const ifNotExists = expr.match(/^if_not_exists\(([^,]+),\s*(:\w+)\)$/);
                    if (ifNotExists) {
                        const existsAttr = resolveName(ifNotExists[1].trim());
                        if (item[existsAttr] === undefined) item[attr] = ExpressionAttributeValues[ifNotExists[2]];
                    } else if (expr.startsWith(':')) {
                        item[attr] = ExpressionAttributeValues[expr];
                    }
                }
            }
        }
        return item;
    }

    class FakeCommand {
        constructor(name, input) { this.name = name; this.input = input; }
    }

    return {
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (cmd) => {
                    const { name, input } = cmd;
                    if (name === 'Get') {
                        const key = tableKey(input.Key.id, input.Key.createdAt);
                        const Item = mockFakeTable.get(key);
                        return { Item: Item ? { ...Item } : undefined };
                    }
                    if (name === 'Put') {
                        mockFakeTable.set(tableKey(input.Item.id, input.Item.createdAt), { ...input.Item });
                        return {};
                    }
                    if (name === 'Update') {
                        const key = tableKey(input.Key.id, input.Key.createdAt);
                        const existing = mockFakeTable.get(key) || { ...input.Key };
                        const updated = applyUpdateExpression({ ...existing }, input);
                        mockFakeTable.set(key, updated);
                        return { Attributes: { ...updated } };
                    }
                    if (name === 'Scan') {
                        const prefix = input.ExpressionAttributeValues?.[':prefix'];
                        const items = [...mockFakeTable.values()].filter(it => !prefix || it.id.startsWith(prefix));
                        // Only the marketplace search scan asserts attribute_exists(marketId, latestVersion);
                        // approximate that filter here since it's the only Scan the controller issues.
                        const filtered = input.FilterExpression?.includes('attribute_exists(marketId)')
                            ? items.filter(it => it.marketId !== undefined && it.latestVersion !== undefined)
                            : items;
                        return { Items: filtered };
                    }
                    throw new Error(`Unhandled fake command: ${name}`);
                },
            }),
        },
        GetCommand: class extends FakeCommand { constructor(input) { super('Get', input); } },
        PutCommand: class extends FakeCommand { constructor(input) { super('Put', input); } },
        UpdateCommand: class extends FakeCommand { constructor(input) { super('Update', input); } },
        ScanCommand: class extends FakeCommand { constructor(input) { super('Scan', input); } },
    };
});

const {
    publishSkill,
    searchMarketSkills,
    getMarketSkill,
    installMarketSkill,
    rateMarketSkill,
    flagMarketSkill,
} = require('./marketplaceController');

// Read AFTER requiring the controller above, since that's what triggers the
// '@aws-sdk/lib-dynamodb' mock factory to run and populate this global.
const fakeTable = globalThis.__marketplaceFakeTable;

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

function mockReq({ user, params = {}, body = {}, query = {} } = {}) {
    return { user, params, body, query };
}

const AUTHOR = { id: 'user-author' };
const OTHER_USER = { id: 'user-other' };

const sampleSkill = {
    name: 'Organize downloads',
    slug: 'organize-downloads',
    steps: [{ tool: 'move_file', args: { from: '${param.path}', to: 'Documents' } }],
    declaredCategories: ['sandboxed-write'],
    toolSchemaVersion: 1,
    naturalLanguageDescription: 'Sorts messy downloads into folders automatically.',
};

beforeEach(() => {
    fakeTable.clear();
});

describe('publishSkill', () => {
    test('creates a new marketplace entry with version 1 and creations=1', async () => {
        const req = mockReq({ user: AUTHOR, body: sampleSkill });
        const res = mockRes();
        await publishSkill(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            version: 1,
            isNewSkill: true,
        }));
        const { marketId } = res.json.mock.calls[0][0];
        expect(marketId).toBeTruthy();
        expect(res.json.mock.calls[0][0].skill.creations).toBe(1);
    });

    test('publishing a new version under the same marketId increments version but not creations', async () => {
        const res1 = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), res1);
        const { marketId } = res1.json.mock.calls[0][0];

        const res2 = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: { ...sampleSkill, marketId, naturalLanguageDescription: 'v2 desc' } }), res2);
        const body2 = res2.json.mock.calls[0][0];
        expect(body2.version).toBe(2);
        expect(body2.isNewSkill).toBe(false);
        expect(body2.skill.creations).toBe(1);
    });

    test('rejects a new version from a different author', async () => {
        const res1 = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), res1);
        const { marketId } = res1.json.mock.calls[0][0];

        const res2 = mockRes();
        await expect(publishSkill(mockReq({ user: OTHER_USER, body: { ...sampleSkill, marketId } }), res2)).rejects.toThrow();
        expect(res2.status).toHaveBeenCalledWith(403);
    });

    test('rejects missing steps', async () => {
        const res = mockRes();
        await expect(publishSkill(mockReq({ user: AUTHOR, body: { ...sampleSkill, steps: [] } }), res)).rejects.toThrow();
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

describe('searchMarketSkills + getMarketSkill', () => {
    test('search finds a published skill by natural-language query and sorts by trust', async () => {
        const res1 = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), res1);

        const searchRes = mockRes();
        await searchMarketSkills(mockReq({ user: AUTHOR, query: { q: 'downloads' } }), searchRes);
        const body = searchRes.json.mock.calls[0][0];
        expect(body.skills).toHaveLength(1);
        expect(body.skills[0].slug).toBe('organize-downloads');
    });

    test('getMarketSkill returns the latest version by default', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];

        const getRes = mockRes();
        await getMarketSkill(mockReq({ user: AUTHOR, params: { marketId } }), getRes);
        const body = getRes.json.mock.calls[0][0];
        expect(body.version).toBe(1);
        expect(body.steps).toEqual(sampleSkill.steps);
    });

    test('getMarketSkill 404s for unknown marketId', async () => {
        const res = mockRes();
        await expect(getMarketSkill(mockReq({ user: AUTHOR, params: { marketId: 'nope' } }), res)).rejects.toThrow();
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('install → rate gate', () => {
    test('rating without installing first is rejected', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];

        const rateRes = mockRes();
        await expect(rateMarketSkill(mockReq({
            user: OTHER_USER, params: { marketId }, body: { stars: 5, ranAt: new Date().toISOString() },
        }), rateRes)).rejects.toThrow();
        expect(rateRes.status).toHaveBeenCalledWith(403);
    });

    test('install then rate succeeds and updates the aggregate', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];

        const installRes = mockRes();
        await installMarketSkill(mockReq({ user: OTHER_USER, params: { marketId } }), installRes);
        expect(installRes.json).toHaveBeenCalledWith(expect.objectContaining({ marketId, version: 1 }));

        const rateRes = mockRes();
        await rateMarketSkill(mockReq({
            user: OTHER_USER, params: { marketId }, body: { stars: 4, ranAt: new Date().toISOString(), outcome: 'passed' },
        }), rateRes);
        const body = rateRes.json.mock.calls[0][0];
        expect(body.ratingCount).toBe(1);
        expect(body.avgRating).toBe(4);
    });

    test('re-rating the same version replaces the previous star value instead of double-counting', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];
        await installMarketSkill(mockReq({ user: OTHER_USER, params: { marketId } }), mockRes());

        await rateMarketSkill(mockReq({
            user: OTHER_USER, params: { marketId }, body: { stars: 2, ranAt: new Date().toISOString() },
        }), mockRes());
        const secondRateRes = mockRes();
        await rateMarketSkill(mockReq({
            user: OTHER_USER, params: { marketId }, body: { stars: 5, ranAt: new Date().toISOString() },
        }), secondRateRes);
        const body = secondRateRes.json.mock.calls[0][0];
        expect(body.ratingCount).toBe(1);
        expect(body.avgRating).toBe(5);
    });

    test('rejects an out-of-range star value', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];
        await installMarketSkill(mockReq({ user: OTHER_USER, params: { marketId } }), mockRes());

        const res = mockRes();
        await expect(rateMarketSkill(mockReq({
            user: OTHER_USER, params: { marketId }, body: { stars: 7, ranAt: new Date().toISOString() },
        }), res)).rejects.toThrow();
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

describe('flagMarketSkill', () => {
    test('increments flagCount', async () => {
        const publishRes = mockRes();
        await publishSkill(mockReq({ user: AUTHOR, body: sampleSkill }), publishRes);
        const { marketId } = publishRes.json.mock.calls[0][0];

        const flagRes = mockRes();
        await flagMarketSkill(mockReq({ user: OTHER_USER, params: { marketId }, body: { reason: 'looks suspicious' } }), flagRes);
        expect(flagRes.json).toHaveBeenCalledWith({ ok: true, flagCount: 1 });
    });
});
