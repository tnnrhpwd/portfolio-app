/**
 * Test suite for fixed referer tracking functionality - Converted to Jest
 */

// Mock AWS and environment before requiring checkIP
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const mockSend = jest.fn().mockResolvedValue({});
const mockPutCommand = jest.fn((params) => ({ input: params }));

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({}))
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn(() => ({ send: mockSend }))
    },
    PutCommand: mockPutCommand,
    ScanCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    DeleteCommand: jest.fn(),
}));

jest.mock('ipinfo', () => {
    return jest.fn((ip, callback) => {
        callback(null, {
            ip: ip,
            city: 'Test City',
            region: 'Test Region',
            country: 'US'
        });
    });
});

const { checkIP } = require('../../utils/accessData');

describe('Fixed Referer Categorization', () => {
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterAll(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    beforeEach(() => {
        mockSend.mockClear();
        mockPutCommand.mockClear();
    });

    it('should categorize internal navigation correctly (not as external)', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '194.233.98.79',
                'referer': 'https://sthopwood.com/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0',
                'host': 'sthopwood.com'
            },
            method: 'GET',
            originalUrl: '/api/data/public?data=%7B%22text%22:%22Action%22%7D',
            user: { id: 'test-user-123' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'sthopwood.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:internal');
    });

    it('should detect Instagram app navigation via user agent', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '194.233.98.79',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 302.0.0.41.118',
                'host': 'sthopwood.com'
            },
            method: 'GET',
            originalUrl: '/portfolio',
            user: { id: 'test-user-456' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'sthopwood.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:social_instagram');
    });

    it('should detect Instagram link redirect via l.instagram.com', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '194.233.98.79',
                'referer': 'https://l.instagram.com/?u=https://sthopwood.com',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                'host': 'sthopwood.com'
            },
            method: 'GET',
            originalUrl: '/portfolio',
            user: { id: 'test-user-789' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'sthopwood.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:social_instagram');
    });

    it('should detect Facebook app with FBAN user agent', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '194.233.98.79',
                'user-agent': 'Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBDV/iPhone14,3]',
                'host': 'sthopwood.com'
            },
            method: 'GET',
            originalUrl: '/about',
            user: { id: 'test-user-101' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'sthopwood.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        // FBAN detection includes Instagram categorization
        expect(args.Item.text).toContain('RefererCategory:social_instagram');
    });
});
