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
 */

const fs = require('fs');
const path = require('path');

const registry = require('../tool-registry');
const permissions = require('../permissions');

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
};
