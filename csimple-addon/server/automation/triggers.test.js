/**
 * Standalone unit tests for the trigger engine's pure pieces.
 * Run: `node csimple-addon/server/automation/triggers.test.js`
 */

const triggers = require('./triggers');
const { parseCron, _matchesNow, _globToRegex } = triggers;

let failed = 0, total = 0;
function assert(name, cond, detail) {
    total++;
    if (cond) console.log(`  PASS  ${name}`);
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ─── parseCron ───────────────────────────────────────────────────────────────
{
    const c = parseCron('0 9 * * 1-5');
    assert('parseCron: minute=0', c.minute.size === 1 && c.minute.has(0));
    assert('parseCron: hour=9', c.hour.size === 1 && c.hour.has(9));
    assert('parseCron: dom=*', c.dayOfMonth.size === 31);
    assert('parseCron: dow weekdays', c.dayOfWeek.size === 5 && c.dayOfWeek.has(1) && c.dayOfWeek.has(5));
}
{
    const c = parseCron('*/15 * * * *');
    assert('parseCron: step every 15 min', c.minute.size === 4 && c.minute.has(0) && c.minute.has(15) && c.minute.has(30) && c.minute.has(45));
}
{
    const c = parseCron('0,30 8-17 * * 1-5');
    assert('parseCron: list of mins', c.minute.size === 2 && c.minute.has(0) && c.minute.has(30));
    assert('parseCron: range of hours', c.hour.size === 10 && c.hour.has(8) && c.hour.has(17));
}
{
    let threw = false;
    try { parseCron('invalid'); } catch { threw = true; }
    assert('parseCron rejects invalid', threw);
}
{
    let threw = false;
    try { parseCron('60 * * * *'); } catch { threw = true; }
    assert('parseCron rejects out-of-range', threw);
}

// ─── _matchesNow ────────────────────────────────────────────────────────────
{
    // Monday 2024-01-01 was a Monday
    const mondayMorning9 = new Date(2024, 0, 1, 9, 0); // Y, M(0-idx), D, H, m
    const c = parseCron('0 9 * * 1-5');
    assert('matchesNow: Mon 9:00 matches weekday-9am', _matchesNow(c, mondayMorning9) === true);
    const sat = new Date(2024, 0, 6, 9, 0); // Saturday
    assert('matchesNow: Sat 9:00 does NOT match weekday-9am', _matchesNow(c, sat) === false);
    const off = new Date(2024, 0, 1, 9, 5);
    assert('matchesNow: 9:05 does NOT match minute=0', _matchesNow(c, off) === false);
}

// ─── _globToRegex ───────────────────────────────────────────────────────────
{
    const re = _globToRegex('*.pdf');
    assert('glob: report.pdf matches *.pdf', re.test('report.pdf'));
    assert('glob: report.PDF matches case-insensitively', re.test('Report.PDF'));
    assert('glob: report.txt does NOT match *.pdf', !re.test('report.txt'));
    assert('glob: nested/report.pdf does NOT match *.pdf', !re.test('nested/report.pdf'));
}
{
    const re = _globToRegex('img_???.png');
    assert('glob: ? matches single char', re.test('img_123.png'));
    assert('glob: ? does NOT match wrong-length', !re.test('img_1234.png'));
}
{
    const re = _globToRegex('*'); // catch-all
    assert('glob: * catches all', re.test('anything.zip'));
}

console.log('');
if (failed === 0) {
    console.log(`triggers.test: ${total}/${total} PASS`);
    process.exit(0);
} else {
    console.log(`triggers.test: ${failed}/${total} FAILED`);
    process.exit(1);
}
