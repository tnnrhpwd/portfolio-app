/**
 * Unit tests for the local skill export/import routes:
 *   GET  /api/skill/export  (all + ?slug=)
 *   POST /api/skill/import  (single object | {skills:[...]} | array)
 *
 * Runs fully offline against the REAL mountAutomation() Express app (reusing
 * eval/http-app.js's singleton in-process server), with APPDATA redirected to
 * a temp dir so the on-disk skill cache is isolated from real user data. No
 * LLM/cloud round trips — the import route's workspace sync is best-effort and
 * fails fast (no token), which is exactly the signed-out path being tested.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-xio-'));

const { getEvalHttpBaseUrl, closeEvalHttpServer } = require('./eval/http-app');

// Pre-seed two skills on disk, exactly as a signed-out customer would have
// them after saving locally and restarting.
const skillDir = path.join(process.env.APPDATA, 'simple-addon', 'skills');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'alpha.json'),
    JSON.stringify({ slug: 'alpha', name: 'Alpha', steps: [{ type: 'key_tap', keys: ['a'] }] }), 'utf8');
fs.writeFileSync(path.join(skillDir, 'beta.json'),
    JSON.stringify({ slug: 'beta', name: 'Beta', steps: [{ type: 'key_tap', keys: ['b'] }] }), 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function http(method, p, body) {
    const { baseUrl } = await getEvalHttpBaseUrl();
    const res = await fetch(`${baseUrl}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json };
}

(async () => {
    // ── export all ──────────────────────────────────────────────────────────
    let r = await http('GET', '/api/skill/export');
    check('export all returns bundle format', r.status === 200 && r.json?.format === 'simple-skills-export', `status=${r.status}`);
    check('export all includes both disk skills', Array.isArray(r.json?.skills) && r.json.skills.length === 2, JSON.stringify(r.json?.skills));
    const slugs = (r.json?.skills || []).map(s => s.slug).sort();
    check('export all slugs are alpha+beta', slugs.join(',') === 'alpha,beta', slugs.join(','));

    // ── export single ───────────────────────────────────────────────────────
    r = await http('GET', '/api/skill/export?slug=alpha');
    check('export single returns simple-skill format', r.status === 200 && r.json?.format === 'simple-skill' && r.json?.skill?.slug === 'alpha', `status=${r.status}`);

    // ── export missing ──────────────────────────────────────────────────────
    r = await http('GET', '/api/skill/export?slug=nope');
    check('export missing slug → 404', r.status === 404, `status=${r.status}`);

    // ── import single skill object ──────────────────────────────────────────
    r = await http('POST', '/api/skill/import',
        { slug: 'gamma', name: 'Gamma', steps: [{ type: 'key_tap', keys: ['g'] }] });
    check('import single object → ok + gamma',
        r.status === 200 && r.json?.ok === true && JSON.stringify(r.json?.imported) === '["gamma"]',
        JSON.stringify(r.json));
    check('import single wrote gamma.json to disk', fs.existsSync(path.join(skillDir, 'gamma.json')));

    // ── import bundle: one valid + one malformed ────────────────────────────
    r = await http('POST', '/api/skill/import', {
        skills: [
            { slug: 'delta', name: 'Delta', steps: [{ type: 'key_tap', keys: ['d'] }] },
            { slug: 'bad', steps: 'not-an-array' },
        ],
    });
    check('import bundle imports delta, skips bad',
        r.status === 200
        && JSON.stringify(r.json?.imported) === '["delta"]'
        && r.json?.skipped?.some(s => s.slug === 'bad' && s.reason === 'malformed steps'),
        JSON.stringify(r.json));

    // ── import missing-slug entry ───────────────────────────────────────────
    r = await http('POST', '/api/skill/import', [{ steps: [{ type: 'key_tap', keys: ['x'] }] }]);
    check('import entry without slug is skipped', r.status === 200 && r.json?.skipped?.some(s => s.reason === 'missing slug'), JSON.stringify(r.json));

    // ── import garbage body → 400 ───────────────────────────────────────────
    r = await http('POST', '/api/skill/import', { foo: 1 });
    check('import garbage body → 400', r.status === 400, `status=${r.status}`);

    // ── imported skills now appear in export all ────────────────────────────
    r = await http('GET', '/api/skill/export');
    check('export all now includes imported skills (4 total)', r.json?.count === 4, `count=${r.json?.count}`);

    await closeEvalHttpServer();
    console.log(`\nskill-export-import.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
    console.error('  FAIL (uncaught)', e && e.message);
    closeEvalHttpServer().finally(() => process.exit(1));
});
