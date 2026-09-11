/**
 * profileController.test.js — the endpoint that lets a user update their own
 * profile (profile name, email, profile picture).
 *
 * Two things matter most here and are easy to get wrong:
 *   1. The pipe-delimited `text` blob must be rewritten *segment-wise* so the
 *      password hash, Birth and stripeid survive (rewriting the blob wholesale
 *      would lock the user out).
 *   2. The public guest account must not be editable by whoever happens to be
 *      signed in to it.
 *
 * DynamoDB is mocked: the real @aws-sdk/client-dynamodb ships an ESM build this
 * repo's Jest config can't parse (same pre-existing issue as guestLogin.test.js).
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ __type: 'Get', input })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ __type: 'Scan', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ __type: 'Put', input })),
}));

jest.mock('../../utils/accessData.js', () => ({ checkIP: jest.fn().mockResolvedValue() }));

const mockInvalidateUserCache = jest.fn();
jest.mock('../../middleware/authMiddleware.js', () => ({
    invalidateUserCache: (...args) => mockInvalidateUserCache(...args),
}));

const { GUEST_EMAIL } = require('../../constants/guestAccount.js');
const { updateProfile } = require('../../controllers/profileController.js');

const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQR';
const CREATED_AT = '2020-01-01T00:00:00.000Z';
const USER_ID = 'user-1';

const baseText = `Nickname:Old Name|Email:old@example.com|Password:${PASSWORD_HASH}|Birth:${CREATED_AT}|stripeid:cus_123`;

const buildItem = (overrides = {}) => ({
    id: USER_ID,
    text: baseText,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
});

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** Wire the mocked client: GetItem returns `item`, Scan returns `scanItems`. */
function primeDynamo({ item = buildItem(), scanItems = [] } = {}) {
    mockSend.mockImplementation(async (command) => {
        if (command.__type === 'Get') return { Item: item };
        if (command.__type === 'Scan') return { Items: scanItems };
        return {};
    });
}

/** The most recent PutCommand input (i.e. the row we tried to persist). */
function lastPut() {
    const put = mockSend.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd.__type === 'Put').pop();
    return put?.input?.Item;
}

describe('updateProfile', () => {
    beforeEach(() => {
        mockSend.mockReset();
        mockInvalidateUserCache.mockReset();
    });

    it('rewrites only the changed blob segment, preserving the password hash', async () => {
        primeDynamo();

        const req = {
            user: { id: USER_ID, createdAt: CREATED_AT, text: baseText.replace(PASSWORD_HASH, '[redacted]') },
            body: { nickname: 'New Name' },
        };
        const res = mockRes();

        await updateProfile(req, res);

        const item = lastPut();
        expect(item.text).toBe(
            `Nickname:New Name|Email:old@example.com|Password:${PASSWORD_HASH}|Birth:${CREATED_AT}|stripeid:cus_123`,
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            profile: expect.objectContaining({ nickname: 'New Name', email: 'old@example.com' }),
        }));
        expect(mockInvalidateUserCache).toHaveBeenCalledWith(USER_ID);
    });

    it('preserves fields appended after stripeid (e.g. the admin Special flag)', async () => {
        primeDynamo({ item: buildItem({ text: `${baseText}|Special:true` }) });

        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { nickname: 'Renamed' } };
        await updateProfile(req, mockRes());

        expect(lastPut().text).toBe(
            `Nickname:Renamed|Email:old@example.com|Password:${PASSWORD_HASH}|Birth:${CREATED_AT}|stripeid:cus_123|Special:true`,
        );
    });

    it('stores a valid image data URL and can clear it again', async () => {
        const picture = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
        primeDynamo();

        await updateProfile(
            { user: { id: USER_ID, createdAt: CREATED_AT }, body: { profilePicture: picture } },
            mockRes(),
        );
        expect(lastPut().profilePicture).toBe(picture);

        mockSend.mockClear();
        await updateProfile(
            { user: { id: USER_ID, createdAt: CREATED_AT }, body: { profilePicture: null } },
            mockRes(),
        );
        expect(lastPut().profilePicture).toBeNull();
    });

    it('rejects a picture that is not an allowed image data URL', async () => {
        primeDynamo();
        const req = {
            user: { id: USER_ID, createdAt: CREATED_AT },
            body: { profilePicture: 'data:text/html;base64,PHNjcmlwdD4=' },
        };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/PNG, JPEG, or WebP/);
    });

    it('rejects an over-long payload before it can blow the DynamoDB item limit', async () => {
        primeDynamo();
        const huge = `data:image/jpeg;base64,${'A'.repeat(250001)}`;
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { profilePicture: huge } };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/under 250 KB/);
    });

    it('rejects an invalid profile name', async () => {
        primeDynamo();
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { nickname: 'x' } };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/Profile name must be/);
    });

    it('rejects a malformed email address', async () => {
        primeDynamo();
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { email: 'not-an-email' } };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/valid email/);
    });

    it('refuses to modify the shared public guest account', async () => {
        primeDynamo({
            item: buildItem({ text: `Nickname:Guest User|Email:${GUEST_EMAIL}|Password:${PASSWORD_HASH}|Birth:${CREATED_AT}|stripeid:guest` }),
        });
        const req = { user: { id: 'guest-id', createdAt: CREATED_AT }, body: { nickname: 'Hacked' } };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/guest account cannot be modified/);
        expect(mockSend.mock.calls.some(([cmd]) => cmd.__type === 'Put')).toBe(false);
    });

    it('rejects a nickname already used by another account', async () => {
        primeDynamo({
            scanItems: [buildItem({ id: 'other-user', text: 'Nickname:Taken|Email:other@example.com|Password:h|Birth:x|stripeid:' })],
        });
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { nickname: 'Taken' } };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/already taken/);
    });

    it('ignores the caller\'s own row during the duplicate check', async () => {
        primeDynamo({ scanItems: [buildItem()] }); // same id as the caller
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: { nickname: 'Same Name' } };

        await updateProfile(req, mockRes());

        expect(lastPut().text).toContain('Nickname:Same Name');
    });

    it('rejects an empty update instead of writing a no-op row', async () => {
        primeDynamo();
        const req = { user: { id: USER_ID, createdAt: CREATED_AT }, body: {} };

        await expect(updateProfile(req, mockRes())).rejects.toThrow(/Nothing to update/);
        expect(mockSend).not.toHaveBeenCalled();
    });
});
