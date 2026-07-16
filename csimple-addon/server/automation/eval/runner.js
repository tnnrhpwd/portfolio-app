/**
 * Scenario runner — replays a YAML/JSON scenario file against the live tool
 * registry and reports pass/fail against per-step assertions.
 *
 * A scenario lists a sequence of `steps`, each one a tool invocation plus
 * a set of `expect` assertions on the result. The runner does NOT need the
 * LLM agent loop — it executes the recipe deterministically so we can use it
 * as a regression net while we change tools or permissions.
 *
 * Scenario file shape (YAML or JSON):
 *
 *   name: "shell echoes hello"
 *   description: "Basic shell_run smoke test on Windows."
 *   require: { platform: "win32" }    # optional gate — skip if current
 *                                       # platform doesn't match. Prefix value
 *                                       # with '!' to require NOT that platform.
 *   permissions:                        # optional pre-flight overrides
 *     dryRunMode: false
 *     categories: { shell: "allow" }
 *   steps:
 *     - tool: shell_run
 *       args: { command: "echo hello-world" }
 *       expect:
 *         ok: true
 *         resultPath: "stdout"
 *         resultContains: "hello-world"
 *
 * `resultPath` is dotted ("stdout", "elements.0.name"). `resultContains`
 * checks substring; `resultEquals` checks deep equality; `resultMatches`
 * uses a regex string.
 *
 * ── HTTP scenario mode (docs/new/csimple-agent-prompt.md §5.5) ─────────────
 *
 * A scenario may instead supply an `http` block (mutually exclusive with
 * `steps`) to exercise an actual addon route end-to-end via a real, ephemeral
 * localhost Express server booted from the same `mountAutomation()` the addon
 * uses in production (see `./http-app.js`):
 *
 *   id: "skill-capabilities-http"
 *   name: "Capability summary — POST /api/skill/capabilities"
 *   require: { env: { EVAL_ALLOW_LLM: "1" } }   # optional, e.g. to gate LLM-backed routes
 *   http:
 *     method: POST
 *     path: /api/skill/capabilities
 *     body: { skill: { name: "demo", steps: [ ... ] } }
 *   expect:
 *     status: 200            # optional HTTP status check (default: no check)
 *     ok: true                # optional — checks response body.ok
 *     summary: { minLength: 1 }   # field assertion — see evaluateFieldAssertion
 *
 * Any top-level `expect` key other than `status`/`ok` is treated as a field
 * assertion against a dotted path into the body (`getByPath(body, key)` —
 * e.g. `"stats.enabled"` reaches into a nested object), evaluated by
 * `evaluateFieldAssertion()`: supports `{ equals }`, `{ contains }`,
 * `{ matches }` (regex), `{ minLength }`/`{ maxLength }` (array/string
 * length), `{ type: "array"|"string"|"number"|"boolean"|"object" }`,
 * `{ exists: true|false }`, and a bare non-object value shorthand for
 * deep-equality.
 */

const fs = require('fs');
const path = require('path');

const registry = require('../tool-registry');
const permissions = require('../permissions');
const { getEvalHttpBaseUrl, closeEvalHttpServer } = require('./http-app');

function tryLoadYaml() {
    try { return require('yaml'); } catch { /* optional dep */ }
    try { return require('js-yaml'); } catch { /* optional dep */ }
    return null;
}

function parseScenarioFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.json')) return JSON.parse(raw);
    const yaml = tryLoadYaml();
    if (!yaml) {
        throw new Error('YAML parser not installed. Install "yaml" or "js-yaml", or use a .json scenario.');
    }
    if (typeof yaml.parse === 'function') return yaml.parse(raw);          // yaml v2
    if (typeof yaml.load === 'function')  return yaml.load(raw);           // js-yaml
    throw new Error('Loaded YAML module has no parse() or load() function.');
}

function getByPath(obj, dottedPath) {
    if (!dottedPath) return obj;
    let cur = obj;
    for (const seg of String(dottedPath).split('.')) {
        if (cur == null) return undefined;
        cur = cur[seg];
    }
    return cur;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
}

function evaluateExpectations(stepIndex, expected, outcome) {
    const failures = [];
    if (!expected) return failures;
    if ('ok' in expected && expected.ok !== outcome.ok) {
        failures.push(`step ${stepIndex}: expected ok=${expected.ok}, got ${outcome.ok} (error=${outcome.error || ''})`);
    }
    if (!outcome.ok) {
        // If the step failed and the user expected ok=true we already noted it; bail on result checks.
        return failures;
    }
    if (expected.resultEquals !== undefined) {
        const actual = getByPath(outcome.result, expected.resultPath);
        if (!deepEqual(actual, expected.resultEquals)) {
            failures.push(`step ${stepIndex}: resultEquals mismatch at "${expected.resultPath || '(root)'}". expected=${JSON.stringify(expected.resultEquals)} got=${JSON.stringify(actual)}`);
        }
    }
    if (expected.resultContains !== undefined) {
        const actual = String(getByPath(outcome.result, expected.resultPath) ?? '');
        if (!actual.includes(String(expected.resultContains))) {
            failures.push(`step ${stepIndex}: resultContains "${expected.resultContains}" missing from "${expected.resultPath || '(root)'}" (saw: ${actual.slice(0, 120)})`);
        }
    }
    if (expected.resultMatches !== undefined) {
        const actual = String(getByPath(outcome.result, expected.resultPath) ?? '');
        let re;
        try { re = new RegExp(expected.resultMatches); }
        catch (e) { failures.push(`step ${stepIndex}: invalid resultMatches regex: ${e.message}`); return failures; }
        if (!re.test(actual)) {
            failures.push(`step ${stepIndex}: resultMatches /${expected.resultMatches}/ did not match (saw: ${actual.slice(0, 120)})`);
        }
    }
    if (expected.durationMsLte !== undefined && outcome.durationMs > expected.durationMsLte) {
        failures.push(`step ${stepIndex}: durationMs ${outcome.durationMs} > ${expected.durationMsLte}`);
    }
    return failures;
}

/**
 * Evaluate a single field assertion (used by HTTP scenario `expect` blocks).
 * `assertion` is either a bare value (shorthand for deep-equality) or an
 * object with one or more of: `equals`, `contains`, `matches` (regex string),
 * `minLength`, `maxLength`, `exists` (boolean presence check).
 */
function evaluateFieldAssertion(key, actual, assertion) {
    const failures = [];
    if (assertion === undefined) return failures;

    if (assertion === null || typeof assertion !== 'object') {
        if (!deepEqual(actual, assertion)) {
            failures.push(`field "${key}": expected ${JSON.stringify(assertion)}, got ${JSON.stringify(actual)}`);
        }
        return failures;
    }

    if ('exists' in assertion) {
        const isPresent = actual !== undefined && actual !== null;
        if (isPresent !== !!assertion.exists) {
            failures.push(`field "${key}": expected exists=${!!assertion.exists}, got ${isPresent}`);
        }
    }
    if ('equals' in assertion && !deepEqual(actual, assertion.equals)) {
        failures.push(`field "${key}": equals mismatch. expected=${JSON.stringify(assertion.equals)} got=${JSON.stringify(actual)}`);
    }
    if ('contains' in assertion) {
        const s = String(actual ?? '');
        if (!s.includes(String(assertion.contains))) {
            failures.push(`field "${key}": contains "${assertion.contains}" missing (saw: ${s.slice(0, 120)})`);
        }
    }
    if ('matches' in assertion) {
        const s = String(actual ?? '');
        let re;
        try { re = new RegExp(assertion.matches); }
        catch (e) { failures.push(`field "${key}": invalid matches regex: ${e.message}`); return failures; }
        if (!re.test(s)) failures.push(`field "${key}": matches /${assertion.matches}/ did not match (saw: ${s.slice(0, 120)})`);
    }
    if ('minLength' in assertion) {
        const len = (Array.isArray(actual) || typeof actual === 'string') ? actual.length : undefined;
        if (len === undefined || len < assertion.minLength) {
            failures.push(`field "${key}": expected length >= ${assertion.minLength}, got ${len === undefined ? `n/a (${typeof actual})` : len}`);
        }
    }
    if ('maxLength' in assertion) {
        const len = (Array.isArray(actual) || typeof actual === 'string') ? actual.length : undefined;
        if (len === undefined || len > assertion.maxLength) {
            failures.push(`field "${key}": expected length <= ${assertion.maxLength}, got ${len === undefined ? `n/a (${typeof actual})` : len}`);
        }
    }
    if ('type' in assertion) {
        const wantType = String(assertion.type);
        const actualType = Array.isArray(actual) ? 'array' : typeof actual;
        if (actualType !== wantType) {
            failures.push(`field "${key}": expected type "${wantType}", got "${actualType}" (value: ${JSON.stringify(actual)})`);
        }
    }
    return failures;
}

/**
 * Evaluate an HTTP scenario's `expect` block against the response.
 * `status`/`ok` are special-cased (HTTP status code, and `body.ok`
 * respectively); every other key is a field assertion against `body[key]`.
 */
function evaluateHttpExpectations(expected, response) {
    const failures = [];
    if (!expected) return failures;
    const { status, body } = response;

    if ('status' in expected && status !== expected.status) {
        failures.push(`expected HTTP status ${expected.status}, got ${status}`);
    }
    if ('ok' in expected) {
        const actualOk = body && typeof body === 'object' ? !!body.ok : undefined;
        if (actualOk !== expected.ok) {
            failures.push(`expected body.ok=${expected.ok}, got ${actualOk} (status=${status}, error=${body?.error || ''})`);
        }
    }
    for (const [key, assertion] of Object.entries(expected)) {
        if (key === 'status' || key === 'ok') continue;
        const actual = body && typeof body === 'object' ? getByPath(body, key) : undefined;
        failures.push(...evaluateFieldAssertion(key, actual, assertion));
    }
    return failures;
}

/**
 * Execute a scenario's `http` block against the shared eval HTTP server
 * (see ./http-app.js) and return `{ ok, status, body, durationMs, error }`.
 */
async function executeHttpStep(httpSpec) {
    const startedAt = Date.now();
    const { method = 'GET', path: reqPath, body, headers } = httpSpec || {};
    if (!reqPath) throw new Error('scenario.http.path is required');
    const { baseUrl } = await getEvalHttpBaseUrl();
    try {
        const res = await fetch(`${baseUrl}${reqPath}`, {
            method: String(method).toUpperCase(),
            headers: { 'Content-Type': 'application/json', ...(headers || {}) },
            body: body !== undefined ? JSON.stringify(expandEnv(body)) : undefined,
        });
        const text = await res.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* leave null; non-JSON body */ }
        return {
            ok: res.ok,
            status: res.status,
            body: parsed,
            durationMs: Date.now() - startedAt,
            error: res.ok ? null : (parsed?.error || text || res.statusText),
        };
    } catch (e) {
        return { ok: false, status: 0, body: null, durationMs: Date.now() - startedAt, error: e.message };
    }
}

function shouldSkip(req) {
    if (!req) return null;
    if (req.platform) {
        const want = String(req.platform);
        const negate = want.startsWith('!');
        const target = negate ? want.slice(1) : want;
        const matches = process.platform === target;
        // require:platform="win32" — skip unless on win32
        // require:platform="!win32" — skip on win32
        if ((negate && matches) || (!negate && !matches)) {
            return `platform gate: required ${want}, current ${process.platform}`;
        }
    }
    if (req.env) {
        for (const [k, v] of Object.entries(req.env)) {
            if (String(process.env[k] || '') !== String(v)) {
                return `env gate: ${k} != ${v}`;
            }
        }
    }
    return null;
}

/**
 * Recursively expand `${ENV_VAR}` references inside string fields of a
 * scenario's args object. Lets scenarios reference paths like
 * "${USERPROFILE}\\Documents" without hard-coding the current user.
 */
function expandEnv(value) {
    if (typeof value === 'string') {
        return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? '');
    }
    if (Array.isArray(value)) return value.map(expandEnv);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
        return out;
    }
    return value;
}

/**
 * Execute a single scenario object and return a structured report.
 * Does NOT throw on assertion failure — failures live in the report.
 *
 * @param {object}  scenario  parsed scenario
 * @param {object}  opts
 * @param {boolean} [opts.dryRun=false]  force every tool into dry-run mode
 * @param {function} [opts.log=console.log]
 */
async function runScenarioObject(scenario, opts = {}) {
    const log = opts.log || (() => {});
    const startedAt = Date.now();
    const report = {
        name: scenario.name || '(unnamed)',
        description: scenario.description || '',
        startedAt: new Date(startedAt).toISOString(),
        durationMs: 0,
        passed: false,
        skippedReason: null,
        steps: [],
        failures: [],
    };

    const skipReason = shouldSkip(scenario.require || scenario.skipIf);
    if (skipReason) {
        report.skippedReason = skipReason;
        report.durationMs = Date.now() - startedAt;
        log(`[eval] SKIP "${report.name}" — ${skipReason}`);
        return report;
    }

    // Apply optional permission overrides for the duration of the scenario,
    // then restore. We snapshot the cfg via load() and re-save the snapshot in
    // a finally block.
    const originalCfg = JSON.parse(JSON.stringify(permissions.load()));
    if (opts.dryRun) {
        permissions.save({ dryRunMode: true });
    } else if (scenario.permissions) {
        permissions.save(scenario.permissions);
    }

    try {
        if (scenario.http) {
            // ── HTTP scenario mode ───────────────────────────────────────
            const httpOutcome = await executeHttpStep(scenario.http);
            const failures = evaluateHttpExpectations(scenario.expect, httpOutcome);
            report.steps.push({
                index: 0,
                tool: `http:${String(scenario.http.method || 'GET').toUpperCase()} ${scenario.http.path}`,
                ok: httpOutcome.ok,
                mode: 'http',
                durationMs: httpOutcome.durationMs,
                error: httpOutcome.error || null,
                failures,
            });
            report.failures.push(...failures);
            report.passed = report.failures.length === 0
                && (httpOutcome.ok || scenario.expect?.ok === false || scenario.expect?.status !== undefined);
        } else {
            for (let i = 0; i < (scenario.steps || []).length; i++) {
                const step = scenario.steps[i];
                const ctx = {
                    log: (...a) => log('[eval]', ...a),
                    addAction: async () => {}, // suppress cloud audit during eval
                    userInitiated: true,        // bypass approval prompts
                };
                const outcome = await registry.executeTool(step.tool, expandEnv(step.args || {}), ctx);
                const failures = evaluateExpectations(i, step.expect, outcome);
                report.steps.push({
                    index: i, tool: step.tool, ok: outcome.ok,
                    mode: outcome.mode, durationMs: outcome.durationMs,
                    error: outcome.error || null,
                    failures,
                });
                report.failures.push(...failures);
            }
            report.passed = report.failures.length === 0
                && report.steps.every(s => s.ok || (scenario.steps[s.index]?.expect?.ok === false));
        }
    } finally {
        // Restore the original permissions snapshot.
        // We do this by writing a full config, not a partial patch.
        try {
            const cfgPath = permissionsFilePath();
            fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
            fs.writeFileSync(cfgPath, JSON.stringify(originalCfg, null, 2), 'utf-8');
        } catch (e) { log('[eval] failed to restore permissions:', e.message); }
        // Bust the in-process cache so the next load() picks up the restored file.
        try { permissions._reset?.(); } catch {}
    }

    report.durationMs = Date.now() - startedAt;
    log(`[eval] ${report.passed ? 'PASS' : 'FAIL'} "${report.name}" in ${report.durationMs}ms (failures: ${report.failures.length})`);
    return report;
}

function permissionsFilePath() {
    const os = require('os');
    const userData = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'csimple-addon')
        : path.join(os.homedir(), '.csimple-addon');
    return path.join(userData, 'automation-permissions.json');
}

/**
 * Convenience: load + run a scenario file.
 */
async function runScenarioFile(filePath, opts = {}) {
    const scenario = parseScenarioFile(filePath);
    return runScenarioObject(scenario, opts);
}

/**
 * Run every scenario in a directory (non-recursive). Returns a single roll-up
 * report.
 */
async function runScenarioDirectory(dirPath, opts = {}) {
    const files = fs.readdirSync(dirPath)
        .filter(f => /\.(ya?ml|json)$/i.test(f))
        .map(f => path.join(dirPath, f));
    const reports = [];
    for (const f of files) {
        try {
            reports.push(await runScenarioFile(f, opts));
        } catch (e) {
            reports.push({
                name: path.basename(f), passed: false, durationMs: 0,
                failures: [`parse/load error: ${e.message}`], steps: [],
            });
        }
    }
    const passed = reports.filter(r => r.passed).length;
    const skipped = reports.filter(r => r.skippedReason).length;
    return {
        directory: dirPath,
        total: reports.length,
        passed,
        failed: reports.length - passed - skipped,
        skipped,
        reports,
    };
}

module.exports = {
    runScenarioObject,
    runScenarioFile,
    runScenarioDirectory,
    parseScenarioFile,
    evaluateFieldAssertion,
    evaluateHttpExpectations,
    closeEvalHttpServer,
};
