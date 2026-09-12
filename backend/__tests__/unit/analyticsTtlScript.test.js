/**
 * analyticsTtlScript.test.js — decision logic of
 * scripts/configure-analytics-ttl.js.
 *
 * The script is run by hand against the live shared `Simple` table, which is
 * exactly the situation where a wrong-but-plausible branch is expensive:
 * DynamoDB permits one TTL attribute per table, and an enable/disable cycle can
 * take ~1 hour to settle. Getting the "already enabled", "change in flight" and
 * "enabled on something else" cases right is the whole point of the script, so
 * they are pinned here rather than verified by running it for real.
 *
 * The AWS SDK is mocked (it ships ESM builds this repo's Jest config can't
 * parse); `main()` is guarded by `require.main === module` and never runs on
 * import.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
    DescribeTimeToLiveCommand: jest.fn((input) => ({ input })),
    UpdateTimeToLiveCommand: jest.fn((input) => ({ input })),
}));

const { buildTtlSpec, planTtlChange, TABLE_NAME } = require('../../scripts/configure-analytics-ttl');
const { TTL_ATTRIBUTE, retentionDays } = require('../../utils/analyticsRetention');

describe('buildTtlSpec', () => {
    it('enables TTL on the attribute the analytics writers stamp', () => {
        expect(buildTtlSpec()).toEqual({ AttributeName: 'expiresAt', Enabled: true });
        expect(buildTtlSpec().AttributeName).toBe(TTL_ATTRIBUTE);
    });
});

describe('planTtlChange', () => {
    it('does nothing when TTL is already on the right attribute', () => {
        const plan = planTtlChange({ TimeToLiveStatus: 'ENABLED', AttributeName: TTL_ATTRIBUTE });

        expect(plan.action).toBe('noop');
    });

    it('creates the TTL when none is configured', () => {
        expect(planTtlChange({}).action).toBe('create');
        expect(planTtlChange({ TimeToLiveStatus: 'DISABLED' }).action).toBe('create');
        expect(planTtlChange(undefined).action).toBe('create');
    });

    it('refuses to clobber a different attribute', () => {
        const plan = planTtlChange({ TimeToLiveStatus: 'ENABLED', AttributeName: 'someOtherTtl' });

        expect(plan.action).toBe('conflict');
        expect(plan.reason).toContain('someOtherTtl');
        expect(plan.reason).toContain('one TTL attribute per table');
    });

    it.each(['ENABLING', 'DISABLING'])('waits for an in-flight change (%s)', (status) => {
        const plan = planTtlChange({ TimeToLiveStatus: status, AttributeName: TTL_ATTRIBUTE });

        expect(plan.action).toBe('pending');
        expect(plan.reason).toContain(status);
    });

    it('names the retention window in the create reason', () => {
        expect(planTtlChange({}).reason).toContain(String(retentionDays()));
    });
});

describe('target table', () => {
    it('defaults to the shared Simple table', () => {
        // The writers in accessData/pageViewsController hardcode 'Simple', so a
        // different default here would configure a table nothing writes to.
        expect(TABLE_NAME).toBe('Simple');
    });
});
