/**
 * harnessStatsEndpoint.test.js — the gate on GET /api/data/csimple/harness/stats.
 *
 * Why this endpoint is admin-only, and why that is worth a test:
 *
 * The run ring (`readRuns`) is per-user, but the routing-telemetry counters it is
 * combined with are **process-wide**. Served to a normal account, the response
 * would tell any user how much *every other user* has been doing — a leak that
 * neither source has on its own, created purely by joining them. So the 403 is the
 * feature; the numbers are incidental.
 *
 * The second property under test is that the endpoint degrades instead of failing.
 * An operator asking "how is the harness going" must get whatever is readable:
 * a store that is down, or telemetry that throws, should shrink the answer, not
 * turn it into a 500.
 *
 * `isAdminRequest` reads the ADMIN_USER_ID env var and the request's user id, so
 * these tests set both rather than mocking the middleware — the real comparison is
 * what we want to exercise.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';
process.env.ADMIN_USER_ID = 'admin-user';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
  PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
  ScanCommand: jest.fn().mockImplementation((input) => ({ kind: 'scan', input })),
}));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/secretCrypto', () => ({
  encryptString: (value) => value,
  decryptString: (value) => value,
}));

// The two sources are mocked at their module boundary: this file is about the
// gate and the join, not about re-testing harnessStats.js (15 tests) or the
// DynamoDB access in stepJournal.js.
const mockReadRuns = jest.fn();
const mockGetRoutingStats = jest.fn();
jest.mock('../../services/harness/stepJournal.js', () => ({
  readRuns: (...args) => mockReadRuns(...args),
}));
jest.mock('../../services/routingTelemetry.js', () => ({
  getRoutingStats: (...args) => mockGetRoutingStats(...args),
}));

const { getHarnessStats } = require('../../controllers/csimpleController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const RUN = {
  id: 'run-1',
  userId: 'admin-user',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:04.000Z',
  outcome: 'completed',
  rounds: 3,
  steps: [
    { id: 's1', status: 'done', plane: 'pc', tool: 'pc_status' },
    { id: 's2', status: 'denied', plane: 'pc', tool: 'pc_do', outcome: 'permission' },
  ],
  plan: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReadRuns.mockResolvedValue([RUN]);
  mockGetRoutingStats.mockReturnValue({
    total: 4,
    byIntent: { agent: 3, chat: 1 },
    toolCalls: 2,
    deniedToolCalls: 1,
    adminTurns: 0,
    recent: [],
  });
});

describe('GET /csimple/harness/stats — access', () => {
  test('a normal account is refused with 403 and gets no numbers', async () => {
    const req = { user: { id: 'someone-else' } };
    const res = mockRes();

    await expect(getHarnessStats(req, res)).rejects.toThrow(/administrator/i);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).not.toHaveBeenCalled();
    // The refusal must happen before any read: a non-admin call should not touch
    // the store or the telemetry at all.
    expect(mockReadRuns).not.toHaveBeenCalled();
    expect(mockGetRoutingStats).not.toHaveBeenCalled();
  });

  test('a missing user is refused rather than treated as anonymous-admin', async () => {
    const res = mockRes();

    await expect(getHarnessStats({}, res)).rejects.toThrow(/administrator/i);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockReadRuns).not.toHaveBeenCalled();
  });

  test('the admin gets the aggregate, keyed to their own run ring', async () => {
    const req = { user: { id: 'admin-user' } };
    const res = mockRes();

    await getHarnessStats(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReadRuns).toHaveBeenCalledWith('admin-user');

    const body = res.json.mock.calls[0][0];
    // Shape: the DURABLE half is nested under `runs` (where `runs.runs` is the
    // count), the in-process half under `telemetry` — a reader must be able to see
    // which numbers survive a restart.
    expect(body.runs.runs).toBe(1);
    expect(body.runs.byOutcome.completed).toBe(1);
    // A denied step is a failure, not a neutral status — that distinction is the
    // whole reason the taxonomy exists.
    expect(body.runs.steps.failed).toBe(1);
    expect(body.runs.byFailureKind.permission).toBe(1);
    expect(body.telemetry.turns).toBe(4);
    expect(body.generatedAt).toEqual(expect.any(String));
    // The caveat travels WITH the numbers rather than living in a doc.
    expect(body.notes.join(' ')).toMatch(/resets when the server restarts/i);
  });
});

describe('GET /csimple/harness/stats — degradation', () => {
  test('an unreadable run ring shrinks the answer instead of failing it', async () => {
    mockReadRuns.mockRejectedValue(new Error('journal unavailable'));
    const req = { user: { id: 'admin-user' } };
    const res = mockRes();

    await getHarnessStats(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.runs.runs).toBe(0);
    // The half that IS readable still reports.
    expect(body.telemetry.turns).toBe(4);
  });

  test('unreadable telemetry shrinks the answer instead of failing it', async () => {
    mockGetRoutingStats.mockImplementation(() => {
      throw new Error('no telemetry');
    });
    const req = { user: { id: 'admin-user' } };
    const res = mockRes();

    await getHarnessStats(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.runs.runs).toBe(1);
    expect(body.telemetry.turns).toBe(0);
  });
});
