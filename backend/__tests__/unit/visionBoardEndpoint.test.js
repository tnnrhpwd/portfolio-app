/**
 * visionBoardEndpoint.test.js — the wiring half of a vision board.
 *
 * The look of a board is decided in `services/visionBoard.js`, which is pure and
 * exhaustively tested (visionBoard.test.js). What that file *cannot* test is the
 * part that only exists in the endpoint, and it is the part that fails silently:
 *
 *   1. **The history read.** A new board refuses the look of the boards before it,
 *      which means the handler has to know what those looks were — from a
 *      projection-only scan of the user's `vision` items. If that scan is wrong,
 *      `_recentBoardStyles` catches its own error and returns nothing, so every
 *      board would quietly go back to being picked with no memory at all. There
 *      is no visible symptom to notice; only a test notices.
 *   2. **The attribute that makes it cheap.** The style id is lifted onto the item
 *      so that scan can read `slug, style, updatedAt` instead of every board's
 *      full record (up to 32KB of JSON each). If that write is lost, the feature
 *      still works and the read gets expensive — again, invisible.
 *   3. **Two boards in one request are two boards.** Asking for Dreams and All
 *      goals at once makes two pictures, and they must not share a look.
 *
 * The AWS SDK is mocked at the doc-client boundary, as in
 * workspaceGoalDreamFields.test.js.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockSend = jest.fn();
const mockListGoals = jest.fn();
const mockCompletion = jest.fn();
const mockGenerateImage = jest.fn();
const mockUpload = jest.fn();
const mockCanMakeApiCall = jest.fn();
const mockCheckImageCredits = jest.fn();
const mockCheckStorageCapacity = jest.fn();

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
jest.mock('../../services/workspaceGoals', () => ({
    listGoals: (...args) => mockListGoals(...args),
}));
jest.mock('../../services/bedrockService', () => ({
    createBedrockCompletion: (...args) => mockCompletion(...args),
}));
jest.mock('../../services/bedrockImageService', () => ({
    IMAGE_MODELS: { 'stability.sd3-5-large-v1:0': { provider: 'stability' } },
    getDefaultImageModelId: () => 'stability.sd3-5-large-v1:0',
    isImageGenerationConfigured: () => true,
    generateImage: (...args) => mockGenerateImage(...args),
}));
jest.mock('../../services/s3Service', () => ({
    uploadImageBuffer: (...args) => mockUpload(...args),
}));
jest.mock('../../utils/apiUsageTracker', () => ({
    canMakeApiCall: (...args) => mockCanMakeApiCall(...args),
    checkImageCredits: (...args) => mockCheckImageCredits(...args),
    trackImageUsage: jest.fn(),
    trackApiUsage: jest.fn(),
}));
jest.mock('../../utils/storageTracker', () => ({
    checkStorageCapacity: (...args) => mockCheckStorageCapacity(...args),
    invalidateStorageUsage: jest.fn(),
}));

const { generateVisionBoard } = require('../../controllers/workspaceController');
const { BOARD_STYLES } = require('../../services/visionBoard');

const USER = 'u1';
const STYLE_IDS = BOARD_STYLES.map((s) => s.id);

const GOALS = [
    { _id: 'dream-1', kind: 'goal', name: 'Retire by the coast', status: 'active', horizon: 'life', vision: '' },
    { _id: 'week-1', kind: 'goal', name: 'Ship the portfolio', status: 'active', horizon: 'week', vision: '' },
];

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/**
 * @param {object} options
 * @param {string[]} options.styles  Looks already stored, newest first
 * @param {boolean}  options.failScan Whether the history scan blows up
 * @param {object[]} options.extraItems Rows the scan returns that are not boards
 */
function arrange({ styles = [], failScan = false, extraItems = [] } = {}) {
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => {
        if (cmd.kind === 'scan') {
            if (failScan) throw new Error('ProvisionedThroughputExceededException');
            // The slug carries the timestamp (`board-<stamp>-…`), so newest is
            // generated by counting down from a fixed second.
            const rows = styles.map((style, i) => ({
                slug: `board-20260916-1000${String(10 - i).padStart(2, '0')}-all-ab`,
                style,
                updatedAt: '2026-09-16T10:00:00.000Z',
            }));
            return { Items: [...rows, ...extraItems] };
        }
        return {};
    });
    mockListGoals.mockResolvedValue(GOALS);
    mockCompletion.mockResolvedValue({
        choices: [{ message: { content: 'A board covered in overlapping pictures of a coast at golden hour, warm light.' } }],
        usage: { prompt_tokens: 500, completion_tokens: 60 },
    });
    mockGenerateImage.mockResolvedValue({
        images: [{ base64: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
        seed: 7,
    });
    mockUpload.mockResolvedValue({ s3Key: `users/${USER}/generated/x.png`, url: 'https://cdn.example/x.png', bytes: 1234 });
    mockCanMakeApiCall.mockResolvedValue({ canMake: true });
    mockCheckImageCredits.mockResolvedValue({ canMake: true });
    mockCheckStorageCapacity.mockResolvedValue({ canStore: true });
}

async function generate({ scopes = ['dream'], hint = '', ...options } = {}) {
    arrange(options);
    const res = mockRes();
    const next = jest.fn();
    await generateVisionBoard({ user: { id: USER }, body: { scopes, hint } }, res, next);
    return {
        res,
        next,
        body: res.json.mock.calls.length ? res.json.mock.calls[0][0] : null,
        boards: (res.json.mock.calls.length ? res.json.mock.calls[0][0].boards : null) || [],
    };
}

/** Every item the handler stored, by its PutCommand. */
function storedItems(kind) {
    return mockSend.mock.calls
        .map((c) => c[0])
        .filter((c) => c?.kind === 'put' && c.input?.Item?.kind === kind)
        .map((c) => c.input.Item);
}

describe('vision board endpoint · the look', () => {
    test('a board is stored with its look, in the record and on the item', async () => {
        const { boards, next } = await generate({ scopes: ['dream'] });

        expect(next).not.toHaveBeenCalled();
        expect(boards).toHaveLength(1);
        const style = boards[0].data.style;
        expect(STYLE_IDS).toContain(style.id);
        expect(style.name.length).toBeGreaterThan(0);

        // The id on the item is what next time's history read is built from, so
        // the projection can stay tiny: no `text`, no 32KB record.
        const items = storedItems('vision');
        expect(items).toHaveLength(1);
        expect(items[0].style).toBe(style.id);
    });

    test('two scopes in one request are two different boards', async () => {
        const { boards } = await generate({ scopes: ['dream', 'all'] });

        expect(boards).toHaveLength(2);
        expect(new Set(boards.map((b) => b.data.style.id)).size).toBe(2);
        // …and neither of them is the odd one out at random: both are real looks.
        for (const b of boards) expect(STYLE_IDS).toContain(b.data.style.id);
    });

    test('a look used by a recent board is not used again', async () => {
        // The complaint this feature exists for: boards coming back as the same
        // noticeboard. `riso-pop` is the look already on their last board.
        const { boards } = await generate({ styles: ['riso-pop'] });
        expect(boards[0].data.style.id).not.toBe('riso-pop');
    });

    test('the history read asks only for the style, never the whole board', async () => {
        await generate({ styles: ['riso-pop', 'neon-night'] });
        const scan = mockSend.mock.calls.map((c) => c[0]).find((c) => c.kind === 'scan');
        expect(scan).toBeTruthy();
        expect(scan.input.ProjectionExpression).toBe('slug, #style, updatedAt');
        expect(scan.input.ExpressionAttributeNames).toEqual({ '#style': 'style' });
        expect(String(scan.input.FilterExpression)).toMatch(/begins_with\(id, :prefix\)/);
    });

    test('a look the user asked for by name is the one that gets made', async () => {
        const { boards } = await generate({ hint: 'cosmic please' });
        expect(boards[0].data.style.id).toBe('cosmic');
        // The steer reaches the writer's brief too, not just the record.
        expect(mockCompletion.mock.calls[0][0][1].content).toMatch(/follow it exactly: Cosmic dream/);
    });

    test('an unreadable history is not a broken board', async () => {
        // The scan is an optimisation: a throttled read loses the "don't repeat
        // yourself" rule for one board, and must never lose the board.
        const { boards, body } = await generate({ failScan: true });
        expect(boards).toHaveLength(1);
        expect(body.failures).toEqual([]);
        expect(STYLE_IDS).toContain(boards[0].data.style.id);
    });

    test('rows without a style are skipped, not treated as a look', async () => {
        // Every board made before looks existed has no `style` attribute; the scan
        // filters for it, and anything that slips through contributes nothing.
        const { boards } = await generate({ styles: [null, undefined], extraItems: [{ slug: 'board-old' }] });
        expect(STYLE_IDS).toContain(boards[0].data.style.id);
    });
});
