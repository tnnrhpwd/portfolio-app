/**
 * Standalone unit tests for event-detail.js.
 * Run: `node simple-addon/server/automation/event-detail.test.js`
 *
 * These cover the rule the module exists for: an EVENT may describe a tool call,
 * but it may not carry what a person typed and it may not carry pictures. The
 * full-fidelity record belongs to the action log, not to an SSE subscriber.
 */

const {
    PII_TOOLS,
    isPiiTool,
    eventArgs,
    previewResult,
    sanitizeValue,
    clip,
    LEAF_MAX,
    RESULT_MAX,
} = require('./event-detail');

let failed = 0, total = 0;
function assert(name, cond, detail) {
    total++;
    if (cond) console.log(`  PASS  ${name}`);
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ─── PII tools: absent, not redacted ───────────────────────────────────────
assert('the PII set is the three human-content tools',
    PII_TOOLS.has('text_type') && PII_TOOLS.has('clipboard_write') && PII_TOOLS.has('audio_speak'));
assert('isPiiTool is case- and null-safe',
    isPiiTool('text_type') && !isPiiTool('TEXT_TYPE') && !isPiiTool(null) && !isPiiTool(undefined));

const typed = eventArgs('text_type', { text: 'hunter2 my password', pressEnterAfter: true });
assert('typed text never reaches an event', JSON.stringify(typed) === '{}', JSON.stringify(typed));

const pasted = eventArgs('clipboard_write', { text: 'SSN 000-00-0000' });
assert('clipboard content never reaches an event', JSON.stringify(pasted) === '{}');

const spoken = eventArgs('audio_speak', { text: 'read this aloud' });
assert('spoken text never reaches an event', JSON.stringify(spoken) === '{}');

assert('a PII tool has no result preview either', previewResult('text_type', { typed: 'secret' }) === '');

// ─── ordinary tools: enough to be useful ───────────────────────────────────
const args = eventArgs('fs_write', { path: 'a/b.js', content: 'x'.repeat(500) });
assert('ordinary args survive with keys intact', args.path === 'a/b.js', JSON.stringify(args));
assert('a long leaf is cut, not dropped', typeof args.content === 'string' && args.content.length <= LEAF_MAX,
    `len=${args.content.length}`);

assert('non-object args are reported as empty', JSON.stringify(eventArgs('shell_run', 'rm -rf /')) === '{}');
assert('null args are reported as empty', JSON.stringify(eventArgs('shell_run', null)) === '{}');

// ─── images: dropped by key, wherever they are ─────────────────────────────
const withImage = eventArgs('screen_capture', { monitor: 1, image: 'data:image/jpeg;base64,AAAA' });
assert('an image argument is dropped by key', withImage.image === undefined, JSON.stringify(withImage));

const nested = previewResult('screen_capture', { ok: true, width: 1920, frame: { image: 'A'.repeat(4000), w: 1920 } });
assert('a nested image never reaches the preview', !String(nested).includes('AAAA'), String(nested));
assert('the rest of the result still shows', String(nested).includes('1920'), String(nested));

// A name list can never be complete, so size is the backstop: anything that big
// is a payload, whatever it was called.
const blob = previewResult('fs_read', { content: 'B'.repeat(4000) });
assert('an unlabelled blob is dropped by size', !String(blob).includes('BBBB'), String(blob));
assert('common field names are NOT dropped', previewResult('x', { data: 'ok', screen: 'main', bytes: 12 }).includes('main'),
    previewResult('x', { data: 'ok', screen: 'main', bytes: 12 }));

// ─── result previews ───────────────────────────────────────────────────────
assert('a missing result has no preview', previewResult('fs_read', null) === '');
assert('an empty object has no preview', previewResult('fs_read', {}) === '');
assert('an empty array has no preview', previewResult('fs_read', []) === '');
assert('a string result is shown as-is', previewResult('shell_run', 'done') === 'done');
assert('a number result is shown', previewResult('window_list', 3) === '3');
assert('a preview is bounded', previewResult('fs_read', { body: 'y'.repeat(2000) }).length <= RESULT_MAX,
    `len=${previewResult('fs_read', { body: 'y'.repeat(2000) }).length}`);

const many = previewResult('fs_list', { files: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
assert('a long array is sampled, not dumped', String(many).includes('+3 more'), String(many));

// ─── hostile values must not throw ─────────────────────────────────────────
const cyclic = { name: 'loop' };
cyclic.self = cyclic;
let threw = null;
try { previewResult('fs_read', cyclic); } catch (e) { threw = e; }
assert('a cyclic result does not throw', threw === null, threw && threw.message);

let threw2 = null;
try { previewResult('fs_read', { big: 10n, fn: () => {} }); } catch (e) { threw2 = e; }
assert('a bigint/function leaf does not throw', threw2 === null, threw2 && threw2.message);

assert('deep nesting is summarised, not walked', sanitizeValue({ a: { b: { c: { d: { e: 1 } } } } }).a.b.c === '[object]',
    JSON.stringify(sanitizeValue({ a: { b: { c: { d: { e: 1 } } } } })));

// ─── clip ──────────────────────────────────────────────────────────────────
assert('clip collapses whitespace', clip('a\n\n  b\tc') === 'a b c');
assert('clip marks what it cut', clip('abcdef', 4).endsWith('…'));
assert('clip passes short text through', clip('abc', 10) === 'abc');
assert('clip of nothing is nothing', clip(null) === '' && clip(undefined) === '');

console.log(`\n${total - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
