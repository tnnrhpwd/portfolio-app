/**
 * Test suite for referer tracking functionality - Converted to Jest
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

describe('Referer Tracking Functionality', () => {
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

    it('should track Google search referer', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.1',
                'referer': 'https://www.google.com/search?q=portfolio+website',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/portfolio',
            user: { id: 'test-user-123' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:search_google');
    });

    it('should track Facebook social media referer', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.2',
                'referer': 'https://www.facebook.com/posts/12345',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/about',
            user: { id: 'test-user-456' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:social_facebook');
    });

    it('should track direct access (no referer)', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.3',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/home',
            user: { id: 'test-user-789' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:direct');
    });

    it('should track internal site navigation', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.4',
                'referer': 'https://yoursite.com/home',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/contact',
            user: { id: 'test-user-101' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:internal');
    });

    it('should track GitHub external link', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.5',
                'referer': 'https://github.com/username/repository',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/projects',
            user: { id: 'test-user-202' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:development_github');
    });

    it('should track malformed referer URL', async () => {
        const request = {
            headers: {
                'x-forwarded-for': '203.0.113.6',
                'referer': 'not-a-valid-url',
                'user-agent': 'Mozilla/5.0',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/blog',
            user: { id: 'test-user-303' },
            connection: {},
            socket: {},
            get: jest.fn(() => 'yoursite.com')
        };

        await checkIP(request);
        
        expect(mockPutCommand).toHaveBeenCalled();
        const args = mockPutCommand.mock.calls[0][0];
        expect(args.Item.text).toContain('RefererCategory:malformed');
    });
});
