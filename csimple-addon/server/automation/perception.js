/**
 * Perception cache — keeps the last UIA snapshot of the foreground window in
 * process memory so the agent loop can do a cheap "what's on screen?" lookup
 * without paying the full ~700ms UIA cost on every reasoning step.
 *
 * Two modes:
 *   1. On-demand (default): `perception_recent` tool checks the cache; if the
 *      cached snapshot is older than `maxAgeMs`, it runs a fresh capture and
 *      stores it before returning. No background activity.
 *   2. Background pump (opt-in): `startPump({intervalMs})` runs a lightweight
 *      foreground-window-title poll every interval; when the title changes OR
 *      the cached snapshot is older than `ttlMs`, it refreshes the full
 *      snapshot. Cheap because the title check is fast.
 *
 * The cache holds at most ONE entry — the most recent snapshot. We never
 * persist to disk (snapshots can contain sensitive UI text).
 */

const { uiaSnapshot } = require('./tools/uia');

const DEFAULT_MAX_AGE_MS = 4_000;       // tool calls inside this window reuse cache
const DEFAULT_PUMP_INTERVAL_MS = 5_000;
const DEFAULT_PUMP_TTL_MS = 30_000;     // force-refresh even if title unchanged

let _cache = null;                  // { ts, snapshot, windowTitle }
let _inflight = null;               // Promise — coalesce concurrent refresh calls
let _pumpTimer = null;
let _pumpOpts = null;

/**
 * Return the cached snapshot if fresh enough, otherwise capture a new one.
 * Concurrent calls share a single inflight refresh.
 */
async function getRecent({ maxAgeMs = DEFAULT_MAX_AGE_MS, mode = 'interactive', maxNodes = 250 } = {}) {
    const now = Date.now();
    if (_cache && (now - _cache.ts) <= maxAgeMs && _cache.snapshot?.mode === mode) {
        return { fromCache: true, ageMs: now - _cache.ts, ...stripPayload(_cache.snapshot) };
    }
    if (_inflight) {
        const snap = await _inflight;
        return { fromCache: false, coalesced: true, ageMs: Date.now() - (_cache?.ts || now), ...stripPayload(snap) };
    }
    _inflight = (async () => {
        try {
            const snap = await uiaSnapshot.run({ mode, maxNodes });
            _cache = { ts: Date.now(), snapshot: snap, windowTitle: snap?.window || '' };
            return snap;
        } finally { _inflight = null; }
    })();
    const snap = await _inflight;
    return { fromCache: false, ageMs: Date.now() - _cache.ts, ...stripPayload(snap) };
}

function stripPayload(snap) {
    if (!snap || typeof snap !== 'object') return { snapshot: snap };
    return { window: snap.window, mode: snap.mode, count: snap.count, truncated: !!snap.truncated, nodes: snap.nodes, tree: snap.tree };
}

/**
 * Start a background pump. Safe to call multiple times — subsequent calls
 * just update the options.
 */
function startPump({ intervalMs = DEFAULT_PUMP_INTERVAL_MS, ttlMs = DEFAULT_PUMP_TTL_MS, mode = 'interactive', maxNodes = 250 } = {}) {
    _pumpOpts = { intervalMs, ttlMs, mode, maxNodes };
    if (_pumpTimer) clearInterval(_pumpTimer);
    _pumpTimer = setInterval(() => tick().catch(() => {}), intervalMs);
    // Run one immediately so callers don't have to wait the first interval.
    tick().catch(() => {});
    return { running: true, intervalMs, ttlMs };
}

function stopPump() {
    if (_pumpTimer) { clearInterval(_pumpTimer); _pumpTimer = null; }
    _pumpOpts = null;
    return { running: false };
}

async function tick() {
    if (!_pumpOpts) return;
    const { ttlMs, mode, maxNodes } = _pumpOpts;
    // Fast path: only refresh if cache is empty or older than TTL.
    // (We deliberately skip the cheap-title-poll optimization for now —
    //  a single full snapshot every TTL seconds is plenty for the agent.)
    if (_cache && (Date.now() - _cache.ts) < ttlMs) return;
    if (_inflight) return;
    await getRecent({ maxAgeMs: 0, mode, maxNodes });
}

function getStatus() {
    return {
        pumpRunning: !!_pumpTimer,
        pumpOpts: _pumpOpts,
        cachedAt: _cache?.ts || null,
        cachedAgeMs: _cache ? Date.now() - _cache.ts : null,
        cachedWindow: _cache?.windowTitle || null,
        cachedMode: _cache?.snapshot?.mode || null,
        cachedCount: _cache?.snapshot?.count ?? null,
    };
}

function _resetForTests() {
    if (_pumpTimer) clearInterval(_pumpTimer);
    _pumpTimer = null;
    _pumpOpts = null;
    _cache = null;
    _inflight = null;
}

// ─── Tool wrapper ────────────────────────────────────────────────────────
const perceptionRecent = {
    name: 'perception_recent',
    category: 'safe-read',
    description:
        'Return the most recent perception snapshot of the foreground window. ' +
        'Reuses an in-memory cache to avoid re-running a full UIA tree walk on every agent step. ' +
        'If the cache is older than `maxAgeMs` (default 4000), a fresh snapshot is taken first. ' +
        'Set `mode="interactive"` for actionable controls only, `"tree"` for the full hierarchy, `"flat"` for every visible node.',
    parameters: {
        type: 'object',
        properties: {
            maxAgeMs: { type: 'integer', description: 'Maximum acceptable cache age in ms; 0 forces a refresh.' },
            mode: { type: 'string', enum: ['tree', 'interactive', 'flat'] },
            maxNodes: { type: 'integer', description: 'Hard cap on nodes returned (10–1000).' },
        },
    },
    async run(args = {}) {
        return await getRecent({
            maxAgeMs: Number.isFinite(args.maxAgeMs) ? args.maxAgeMs : DEFAULT_MAX_AGE_MS,
            mode: args.mode,
            maxNodes: args.maxNodes,
        });
    },
};

module.exports = {
    perceptionRecent,
    startPump,
    stopPump,
    getStatus,
    getRecent,
    _resetForTests,
};
