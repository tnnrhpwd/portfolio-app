/**
 * Unit tests for the pure conversation-merge helpers exported by
 * csimpleController. These cover the cross-device sync logic added to fix
 * "conversations are not persistent across devices".
 */

// The controller constructs an AWS SDK client at import time; it doesn't make
// any network calls until a handler runs, so set placeholder creds to keep the
// constructor happy in the test environment.
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const {
  _mergeConversationLists,
  _mergeConversation,
  _mergeMessageLists,
  _unionTombstones,
} = require('../../controllers/csimpleController');

describe('conversation merge helpers', () => {
  test('mergeMessageLists unions messages by id and orders by timestamp', () => {
    const a = [
      { id: '1', role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:00.000Z' },
      { id: '2', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z' },
    ];
    const b = [
      { id: '2', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z' },
      { id: '3', role: 'user', content: 'again', timestamp: '2026-01-01T00:00:02.000Z' },
    ];
    const merged = _mergeMessageLists(a, b);
    expect(merged.map(m => m.id)).toEqual(['1', '2', '3']);
  });

  test('mergeConversation keeps newer metadata and unions messages', () => {
    const a = {
      id: '1', title: 'New Chat', createdAt: '2026-01-01T00:00:00.000Z',
      messages: [{ id: '1', role: 'user', content: 'first', timestamp: '2026-01-01T00:00:00.000Z' }],
    };
    const b = {
      id: '1', title: 'Real title', createdAt: '2026-01-01T00:00:00.000Z',
      messages: [{ id: '2', role: 'assistant', content: 'second', timestamp: '2026-01-01T00:00:01.000Z' }],
    };
    const merged = _mergeConversation(a, b);
    expect(merged.title).toBe('Real title');
    expect(merged.messages.map(m => m.content)).toEqual(['first', 'second']);
    expect(merged.updatedAt).toBeDefined();
  });

  test('mergeConversationLists unions by id and merges the shared default "New Chat"', () => {
    // Every device starts with id '1' ("New Chat"). One device has real
    // messages in it, the other has an empty placeholder — the merge must
    // keep the messages rather than letting the empty copy clobber them.
    const existing = [
      { id: '1', title: 'New Chat', createdAt: '2026-01-01T00:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'my first message', timestamp: '2026-01-01T00:00:00.000Z' }] },
    ];
    const incoming = [
      { id: '1', title: 'New Chat', createdAt: '2026-01-01T00:00:00.000Z', messages: [] },
      { id: '2', title: 'Second chat', createdAt: '2026-01-02T00:00:00.000Z', messages: [] },
    ];
    const merged = _mergeConversationLists(existing, incoming);
    expect(merged).toHaveLength(2);
    const shared = merged.find(c => c.id === '1');
    expect(shared.messages).toHaveLength(1);
    expect(shared.messages[0].content).toBe('my first message');
  });

  test('mergeConversationLists drops deletion tombstones', () => {
    const existing = [
      { id: '1', title: 'Keep', createdAt: '2026-01-01T00:00:00.000Z', messages: [] },
      { id: '2', title: 'Delete me', createdAt: '2026-01-02T00:00:00.000Z', messages: [] },
    ];
    const incoming = [{ id: '3', title: 'New', createdAt: '2026-01-03T00:00:00.000Z', messages: [] }];
    const merged = _mergeConversationLists(existing, incoming, ['2']);
    expect(merged.map(c => c.id)).toEqual(['3', '1']);
  });

  test('mergeConversationLists is deterministic and newest-first', () => {
    const incoming = [
      { id: 'a', createdAt: '2026-01-03T00:00:00.000Z', messages: [] },
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', messages: [] },
    ];
    const merged = _mergeConversationLists([], incoming);
    expect(merged.map(c => c.id)).toEqual(['a', 'b']);
  });

  test('unionTombstones unions server + client tombstones and dedupes', () => {
    expect(_unionTombstones(['1', '2'], ['2', '3'])).toEqual(['1', '2', '3']);
  });

  test('unionTombstones tolerates missing/undefined inputs', () => {
    expect(_unionTombstones(undefined, undefined)).toEqual([]);
    expect(_unionTombstones(null, ['7'])).toEqual(['7']);
    expect(_unionTombstones([7], [])).toEqual(['7']);
  });
});
