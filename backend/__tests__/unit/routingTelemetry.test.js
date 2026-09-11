/**
 * routingTelemetry.test.js — unit tests for backend /net routing observability.
 */

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const {
  buildRoutingEvent,
  recordRoutingEvent,
  recordDeniedToolCall,
  recentRoutingEvents,
  getRoutingStats,
  resetRoutingStats,
} = require('../../services/routingTelemetry');

beforeEach(() => resetRoutingStats());

describe('routingTelemetry.buildRoutingEvent', () => {
  test('produces a normalized shape', () => {
    const evt = buildRoutingEvent({ intent: 'tool', toolsOffered: 12, toolsUsed: 2, latencyMs: 40.4, confidence: 0.7777 });
    expect(evt.event).toBe('routing.decision');
    expect(evt.intent).toBe('tool');
    expect(evt.toolsOffered).toBe(12);
    expect(evt.toolsUsed).toBe(2);
    expect(evt.latencyMs).toBe(40);
    expect(evt.confidence).toBe(0.778);
  });

  test('defaults safely', () => {
    const evt = buildRoutingEvent();
    expect(evt.intent).toBe('chat');
    expect(evt.isAdmin).toBe(false);
    expect(evt.toolsUsed).toBe(0);
  });
});

describe('routingTelemetry.recordRoutingEvent', () => {
  test('increments counters and keeps a bounded ring', () => {
    for (let i = 0; i < 300; i++) recordRoutingEvent(buildRoutingEvent({ intent: 'chat' }));
    recordRoutingEvent(buildRoutingEvent({ intent: 'tool', toolsUsed: 3, isAdmin: true }));
    const stats = getRoutingStats();
    expect(stats.total).toBe(301);
    expect(stats.toolCalls).toBe(3);
    expect(stats.adminTurns).toBe(1);
    expect(stats.byIntent.tool).toBe(1);
    expect(recentRoutingEvents(1000).length).toBeLessThanOrEqual(200);
  });

  test('recordDeniedToolCall increments the denied counter', () => {
    recordDeniedToolCall('repo_push', { userId: 'u1' }, 'missing capability');
    expect(getRoutingStats().deniedToolCalls).toBe(1);
  });
});
