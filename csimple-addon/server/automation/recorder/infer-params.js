/**
 * infer-params.js — multi-demonstration parameter inference.
 *
 * Implements docs/new/csimple-agent-prompt.md §5.2 "Parameter inference":
 * when a user demonstrates the same or similar task more than once, diff the
 * resulting skills to detect what varies between runs (typed text, target
 * names, numeric values) and promote those varying literals into
 * `${param.<name>}` placeholders — the substitution mechanism already used
 * by `tools/skill.js` (`substituteArgs`) and by the publish-time scrub pass
 * (`recorder/scrub.js`).
 *
 * Capture UX (per the plan): a single demonstration is the default path —
 * §5.1 generalization handles it alone. Multi-demo is opt-in, triggered by a
 * "demonstrate again" affordance on an already-recorded skill, so this
 * module is only invoked when the caller explicitly supplies 2+ skills of
 * the SAME task.
 *
 * Alignment strategy: this is deliberately simple/best-effort, matching the
 * repo's "generalization never blocks saving/running" philosophy — demos of
 * the same task are expected to produce the same NUMBER of steps in the same
 * ORDER (with the same tool/type at each index); this module does not
 * attempt fuzzy sequence alignment (no LCS/edit-distance). If step counts or
 * per-index step kinds don't line up, the affected step (or the whole skill,
 * for a count mismatch) is left un-parameterized and a `findings` entry
 * explains why — the caller always gets back a valid, runnable skill.
 *
 * Works with BOTH step schemas used in this codebase:
 *   - literal (compiler.js):    { tool: 'click_at', args: { x, y } }
 *   - abstracted (nl-compiler): { type: 'type_text', text: '...' }
 * and recurses into `loop_until_key` / `loop_n_times` step `.body` arrays,
 * matching the convention already used by scrub.js and capability-summary.js.
 */

// Leaf key names that are structural/positional rather than semantic content
// — these vary by nature (pixel coordinates, timing, path arrays, would-be
// image payloads) and should never be promoted to a param even if they
// differ across demonstrations.
const IGNORE_LEAF_RE = /^(x|y|ms|delayms|durationms|intervalms|timeoutms|timestamp|ts|path|button|modifier|modifiers|screenshot|image|frame|dataurl|imagedata|thumbnail|snapshot)$/i;

function _isTemplate(v) {
    return typeof v === 'string' && /^\$\{param\.[a-zA-Z0-9_]+\}$/.test(v);
}

function _pathTokens(path) {
    return path.match(/[^.[\]]+/g) || [];
}

function _isIgnoredPath(path) {
    return _pathTokens(path).some(t => !/^\d+$/.test(t) && IGNORE_LEAF_RE.test(t));
}

/** Recursively collect { path, value } leaves from a plain object/array tree. */
function _collectLeaves(node, prefix, out, excludeRootKeys) {
    if (node === null || typeof node !== 'object') {
        out.push({ path: prefix, value: node });
        return;
    }
    if (Array.isArray(node)) {
        node.forEach((v, i) => _collectLeaves(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
        return;
    }
    for (const k of Object.keys(node)) {
        if (prefix === '' && excludeRootKeys && excludeRootKeys.has(k)) continue;
        _collectLeaves(node[k], prefix ? `${prefix}.${k}` : k, out);
    }
}

function _getAtPath(obj, path) {
    let cur = obj;
    for (const t of _pathTokens(path)) {
        if (cur === null || cur === undefined) throw new Error('path not found');
        const key = /^\d+$/.test(t) ? Number(t) : t;
        if (!(key in cur)) throw new Error('path not found');
        cur = cur[key];
    }
    return cur;
}

function _setAtPath(obj, path, value) {
    const tokens = _pathTokens(path);
    let cur = obj;
    for (let i = 0; i < tokens.length - 1; i++) {
        const t = tokens[i];
        cur = cur[/^\d+$/.test(t) ? Number(t) : t];
    }
    const last = tokens[tokens.length - 1];
    cur[/^\d+$/.test(last) ? Number(last) : last] = value;
}

function _redactSampleValue(v) {
    if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '\u2026';
    return v;
}

function _uniqueParamName(path, usedNames) {
    const tokens = _pathTokens(path);
    let base = (tokens[tokens.length - 1] || 'param').replace(/[^a-zA-Z0-9_]/g, '');
    if (!base || /^\d+$/.test(base)) base = 'value' + base;
    let name = base;
    let n = 2;
    while (usedNames.has(name)) { name = `${base}${n}`; n++; }
    return name;
}

function _fieldsContainer(step, excludeRootKeys) {
    if (step.args !== undefined) return { container: step.args, excludeRootKeys: null };
    return { container: step, excludeRootKeys };
}

const CONTROL_FLOW_EXCLUDE = new Set(['type', 'tool', 'body']);

/**
 * Walk one level of aligned step arrays (top-level steps, or the `.body` of
 * a loop step), promoting varying literal leaves into params. Mutates the
 * first array in place (it's expected to already be a deep clone).
 */
function _processLevel(baseSteps, allSkillStepLists, paramsMap, usedNames, findings, labelPrefix) {
    const stepCount = baseSteps.length;
    if (!allSkillStepLists.every(list => Array.isArray(list) && list.length === stepCount)) {
        findings.push({ step: labelPrefix || 'root', skipped: true, reason: 'nested step counts differ across demonstrations' });
        return;
    }

    for (let i = 0; i < stepCount; i++) {
        const newStep = baseSteps[i];
        const kind = newStep.type || newStep.tool;
        const label = labelPrefix ? `${labelPrefix}.body[${i}]` : String(i);

        const kindMismatch = allSkillStepLists.some(list => (list[i].type || list[i].tool) !== kind);
        if (kindMismatch) {
            findings.push({ step: label, skipped: true, reason: 'step kind differs across demonstrations' });
            continue;
        }

        const { container, excludeRootKeys } = _fieldsContainer(newStep, CONTROL_FLOW_EXCLUDE);
        const leaves = [];
        _collectLeaves(container, '', leaves, excludeRootKeys);

        for (const leaf of leaves) {
            if (_isIgnoredPath(leaf.path) || _isTemplate(leaf.value)) continue;

            const values = [];
            let structMismatch = false;
            for (const list of allSkillStepLists) {
                const other = list[i];
                const otherContainer = other.args !== undefined ? other.args : other;
                try { values.push(_getAtPath(otherContainer, leaf.path)); }
                catch { structMismatch = true; break; }
            }
            if (structMismatch) {
                findings.push({ step: label, field: leaf.path, skipped: true, reason: 'field missing in one or more demonstrations' });
                continue;
            }

            const allSame = values.every(v => JSON.stringify(v) === JSON.stringify(values[0]));
            if (allSame) continue; // constant across all demos — leave as a literal

            const paramName = _uniqueParamName(leaf.path, usedNames);
            usedNames.add(paramName);
            _setAtPath(container, leaf.path, `\${param.${paramName}}`);
            paramsMap.set(paramName, {
                name: paramName,
                description: `Inferred from step ${label} field "${leaf.path}" (varied across ${values.length} demonstrations)`,
                type: typeof values[0] === 'number' ? 'number' : 'string',
                default: _redactSampleValue(values[0]),
            });
            findings.push({ step: label, field: leaf.path, param: paramName, variedCount: values.length });
        }

        if (Array.isArray(newStep.body)) {
            const nestedLists = allSkillStepLists.map(list => list[i].body);
            if (nestedLists.every(b => Array.isArray(b))) {
                _processLevel(newStep.body, nestedLists, paramsMap, usedNames, findings, label);
            } else {
                findings.push({ step: label, skipped: true, reason: 'loop body missing in one or more demonstrations' });
            }
        }
    }
}

function _noop(base, reason) {
    return {
        skill: base,
        report: { demonstrationCount: Array.isArray(base?.steps) ? 1 : 0, paramsInferred: 0, applied: false, reason, findings: [] },
    };
}

/**
 * Diff 2+ skill demonstrations of the same task and promote varying literal
 * values into `${param.x}` placeholders.
 *
 * @param {object[]} skills - 2+ skill objects (same shape as compiler.js /
 *   generalize.js output), each with a `.steps` array. `skills[0]` is used
 *   as the structural template for the returned skill (name/slug/etc).
 * @returns {{ skill: object, report: object }} a NEW skill (input skills are
 *   never mutated) plus a report describing every inferred param and any
 *   steps/fields that were skipped and why.
 */
function inferParams(skills) {
    if (!Array.isArray(skills) || skills.length < 2) {
        throw new Error('inferParams requires at least 2 skill demonstrations to diff');
    }
    const base = skills[0];
    if (!base || !Array.isArray(base.steps)) {
        throw new Error('inferParams: invalid base skill (expected .steps array)');
    }
    for (const s of skills) {
        if (!s || !Array.isArray(s.steps)) return _noop(base, 'one or more demonstrations has no .steps array');
    }
    if (!skills.every(s => s.steps.length === base.steps.length)) {
        return _noop(base, `demonstrations have differing step counts (${skills.map(s => s.steps.length).join(', ')}) — record demonstrations of the same task to enable parameter inference`);
    }

    const newSteps = JSON.parse(JSON.stringify(base.steps));
    const paramsMap = new Map((base.params || []).map(p => [p.name, p]));
    const usedNames = new Set(paramsMap.keys());
    const findings = [];

    _processLevel(newSteps, skills.map(s => s.steps), paramsMap, usedNames, findings, '');

    const paramsInferred = findings.filter(f => f.param).length;
    return {
        skill: {
            ...base,
            steps: newSteps,
            params: Array.from(paramsMap.values()),
            metadata: {
                ...base.metadata,
                paramsInferred,
                paramInferenceSourceCount: skills.length,
            },
        },
        report: {
            demonstrationCount: skills.length,
            paramsInferred,
            applied: paramsInferred > 0,
            findings,
        },
    };
}

module.exports = {
    inferParams,
    _collectLeaves,
    _getAtPath,
    _setAtPath,
    _isIgnoredPath,
    _uniqueParamName,
};
