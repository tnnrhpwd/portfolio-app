/**
 * test-vision-board.js — end-to-end test of vision-board generation.
 *
 * The panel on /plans 🌟 is easy to unit-test and hard to *believe* without
 * running it: the feature is three paid steps in one request (chat model writes
 * the prompt → image model draws it → the picture is stored and the board saved).
 * This script drives that whole path against a running backend and prints what
 * came back.
 *
 * Run:
 *   node scripts/test-vision-board.js                 # one board from every goal
 *   node scripts/test-vision-board.js dream           # only Life-horizon goals
 *   node scripts/test-vision-board.js dream all       # both, two images, two credits
 *   node scripts/test-vision-board.js --list          # what is stored, spend nothing
 *   node scripts/test-vision-board.js --delete        # remove every stored board
 *   node scripts/test-vision-board.js --prompt all "no people, film photography"
 *                                                     # the look, the brief + the prompt it produces,
 *                                                     # no image and no image credit
 *   node scripts/test-vision-board.js --prompt all "riso pop"
 *                                                     # name a look and that look is the one used
 *   node scripts/test-vision-board.js all "film photography, mountains"
 *
 * Costs real credits and real money: each scope is one image (~$0.04) plus one
 * short LLM call. `--prompt` is the cheap loop for working on the prompt itself —
 * it makes the LLM call but stops before the image. It logs in as the shared guest
 * account, so anything it makes must be deleted again (`--delete`).
 *
 * A board's LOOK (light, palette and mood) is picked per board and never the one the
 * previous board used, so two runs of this script are two different boards on
 * purpose. The hint names a look ("coastal", "pastel", "evening city") when you
 * want the same one twice — no props are involved any more: a board is a collage of
 * photographs of the goals, not a board of stationery.
 */
const path = require('path');

// The script lives in backend/scripts even when it is run from the repo root, and
// it needs the backend's env + modules for --prompt. Resolve both by __dirname
// rather than by the caller's cwd.
const BACKEND = path.join(__dirname, '..');
try {
    // eslint-disable-next-line global-require
    require('dotenv').config({ path: path.join(BACKEND, '.env') });
} catch { /* the HTTP modes do not need it */ }

const BASE = process.env.API_BASE || 'http://localhost:5000/api/data';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const rest = args.filter((a) => !a.startsWith('--'));
const scopes = rest.filter((a) => ['dream', 'all'].includes(a));
const hint = rest.find((a) => !['dream', 'all'].includes(a)) || '';

const api = async (path, { token, ...opts } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
};

(async () => {
    const login = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'guest@gmail.com', password: 'guest' }),
    });
    if (!login.json?.token) {
        console.error('LOGIN FAILED:', JSON.stringify(login.json).slice(0, 400));
        process.exit(1);
    }
    const token = login.json.token;
    console.log(`Logged in as guest (HTTP ${login.status}).`);

    const goalsRes = await api('/csimple/workspace?kind=goal', { token });
    const goals = goalsRes.json?.entries || [];
    const dreams = goals.filter((g) => g.horizon === 'life');
    console.log(`Goals: ${goals.length} (${dreams.length} Life-horizon ${
        dreams.length === 1 ? 'dream' : 'dreams'}).`);
    for (const g of goals) console.log(`  · [${g.horizon || 'no horizon'}] ${g.name}`);

    // ── What is stored ───────────────────────────────────────────────────────
    const list = async (label) => {
        const res = await api('/csimple/workspace?kind=vision', { token });
        const entries = res.json?.entries || [];
        console.log(`${label}: ${entries.length} vision board${entries.length === 1 ? '' : 's'} stored.`);
        for (const entry of entries) {
            let record = null;
            try { record = JSON.parse(entry.content); } catch { /* reported below */ }
            if (!record) { console.log(`  · ${entry.slug} — content is not JSON`); continue; }
            console.log(`  · ${entry.slug} [${record.scope}] ${record.source?.used} goals`
                + ` from a ${record.promptSource} prompt, ${record.image?.bytes} bytes`
                + `, look: ${record.style?.name || record.style?.id || 'none (made before looks)'}`);
            console.log(`    prompt: ${String(record.prompt).slice(0, 160)}…`);
            console.log(`    image:  ${record.image?.url}`);
        }
        return entries;
    };

    if (flags.includes('--delete')) {
        const entries = await list('Before delete');
        for (const entry of entries) {
            const res = await api(`/csimple/vision-board/${encodeURIComponent(entry.slug)}`, { method: 'DELETE', token });
            console.log(`  deleted ${entry.slug} → HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
        }
        await list('After delete');
        return;
    }

    if (flags.includes('--list')) {
        await list('Stored');
        return;
    }

    // ── The prompt only: the cheap loop for working on the brief ─────────────
    if (flags.includes('--prompt')) {
        // The server hydrates AWS_REGION from Secrets Manager at boot; a standalone
        // script has to do it itself or Bedrock answers "Region is missing".
        try {
            const { loadAllSecrets } = require(path.join(BACKEND, 'utils', 'awsSecrets'));
            if (typeof loadAllSecrets === 'function') await loadAllSecrets();
        } catch (e) {
            console.warn(`(could not hydrate secrets: ${e.message} — relying on .env)`);
        }

        const service = require(path.join(BACKEND, 'services', 'visionBoard'));
        const { createBedrockCompletion } = require(path.join(BACKEND, 'services', 'bedrockService'));

        const scope = scopes[0] || 'all';
        const selection = service.selectGoalsForBoard(goals, scope);
        if (!selection.goals.length) {
            console.log(`Nothing to draw from for scope "${scope}".`);
            return;
        }
        const rules = service.resolveBoardRules(hint);
        // The look is what makes the gallery varied, and it is the thing being
        // iterated on when this mode is used, so it is picked here exactly as the
        // controller picks it and then printed before the brief.
        const style = service.pickBoardStyle({ hint });
        const brief = service.buildVisionBoardPrompt(selection.goals, { scope, hint, rules, style });

        console.log(`\n──── THE LOOK ──── ${style.name} (${style.id}, ${style.source})`);
        console.log(style.lines.join('\n'));
        console.log(`name it in the hint ("${style.keywords[0]}") to ask for this look again.`);
        console.log(`\n──── THE BRIEF (what the chat model is asked) ────\n${brief}`);
        console.log(`\n──── RULES ──── allowPeople=${rules.allowPeople}  allowText=${rules.allowText}`);
        console.log(`negative prompt: ${service.boardNegativePrompt(rules)}`);

        const started = Date.now();
        const response = await createBedrockCompletion([
            { role: 'system', content: service.VISION_BOARD_SYSTEM },
            { role: 'user', content: brief },
        ], { temperature: 0.8, maxTokens: 600 });
        const raw = response?.choices?.[0]?.message?.content || '';
        const { prompt, source } = service.normalizeBoardPrompt(raw, selection.goals, scope, rules, style);

        console.log(`\n──── THE IMAGE PROMPT (${source}, ${Date.now() - started}ms) ────\n${prompt}`);
        if (source === 'fallback') console.log(`\n(model answer was unusable: ${JSON.stringify(raw.slice(0, 200))})`);
        return;
    }

    // ── Make one ─────────────────────────────────────────────────────────────
    const want = scopes.length ? scopes : ['all'];
    console.log(`\nGenerating: ${want.join(' + ')}${hint ? ` (hint: "${hint}")` : ''}`);
    const started = Date.now();
    const res = await api('/csimple/vision-board', {
        method: 'POST',
        token,
        body: JSON.stringify({ scopes: want, ...(hint ? { hint } : {}) }),
    });
    console.log(`HTTP ${res.status} in ${Date.now() - started}ms`);
    console.log('=== RESPONSE (trimmed) ===');
    console.log(JSON.stringify(res.json, (k, v) => (k === 'prompt' && typeof v === 'string' ? `${v.slice(0, 300)}…` : v), 2).slice(0, 3000));

    await list('\nStored');
})().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
