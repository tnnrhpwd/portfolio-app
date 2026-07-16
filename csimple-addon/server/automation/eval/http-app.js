/**
 * http-app.js — lazy, in-process Express server used by the eval runner's
 * HTTP scenario mode (docs/new/csimple-agent-prompt.md §5.5).
 *
 * `automation/eval/runner.js` originally only supported "tool-registry"
 * scenarios (`steps: [{ tool, args, expect }]` executed directly against
 * `tool-registry.js`) — it had no way to exercise an actual `POST
 * /api/skill/...` route end-to-end. This module boots the SAME
 * `mountAutomation()` used by the real addon server (`server/index.js`) onto
 * a throwaway Express app bound to an ephemeral localhost port, so scenario
 * files can assert against the real HTTP surface (request parsing, route
 * wiring, status codes, JSON shape) instead of only the underlying function.
 *
 * The server is a singleton per process (lazily created on first use) so a
 * whole scenario directory run only pays the boot cost once. Call
 * `closeEvalHttpServer()` to tear it down (unit tests should do this in
 * cleanup so the test process can exit cleanly).
 */

let _serverPromise = null;

async function getEvalHttpBaseUrl() {
    if (_serverPromise) return _serverPromise;
    _serverPromise = (async () => {
        const express = require('express');
        const { mountAutomation } = require('../index');

        const app = express();
        app.use(express.json({ limit: '10mb' }));
        // Silence addon logging noise during eval runs — failures still
        // surface via the scenario's own pass/fail report.
        mountAutomation(app, { log: () => {} });

        return new Promise((resolve, reject) => {
            const server = app.listen(0, '127.0.0.1', () => {
                const addr = server.address();
                resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
            });
            server.on('error', reject);
        });
    })();
    return _serverPromise;
}

/**
 * Tear down the singleton eval HTTP server, if one was started. Safe to call
 * even if no server was ever created. Resets the singleton so a subsequent
 * call to getEvalHttpBaseUrl() boots a fresh instance.
 */
async function closeEvalHttpServer() {
    if (!_serverPromise) return;
    const pending = _serverPromise;
    _serverPromise = null;
    try {
        const { server } = await pending;
        await new Promise((resolve) => server.close(() => resolve()));
    } catch {
        // Nothing to close (boot itself failed) — swallow.
    }
}

module.exports = { getEvalHttpBaseUrl, closeEvalHttpServer };
