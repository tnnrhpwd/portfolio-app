/**
 * scrub.js — Privacy / PII scrub pass for the marketplace publish flow.
 *
 * Implements docs/new/csimple-agent-prompt.md §6.1: recordings capture
 * screen state, keystrokes, and window titles from the author's own
 * machine, so a raw compiled/generalized skill can embed absolute user file
 * paths, secrets typed during the demo, or (if a future step type ever
 * carries one) a raw screenshot payload. Publishing a skill to the
 * marketplace MUST NOT leak any of that — this module is the mandatory
 * scrub pass that must run before a skill can be published (§4.2
 * `POST /api/market/skills`, not yet built — see index.js `/api/skill/scrub`
 * for the standalone preview endpoint used today).
 *
 * `scrubForPublish(skill)` returns `{ skill, report }`:
 *   - `skill`  — a NEW skill object (never mutates the input) with every
 *     absolute Windows user-profile path promoted to `${param.userProfile}`
 *     (added to `skill.params`, reusing the existing `substituteArgs`
 *     mechanism in `tools/skill.js`), secret-shaped strings redacted, and
 *     any image/screenshot-shaped value dropped.
 *   - `report` — `{ scrubbedAt, findingCount, clean, findings[] }`. Findings
 *     intentionally never include the original sensitive value (not even
 *     truncated) — only a `kind` + human-readable `note` — so the report
 *     itself can safely be shown to the author as the "what will be shared"
 *     pre-publish review (§6.1) without becoming a second leak vector.
 *
 * This is intentionally conservative/heuristic: false positives (redacting
 * something harmless) are an acceptable cost; false negatives (a leaked
 * secret reaching the marketplace) are not.
 */

// Absolute Windows user-profile paths, e.g. C:\Users\tanne\Documents\...
const WINDOWS_USER_PATH_RE = /[A-Za-z]:\\Users\\[^\\/:*?"<>|]+(?:\\[^\\/:*?"<>|]+)*/g;

// Common secret/token shapes. Matched with a fresh RegExp per call (avoids
// stateful `lastIndex` bugs from reusing a global-flag regex across calls).
const SECRET_PATTERNS = [
    { name: 'github-token', re: () => /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
    { name: 'aws-access-key', re: () => /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'slack-token', re: () => /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'google-api-key', re: () => /\bAIza[0-9A-Za-z\-_]{35}\b/g },
    { name: 'bearer-token', re: () => /\bBearer\s+[A-Za-z0-9._\-]{15,}\b/gi },
    { name: 'jwt', re: () => /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
    { name: 'openai-key', re: () => /\bsk-[A-Za-z0-9]{20,}\b/g },
];

// Arg key NAMES that always get dropped regardless of content — these are
// the natural home for a raw screenshot/frame payload if a future step type
// ever carries one (defense in depth; the current recorder does not emit
// these, see compiler.js).
const IMAGE_LIKE_KEY_RE = /^(screenshot|image|frame|dataurl|imagedata|thumbnail|snapshot)$/i;

// Values that look like an inline image regardless of the key name.
const DATA_URL_RE = /^data:image\//i;
const MAX_INLINE_STRING_LEN = 20_000; // beyond this, treat as binary-ish and drop

function _scrubString(str, paramsMap, findings, stepLabel, fieldLabel) {
    if (typeof str !== 'string') return str;

    if (DATA_URL_RE.test(str) || str.length > MAX_INLINE_STRING_LEN) {
        findings.push({ step: stepLabel, field: fieldLabel, kind: 'image', note: 'inline image/binary payload removed' });
        return '[SCREENSHOT REMOVED]';
    }

    let out = str;

    if (WINDOWS_USER_PATH_RE.test(out)) {
        out = out.replace(WINDOWS_USER_PATH_RE, '${param.userProfile}');
        findings.push({ step: stepLabel, field: fieldLabel, kind: 'path', note: 'Windows user-profile path replaced with ${param.userProfile}' });
        if (!paramsMap.has('userProfile')) {
            paramsMap.set('userProfile', { name: 'userProfile', description: 'Path to a user profile directory', type: 'string' });
        }
    }

    for (const { name, re } of SECRET_PATTERNS) {
        const pattern = re();
        if (pattern.test(out)) {
            out = out.replace(re(), '[REDACTED]');
            findings.push({ step: stepLabel, field: fieldLabel, kind: 'secret', note: `text matching a ${name} pattern was redacted` });
        }
    }

    return out;
}

function _scrubValue(value, stepLabel, fieldLabel, paramsMap, findings) {
    if (typeof value === 'string') return _scrubString(value, paramsMap, findings, stepLabel, fieldLabel);
    if (Array.isArray(value)) return value.map((v, i) => _scrubValue(v, stepLabel, `${fieldLabel}[${i}]`, paramsMap, findings));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (IMAGE_LIKE_KEY_RE.test(k)) {
                findings.push({ step: stepLabel, field: `${fieldLabel}.${k}`, kind: 'image', note: `key "${k}" is image-shaped — value dropped` });
                continue;
            }
            out[k] = _scrubValue(v, stepLabel, `${fieldLabel}.${k}`, paramsMap, findings);
        }
        return out;
    }
    return value;
}

function _scrubStep(step, stepLabel, paramsMap, findings) {
    if (!step || typeof step !== 'object') return step;
    const out = { ...step };
    if (out.args !== undefined) out.args = _scrubValue(out.args, stepLabel, 'args', paramsMap, findings);
    if (Array.isArray(out.body)) {
        out.body = out.body.map((s, i) => _scrubStep(s, `${stepLabel}.body[${i}]`, paramsMap, findings));
    }
    return out;
}

/**
 * Scrub a compiled/generalized skill for publishing.
 *
 * @param {object} skill - a skill object with a `.steps` array
 * @returns {{ skill: object, report: { scrubbedAt: number, findingCount: number, clean: boolean, findings: Array } }}
 */
function scrubForPublish(skill) {
    if (!skill || !Array.isArray(skill.steps)) {
        throw new Error('scrubForPublish: invalid skill (expected .steps array)');
    }

    const findings = [];
    const paramsMap = new Map((skill.params || []).map(p => [p.name, p]));

    const steps = skill.steps.map((step, i) => _scrubStep(step, `[${i}]`, paramsMap, findings));

    return {
        skill: {
            ...skill,
            steps,
            params: Array.from(paramsMap.values()),
        },
        report: {
            scrubbedAt: Date.now(),
            findingCount: findings.length,
            clean: findings.length === 0,
            findings,
        },
    };
}

module.exports = { scrubForPublish, IMAGE_LIKE_KEY_RE, WINDOWS_USER_PATH_RE };
