/**
 * ocr.test.js — screen_ocr returned "success" with nothing in it.
 *
 * ── What went wrong (measured 2026-09-19, addon v1.0.66) ─────────────────────
 * A full-screen `screen_ocr` call answered with a **char-spread object**:
 *
 *     {"ok":true,"result":{"0":"{","1":"\"","2":"t","3":"e","4":"x","5":"t", ...}}
 *
 * 136 926 keys, 1.7 MB of response, and `ok:true`. Reassembling those keys gave back
 * the OCR payload as a JSON *string*, and `JSON.parse` on it failed at byte 760:
 *
 *     Bad control character in string literal in JSON at position 760
 *     ... AT: "\u0007\nuia_f"
 *
 * A raw BEL (0x07) sitting inside a string literal. Windows PowerShell 5.1's
 * `ConvertTo-Json` escapes \b \f \n \r and the quote and backslash, but emits every
 * OTHER C0 control character raw — which is invalid JSON. OCR had read that BEL off
 * the SCREEN (a terminal that rang the bell), so any screen containing one produced
 * an unparseable payload.
 *
 * Three layers then conspired to hide it:
 *   1. `ps-runner`'s documented fallback resolves the raw stdout STRING on a parse
 *      failure — deliberately, but silently.
 *   2. `ocr.js` did `return { ...out, source }`. Spreading a string yields one object
 *      key per character, so the failure turned INTO data.
 *   3. The registry reported `ok:true`, and the agent loop truncates the result to
 *      800 chars — so the agent received `{0:'{',1:'"'...}` and no error.
 *
 * Why that is the whole ballgame for this class of task: reading a Chromium page is
 * done with `screen_ocr` (a page exposes no accessibility tree), and the page is the
 * only place "Dakota" and the message box can be seen. A silent OCR failure leaves
 * the agent with NO working way to see the screen, which is how a run turns into
 * 24 read-only steps and a stall.
 *
 * ── What is pinned here ─────────────────────────────────────────────────────
 *   1. `PS_CLEAN_TEXT` makes a payload containing BEL/ESC parse — via real
 *      PowerShell, no screen needed.
 *   2. Without it, the same payload arrives as a raw string (the mechanism, so this
 *      test cannot pass vacuously if PowerShell's escaping ever changes).
 *   3. `assertOcrPayload` REFUSES a non-object instead of spreading it.
 */

const assert = require('assert');
const { runPsJsonFile } = require('../ps-runner');
const { screenOcr, PS_CLEAN_TEXT, assertOcrPayload, buildWindowMissMessage } = require('./ocr');

let pass = 0, fail = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// BEL and ESC — the two control characters a terminal realistically puts on screen.
const BAD_STRING_PS = "$bad = 'A' + [char]7 + 'B' + [char]27 + 'C'";

test('without the sanitizer, a control character makes the JSON unparseable', async () => {
    const out = await runPsJsonFile(`$ErrorActionPreference = 'Stop'
${BAD_STRING_PS}
[pscustomobject]@{ text = $bad } | ConvertTo-Json -Compress`);
    // ps-runner resolves the raw TEXT when JSON.parse fails. That string is what
    // `{ ...out }` used to spread into one key per character.
    if (typeof out === 'object' && out !== null) {
        // PowerShell started escaping these properly — good news, and the sanitizer
        // below is now belt-and-braces rather than load-bearing.
        console.log('        (note: ConvertTo-Json escaped the control characters itself)');
        return;
    }
    assert.strictEqual(typeof out, 'string', 'expected the raw stdout string fallback');
    assert.throws(() => JSON.parse(out), /control character/i,
        'the raw stdout must be invalid JSON — that is the bug being fixed');
});

test('PS_CLEAN_TEXT makes the same payload parse, control characters gone', async () => {
    const out = await runPsJsonFile(`$ErrorActionPreference = 'Stop'
${PS_CLEAN_TEXT}
${BAD_STRING_PS}
[pscustomobject]@{ text = (Clean-Text $bad) } | ConvertTo-Json -Compress`);
    assert.strictEqual(typeof out, 'object', `expected a parsed object, got ${typeof out}`);
    assert.strictEqual(out.text, 'A B C', 'BEL and ESC must both become single spaces');
});

test('PS_CLEAN_TEXT keeps tab/newline/CR, which ConvertTo-Json escapes correctly', async () => {
    const out = await runPsJsonFile(`$ErrorActionPreference = 'Stop'
${PS_CLEAN_TEXT}
$s = 'l1' + [char]10 + 'l2' + [char]9 + 'x'
[pscustomobject]@{ text = (Clean-Text $s) } | ConvertTo-Json -Compress`);
    assert.strictEqual(typeof out, 'object');
    assert.strictEqual(out.text, 'l1\nl2\tx', 'line breaks and tabs must survive — OCR layout depends on them');
});

test('PS_CLEAN_TEXT tolerates $null', async () => {
    const out = await runPsJsonFile(`$ErrorActionPreference = 'Stop'
${PS_CLEAN_TEXT}
[pscustomobject]@{ text = (Clean-Text $null) } | ConvertTo-Json -Compress`);
    assert.strictEqual(out.text, '');
});

test('assertOcrPayload REFUSES a string rather than spreading it', () => {
    // This is the exact shape ps-runner hands over on a parse failure.
    assert.throws(() => assertOcrPayload('{"text":"File Edit View"}'), /unparseable output/);
    assert.throws(() => assertOcrPayload(null), /unparseable output/);
    assert.throws(() => assertOcrPayload(['a']), /unparseable output/);
});

test('assertOcrPayload passes a real payload through unchanged', () => {
    const payload = { text: 'hi', languageTag: 'en-US', lines: [{ text: 'hi', x: 1, y: 2 }] };
    assert.strictEqual(assertOcrPayload(payload), payload);
});

test('the refusal message names the length and says it is a bug, not an empty screen', () => {
    try {
        assertOcrPayload('x'.repeat(136926));
        throw new Error('should have thrown');
    } catch (e) {
        assert.match(e.message, /136926 chars/);
        assert.match(e.message, /bug in screen_ocr/);
        assert.match(e.message, /not an empty screen/);
    }
});

test('a `window` needle that matches nothing throws, and names what IS open', () => {
    const msg = buildWindowMissMessage('Google Messages', '"a" (x), "b" (y)');
    assert.match(msg, /no window matching "Google Messages"/);
    assert.match(msg, /"a" \(x\), "b" \(y\)/, 'the open windows must be listed — the model has to pick one');
    assert.match(msg, /Do not repeat this exact call/);
    assert.match(msg, /nothing was captured/, 'the wording must be about a capture, not about focus');
});

test('screen_ocr({ window }) against a name that cannot exist REJECTS instead of capturing', async () => {
    // Drives the real PowerShell path: resolution fails BEFORE any capture is attempted,
    // so this is safe to run anywhere and needs no window on screen.
    await assert.rejects(
        () => screenOcr.run({ window: 'zzz-no-such-window-9f13' }),
        (e) => {
            assert.match(e.message, /no window matching "zzz-no-such-window-9f13"/);
            assert.match(e.message, /Do not repeat this exact call/);
            return true;
        },
    );
});

(async () => {
    console.log('\nocr.test: screen_ocr must never report success with nothing in it');
    for (const t of tests) {
        try { await t.fn(); console.log(`  PASS  ${t.name}`); pass++; }
        catch (e) { console.error(`  FAIL  ${t.name}\n        ${e.message}`); fail++; }
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
