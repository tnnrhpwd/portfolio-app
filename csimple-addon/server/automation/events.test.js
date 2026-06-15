/**
 * Standalone unit tests for the automation event bus.
 *
 * Run with: `node csimple-addon/server/automation/events.test.js`
 * Exit code 0 on success, 1 on first failure.
 */

const events = require('./events');

let failed = 0, total = 0;
function assert(name, cond, detail) {
    total++;
    if (cond) console.log(`  PASS  ${name}`);
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1. publish() returns event with ts + seq.
{
    const ev = events.publish('test.basic', { foo: 1 });
    assert('publish returns event', ev && ev.type === 'test.basic' && ev.foo === 1);
    assert('publish fills ts', typeof ev.ts === 'number' && ev.ts > 0);
    assert('publish fills seq', typeof ev.seq === 'number' && ev.seq > 0);
}

// 2. subscribe receives subsequent events; unsubscribe stops them.
{
    const received = [];
    const unsub = events.subscribe(ev => received.push(ev));
    events.publish('test.sub.a', {});
    events.publish('test.sub.b', {});
    assert('subscribe receives published events', received.length >= 2);
    assert('subscribe gets correct types',
        received.some(e => e.type === 'test.sub.a') &&
        received.some(e => e.type === 'test.sub.b'));
    unsub();
    const before = received.length;
    events.publish('test.sub.c', {});
    assert('unsubscribe stops delivery', received.length === before);
}

// 3. recent(N) returns trailing events.
{
    for (let i = 0; i < 10; i++) events.publish('test.recent', { i });
    const last5 = events.recent(5);
    assert('recent returns at most N', last5.length === 5);
    assert('recent returns trailing events', last5[last5.length - 1].i === 9);
}

// 4. recent with sinceSeq returns only newer.
{
    const a = events.publish('test.since', { tag: 'A' });
    const b = events.publish('test.since', { tag: 'B' });
    const newer = events.recent(50, a.seq);
    assert('recent(sinceSeq) excludes <=sinceSeq', !newer.find(e => e.seq === a.seq));
    assert('recent(sinceSeq) includes >sinceSeq', newer.find(e => e.seq === b.seq));
}

// 5. Subscriber throw doesn't kill publisher.
{
    const unsub = events.subscribe(() => { throw new Error('boom'); });
    let postCalled = false;
    const unsub2 = events.subscribe(() => { postCalled = true; });
    try {
        events.publish('test.throwing', {});
        assert('post-thrower subscriber still receives', postCalled === true);
    } finally {
        unsub();
        unsub2();
    }
}

// 6. Ring buffer cap (publish > MAX_RING events; recent(MAX_RING+1) still bounded).
{
    const beforeSize = events.size();
    for (let i = 0; i < 600; i++) events.publish('test.ringcap', { i });
    const ringSize = events.size();
    assert('ring size capped at 500', ringSize === 500, `actual=${ringSize}`);
    // The oldest of the 600 should be gone.
    const allRingcap = events.recent(500).filter(e => e.type === 'test.ringcap');
    assert('oldest events evicted', allRingcap[0].i !== 0,
        `expected first.i > 0, got ${allRingcap[0]?.i}`);
}

console.log('');
if (failed === 0) {
    console.log(`events.test: ${total}/${total} PASS`);
    process.exit(0);
} else {
    console.log(`events.test: ${failed}/${total} FAILED`);
    process.exit(1);
}
