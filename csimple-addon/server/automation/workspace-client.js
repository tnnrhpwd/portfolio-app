/**
 * Tiny client for the portfolio backend's workspace API.
 *
 * The addon already stores the user JWT via CloudRelayService.setToken;
 * we read it from there. All calls hit:
 *   {BACKEND_URL}/api/data/csimple/workspace/...
 *
 * Methods used by the agent loop + goal/action tools:
 *   - getNextGoal()
 *   - getGoal(slug) / upsertGoal(slug, patch)
 *   - appendAction(record)
 *   - getContext({ activeAgent, message }) → preview (debug)
 *
 * Throws on non-2xx.
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://mern-plan-web-service.onrender.com';
const BASE = `${BACKEND_URL}/api/data/csimple/workspace`;

let _tokenGetter = () => null;

function setTokenGetter(fn) { _tokenGetter = fn || (() => null); }

/**
 * Call the backend compile-natural endpoint using the user's JWT.
 * This is the fallback when the local addon doesn't have a GitHub PAT
 * in settings.json (e.g. fresh dev run, PAT only saved via the web UI).
 */
async function compileNaturalViaBackend(description, context) {
    const token = _tokenGetter();
    if (!token) throw new Error('No auth token — sign in on the web app first, then try again.');
    const url = `${BACKEND_URL}/api/data/csimple/compile-natural`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ description, context }),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
        const msg = json?.dataMessage || json?.message || json?.error || text || `backend error ${res.status}`;
        const e = new Error(msg);
        e.status = res.status;
        throw e;
    }
    return json;
}

async function req(method, urlPath, body) {
    const token = _tokenGetter();
    if (!token) throw new Error('No auth token (sign in on the web app first)');
    const url = `${BASE}${urlPath}`;
    const res = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
        const msg = json?.message || json?.error || text || res.statusText;
        const e = new Error(`workspace API ${method} ${urlPath} → ${res.status}: ${msg}`);
        e.status = res.status;
        throw e;
    }
    return json;
}

const getNextGoal = async ()            => {
    const out = await req('GET', '/goals/next');
    // Backend wraps as { goal: {...} } or returns the item directly — normalize.
    return out?.goal ? out.goal : (out || null);
};
const getGoal     = (slug)              => req('GET', `/goal/${encodeURIComponent(slug)}`);
const upsertGoal  = (slug, body)        => req('PUT', `/goal/${encodeURIComponent(slug)}`, body);
const deleteGoal  = (slug)              => req('DELETE', `/goal/${encodeURIComponent(slug)}`);
const appendAction= (record)            => req('POST', '/action/append', record);
const appendLog   = (text)              => req('POST', '/log/append', { text });
const getContext  = ({ activeAgent, message } = {}) => {
    const q = new URLSearchParams();
    if (activeAgent) q.set('agent', activeAgent);
    if (message)     q.set('message', message);
    return req('GET', `/context?${q.toString()}`);
};
const getTelemetrySummary = ({ days, tool } = {}) => {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (tool) q.set('tool', tool);
    const qs = q.toString();
    return req('GET', `/telemetry/summary${qs ? '?' + qs : ''}`);
};

// ─── Marketplace (§4 of docs/new/csimple-agent-prompt.md) ─────────────────
// These hit `{BACKEND_URL}/api/data/market/...` (routeData.js is mounted at
// `/api/data` in server.js, same as every other backend route in this
// file) — a SEPARATE namespace from the private per-user `${BASE}`
// workspace skill store above. A "publish" action bridges the two (the
// addon scrubs + previews capabilities locally via /api/skill/scrub +
// /api/skill/capabilities first, then calls publishMarketSkill with the
// already-scrubbed steps).
const MARKET_BASE = `${BACKEND_URL}/api/data/market`;

async function marketReq(method, urlPath, body) {
    const token = _tokenGetter();
    if (!token) throw new Error('No auth token (sign in on the web app first)');
    const url = `${MARKET_BASE}${urlPath}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
        const msg = json?.message || json?.error || text || res.statusText;
        const e = new Error(`market API ${method} ${urlPath} → ${res.status}: ${msg}`);
        e.status = res.status;
        throw e;
    }
    return json;
}

const publishMarketSkill = (skill) => marketReq('POST', '/skills', skill);
const searchMarketSkills = ({ q, sort, page, perPage } = {}) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (sort) query.set('sort', sort);
    if (page) query.set('page', String(page));
    if (perPage) query.set('perPage', String(perPage));
    const qs = query.toString();
    return marketReq('GET', `/skills${qs ? '?' + qs : ''}`);
};
const getMarketSkill = (marketId, version) => marketReq('GET', `/skills/${encodeURIComponent(marketId)}${version ? '/' + version : ''}`);
const installMarketSkill = (marketId, version) => marketReq('POST', `/skills/${encodeURIComponent(marketId)}/install`, version ? { version } : {});
const rateMarketSkill = (marketId, { version, stars, outcome, ranAt } = {}) =>
    marketReq('POST', `/skills/${encodeURIComponent(marketId)}/rate`, { version, stars, outcome, ranAt });
const flagMarketSkill = (marketId, reason) => marketReq('POST', `/skills/${encodeURIComponent(marketId)}/flag`, { reason });

// ─── Skill kind helpers ────────────────────────────────────────────────────
// Skills are stored as workspace items with kind='skill'. The compiled JSON
// is encoded as the item's `content`; we also keep `name` and `tags`.
const getSkill = (slug) => req('GET', `/skill/${encodeURIComponent(slug)}`);
const upsertSkill = (slug, body) => req('PUT', `/skill/${encodeURIComponent(slug)}`, body);
const deleteSkill = (slug) => req('DELETE', `/skill/${encodeURIComponent(slug)}`);
const listSkills = () => {
    // The generic list endpoint is mounted at the base `/csimple/workspace`
    // (no kind segment) and filters via query string. Our `BASE` already
    // includes `/csimple/workspace`, so we pass an empty path to req().
    const q = new URLSearchParams({ kind: 'skill' });
    return req('GET', `?${q.toString()}`);
};

// ─── Goal list + recent actions ────────────────────────────────────────────
const listGoals = ({ status } = {}) => {
    const q = new URLSearchParams({ kind: 'goal' });
    if (status) q.set('status', status);
    return req('GET', `?${q.toString()}`);
};

/**
 * Fetch the tail of the action log (most recent N entries).
 * The action log is stored as JSONL in a log kind item. We parse it here.
 */
const getRecentActions = async (n = 20) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const item = await req('GET', `/log/${encodeURIComponent(`log-${today}`)}`).catch(() => null);
        const content = item?.content || item?.attrs?.content || '';
        if (!content) return [];
        const lines = content.trim().split('\n').filter(Boolean);
        const recent = lines.slice(-Math.max(1, n));
        return recent.map(l => { try { return JSON.parse(l); } catch { return { summary: l }; } });
    } catch {
        return [];
    }
};

module.exports = {
    setTokenGetter,
    getNextGoal,
    getGoal,
    upsertGoal,
    deleteGoal,
    appendAction,
    appendLog,
    getContext,
    getTelemetrySummary,
    getSkill,
    upsertSkill,
    deleteSkill,
    listSkills,
    listGoals,
    getRecentActions,
    compileNaturalViaBackend,
    publishMarketSkill,
    searchMarketSkills,
    getMarketSkill,
    installMarketSkill,
    rateMarketSkill,
    flagMarketSkill,
};
