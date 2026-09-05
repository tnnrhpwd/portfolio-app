/**
 * Unit tests for the voice device/model selection routes' input validation.
 *
 * `POST /api/voice/device` and `POST /api/voice/model` validate their input
 * BEFORE touching the AudioStreamManager (which spawns the Python/Whisper
 * pipeline on any real device/model change), so the error paths are fully
 * offline-testable against the real mountAutomation() Express app. The happy
 * path is intentionally NOT tested here — it requires a real microphone and
 * the Whisper model download.
 */
const assert = require('assert');
const { getEvalHttpBaseUrl, closeEvalHttpServer } = require('./eval/http-app');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function post(path, body) {
    const { baseUrl } = await getEvalHttpBaseUrl();
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json };
}

(async () => {
    let r = await post('/api/voice/model', { size: 'huge' });
    check('model: invalid size → 400', r.status === 400, `status=${r.status}`);

    r = await post('/api/voice/model', {});
    check('model: missing size → 400', r.status === 400, `status=${r.status}`);

    r = await post('/api/voice/device', { index: -1 });
    check('device: negative index → 400', r.status === 400, `status=${r.status}`);

    r = await post('/api/voice/device', { index: 'abc' });
    check('device: non-numeric index → 400', r.status === 400, `status=${r.status}`);

    r = await post('/api/voice/device', {});
    check('device: missing index → 400', r.status === 400, `status=${r.status}`);

    await closeEvalHttpServer();
    console.log(`\nvoice-routes.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
    console.error('  FAIL (uncaught)', e && e.message);
    closeEvalHttpServer().finally(() => process.exit(1));
});
