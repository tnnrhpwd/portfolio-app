/**
 * guestLogin.test.js — self-healing behavior for the public "Login as
 * Guest" demo account in controllers/postData.js#loginUser.
 *
 * The real @aws-sdk/client-dynamodb package ships an ESM build that this
 * repo's Jest config can't parse (the same pre-existing issue documented in
 * __tests__/unit/bedrockService.test.js), so DynamoDB is mocked here.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
    PutCommand: jest.fn().mockImplementation((input) => ({ input })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

// checkIP hits network-dependent IP-geolocation/analytics helpers unrelated
// to login behavior — stub it out to keep this test isolated and offline.
jest.mock('../../utils/accessData.js', () => ({ checkIP: jest.fn().mockResolvedValue() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const { GUEST_EMAIL, GUEST_PASSWORD } = require('../../constants/guestAccount.js');
const { loginUser } = require('../../controllers/postData.js');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('loginUser — guest account self-healing', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    it('auto-creates the guest account when it does not exist in DynamoDB', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] }); // ScanCommand finds nothing

        const req = { body: { email: GUEST_EMAIL, password: GUEST_PASSWORD }, get: () => undefined };
        const res = mockRes();

        await loginUser(req, res);

        // First call is the lookup Scan, second is the auto-provisioning Put
        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(200);
        const responseData = res.json.mock.calls[0][0];
        expect(responseData.email).toBe(GUEST_EMAIL);
        expect(responseData.nickname).toBe('Guest User');
        expect(responseData.token).toBeTruthy();
    });

    it('resets the stored password when the guest record has drifted out of sync', async () => {
        const bcrypt = require('bcryptjs');
        const staleHash = await bcrypt.hash('some-other-password', await bcrypt.genSalt(10));
        const staleUser = {
            id: 'guest-id-123',
            text: `Nickname:Guest User|Email:${GUEST_EMAIL}|Password:${staleHash}|Birth:2020-01-01T00:00:00.000Z|stripeid:guest_customer_id`,
        };

        mockSend
            .mockResolvedValueOnce({ Items: [staleUser] }) // ScanCommand finds the stale record
            .mockResolvedValueOnce({}); // PutCommand resetting the password

        const req = { body: { email: GUEST_EMAIL, password: GUEST_PASSWORD }, get: () => undefined };
        const res = mockRes();

        await loginUser(req, res);

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(200);
        const responseData = res.json.mock.calls[0][0];
        expect(responseData._id).toBe('guest-id-123');
        expect(responseData.nickname).toBe('Guest User');
        expect(responseData.token).toBeTruthy();

        // The Put call should have written a fresh hash of GUEST_PASSWORD
        const putInput = mockSend.mock.calls[1][0].input;
        const newHash = putInput.Item.text.match(/\|Password:([^|]*)/)[1];
        expect(await bcrypt.compare(GUEST_PASSWORD, newHash)).toBe(true);
    });

    it('does not self-heal for a non-guest email with a wrong password', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] }); // ScanCommand finds nothing

        const req = { body: { email: 'someone@example.com', password: 'wrong' }, get: () => undefined };
        const res = mockRes();

        await expect(loginUser(req, res)).rejects.toThrow('Could not find that user.');
        expect(mockSend).toHaveBeenCalledTimes(1); // no auto-provisioning Put call
    });
});
