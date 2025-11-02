// Mock environment variables FIRST
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

// Create mock function at module level
const mockSend = jest.fn().mockResolvedValue({});
const mockPutCommand = jest.fn((params) => ({ input: params }));

// Mock AWS SDK BEFORE requiring accessData
jest.mock('@aws-sdk/client-dynamodb', () => {
    return {
        DynamoDBClient: jest.fn(() => ({}))
    };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
    return {
        DynamoDBDocumentClient: {
            from: jest.fn(() => ({
                send: mockSend
            }))
        },
        PutCommand: mockPutCommand,
        ScanCommand: jest.fn(),
        UpdateCommand: jest.fn(),
        DeleteCommand: jest.fn(),
    };
});

// Mock ipinfo BEFORE requiring accessData
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

// NOW require the module that uses these mocks
const { checkIP } = require('../../utils/accessData');

// Mock console methods to silence verbose logging during tests
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

describe('Specific Reported Issues - Integration Tests', () => {
    beforeAll(() => {
        // Silence console during tests
        console.log = jest.fn();
        console.error = jest.fn();
        console.warn = jest.fn();
    });

    afterAll(() => {
        // Restore console
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
    });

    beforeEach(() => {
        mockSend.mockClear();
        mockPutCommand.mockClear();
    });

    // Test 1: sthopwood.com navigation should be categorized as internal
    it('should correctly categorize sthopwood.com navigation as internal', async () => {
        const mockReq1 = {
            method: 'GET',
            originalUrl: '/portfolio',
            headers: {
                'x-forwarded-for': '203.0.113.1', // Non-localhost IP
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'referer': 'https://sthopwood.com/',
                'host': 'sthopwood.com'
            },
            connection: {},
            socket: {},
            get: jest.fn((header) => {
                if (header === 'host') return 'sthopwood.com';
                return null;
            })
        };
        
        await checkIP(mockReq1);
        
        expect(mockPutCommand).toHaveBeenCalled();
        expect(mockSend).toHaveBeenCalled();
        
        const putCommandArgs = mockPutCommand.mock.calls[0][0];
        expect(putCommandArgs.Item.text).toContain('RefererCategory:internal');
    });
    
    // Test 2: Instagram app with internal referer should be categorized as Instagram
    it('should correctly detect Instagram app navigation', async () => {
        const mockReq2 = {
            method: 'GET',
            originalUrl: '/portfolio',
            headers: {
                'x-forwarded-for': '203.0.113.2',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) Instagram 234.0.0.16.109',
                'referer': 'https://sthopwood.com/',
                'host': 'sthopwood.com'
            },
            connection: {},
            socket: {},
            get: jest.fn((header) => {
                if (header === 'host') return 'sthopwood.com';
                return null;
            })
        };
        
        await checkIP(mockReq2);
        
        expect(mockPutCommand).toHaveBeenCalled();
        expect(mockSend).toHaveBeenCalled();
        
        const putCommandArgs = mockPutCommand.mock.calls[0][0];
        expect(putCommandArgs.Item.text).toContain('RefererCategory:social_instagram');
    });
    
    // Test 3: Instagram link redirect should be detected
    it('should correctly detect Instagram link redirect', async () => {
        const mockReq3 = {
            method: 'GET',
            originalUrl: '/portfolio',
            headers: {
                'x-forwarded-for': '203.0.113.3',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)',
                'referer': 'https://l.instagram.com/?u=https://sthopwood.com',
                'host': 'sthopwood.com'
            },
            connection: {},
            socket: {},
            get: jest.fn((header) => {
                if (header === 'host') return 'sthopwood.com';
                return null;
            })
        };
        
        await checkIP(mockReq3);
        
        expect(mockPutCommand).toHaveBeenCalled();
        expect(mockSend).toHaveBeenCalled();
        
        const putCommandArgs = mockPutCommand.mock.calls[0][0];
        expect(putCommandArgs.Item.text).toContain('RefererCategory:social_instagram');
    });
});

