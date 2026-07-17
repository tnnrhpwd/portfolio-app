/**
 * marketplaceScrub.js — server-side re-enforcement of the privacy/PII scrub
 * pass (docs/new/csimple-agent-prompt.md §4.5, §6.1).
 *
 * §4.5's Definition of Done calls out that `publishSkill` "does not
 * independently re-run scrubForPublish/summarizeCapabilities server-side —
 * it trusts the caller to have already scrubbed steps client-side" via the
 * addon-local `POST /api/skill/scrub` route. That's a real gap: a malicious
 * or buggy client could call the backend's `POST /api/data/market/skills`
 * directly with unscrubbed steps, bypassing the addon entirely.
 *
 * This module is a DELIBERATE, INDEPENDENT PORT of
 * `csimple-addon/server/automation/recorder/scrub.js`'s `scrubForPublish`
 * (same detection patterns, same "never leak the original value into the
 * report" contract) — NOT a cross-project `require()` of the addon's copy.
 * Two reasons for duplicating rather than importing across the repo
 * boundary:
 *   1. `csimple-addon/` and `backend/` are deployed independently (the addon
 *      runs on the end-user's PC; the backend is packaged/deployed as this
 *      portfolio's server). Requiring a file from the addon's tree would
 *      make the backend's deploy artifact silently depend on a sibling
 *      project's presence/layout, which is fragile and easy to break with
 *      an unrelated addon-side refactor or exclusion from the deploy zip.
 *   2. `scrub.js` in the addon happens to have zero `require()`s of its own
 *      (pure string/regex transforms), which is exactly what makes this
 *      safe to fork as a small, self-contained backend copy instead.
 *
 * KEEP IN SYNC with `csimple-addon/server/automation/recorder/scrub.js` —
 * if you change the detection patterns there, mirror the change here too.
 * (A follow-up could extract both into a real shared npm package; out of
 * scope for this pass.)
 *
 * Server-side usage here is intentionally "belt and suspenders": the
 * backend re-runs the same scrub over whatever `steps` the client sent and
 * ALWAYS persists the re-scrubbed output (never the raw client-supplied
 * steps), regardless of whether the client already scrubbed. If the
 * server-side pass finds anything the client missed, that's surfaced back
 * to the caller as `scrubReport` on the publish response so the author
 * still gets the "what will be shared" visibility promised in §6.1 — it's
 * just enforced twice instead of trusted once.
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
// ever carries one (defense in depth).
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
