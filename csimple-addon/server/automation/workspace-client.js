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
};
