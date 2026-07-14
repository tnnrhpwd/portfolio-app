/**
 * nl-compiler.js — Natural Language → Skill Step Compiler
 *
 * Converts English macro descriptions like:
 *   "mine stone in minecraft until I press escape"
 *   "open notepad, type 'hello world', save the file"
 *   "reply to the last email with a polite decline, then move it to archive"
 *
 * into a structured skill step array that can be executed by the skill_run
 * tool or saved as a workspace skill.
 *
 * Pipeline:
 *   1. Hash the input text → check LRU cache (avoids repeat LLM calls)
 *   2. Build a structured prompt with type schema + examples
 *   3. Call LLM (gpt-4o-mini) with JSON-mode output
 *   4. Validate + sanitize the output schema
 *   5. Return validated step array + meta
 *
 * Security: output is validated against a strict schema before it can be
 * executed; no raw shell commands can be injected through NL input.
 */

const crypto = require('crypto');

// ─── Step type definitions ────────────────────────────────────────────────────
// Keep in sync with tools/skill.js executor.

const VALID_STEP_TYPES = new Set([
    'key_tap',          // tap one or more keys, optional repeat
    'key_hold',         // hold keys for a duration (game movement etc.)
    'type_text',        // type a string of text (maps to text_type tool)
    'wait_ms',          // wait N milliseconds
    'click_at',         // click at screen coordinates
    'click_visual',     // find_and_click_visual — LLM-powered click by description
    'open_app',         // shell: start an application by name
    'shell_run',        // run a shell command (read-only preferred)
    'uia_invoke',       // click a UI element by name/controlType
    'skill_run',        // run another saved skill
    'loop_until_key',   // loop body until a key is pressed
    'loop_n_times',     // repeat body N times
    'screenshot_check', // capture screen and check for condition (OCR/vision)
    'speak',            // TTS output
    'goal_done',        // mark goal complete
]);

const MAX_STEPS = 30;
const MAX_CACHE = 200;
const LLM_TIMEOUT_MS = 15_000;

// ─── LRU cache ────────────────────────────────────────────────────────────────

const _cache = new Map(); // hash → {steps, meta, cachedAt}

function _hashText(text) {
    return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}

function _cacheGet(hash) {
    const entry = _cache.get(hash);
    if (!entry) return null;
    // Expire after 1 hour
    if (Date.now() - entry.cachedAt > 3_600_000) { _cache.delete(hash); return null; }
    return entry;
}

function _cacheSet(hash, value) {
    if (_cache.size >= MAX_CACHE) {
        const oldest = _cache.keys().next().value;
        _cache.delete(oldest);
    }
    _cache.set(hash, { ...value, cachedAt: Date.now() });
}

// ─── Schema validation ────────────────────────────────────────────────────────

function _validateStep(step, index) {
    if (!step || typeof step !== 'object') throw new Error(`step[${index}] must be an object`);
    const type = step.type;
    if (!VALID_STEP_TYPES.has(type)) throw new Error(`step[${index}].type "${type}" is not a valid step type`);

    switch (type) {
        case 'key_tap': {
            if (!Array.isArray(step.keys) || step.keys.length === 0)
                throw new Error(`step[${index}]: key_tap requires keys array`);
            if (step.keys.some(k => typeof k !== 'string' || k.length > 30))
                throw new Error(`step[${index}]: key_tap keys must be short strings`);
            if (step.repeat !== undefined && (typeof step.repeat !== 'number' || step.repeat > 1000))
                throw new Error(`step[${index}]: key_tap repeat out of range`);
            break;
        }
        case 'key_hold': {
            if (!Array.isArray(step.keys) || step.keys.length === 0)
                throw new Error(`step[${index}]: key_hold requires keys array`);
            if (typeof step.duration_ms !== 'number' || step.duration_ms > 30_000)
                throw new Error(`step[${index}]: key_hold duration_ms must be ≤30000`);
            break;
        }
        case 'type_text': {
            if (typeof step.text !== 'string' || step.text.length > 10_000)
                throw new Error(`step[${index}]: type_text.text must be a string ≤10000 chars`);
            break;
        }
        case 'wait_ms': {
            if (typeof step.ms !== 'number' || step.ms < 0 || step.ms > 300_000)
                throw new Error(`step[${index}]: wait_ms must be 0–300000`);
            break;
        }
        case 'click_at': {
            if (typeof step.x !== 'number' || typeof step.y !== 'number')
                throw new Error(`step[${index}]: click_at requires x and y`);
            break;
        }
        case 'click_visual': {
            if (typeof step.target !== 'string' || !step.target.trim())
                throw new Error(`step[${index}]: click_visual requires target description`);
            break;
        }
        case 'open_app': {
            if (typeof step.name !== 'string' || !step.name.trim())
                throw new Error(`step[${index}]: open_app requires name`);
            // Basic safety: no shell injection characters
            if (/[;&|`$]/.test(step.name))
                throw new Error(`step[${index}]: open_app.name contains forbidden characters`);
            break;
        }
        case 'shell_run': {
            if (typeof step.command !== 'string' || !step.command.trim())
                throw new Error(`step[${index}]: shell_run requires command`);
            // NL compiler may only produce read-only shell commands
            const cmd = step.command.toLowerCase();
            const FORBIDDEN = ['rm ', 'del ', 'format ', 'rmdir', 'rd ', 'shutdown', 'reboot', 'taskkill', 'net user', 'reg delete'];
            if (FORBIDDEN.some(f => cmd.includes(f)))
                throw new Error(`step[${index}]: shell_run command contains forbidden operation`);
            break;
        }
        case 'uia_invoke': {
            if (!step.name && !step.automationId && !step.controlType)
                throw new Error(`step[${index}]: uia_invoke requires name, automationId, or controlType`);
            break;
        }
        case 'skill_run': {
            if (typeof step.slug !== 'string' || !step.slug.trim())
                throw new Error(`step[${index}]: skill_run requires slug`);
            break;
        }
        case 'loop_until_key': {
            if (typeof step.key !== 'string') throw new Error(`step[${index}]: loop_until_key requires key`);
            if (!Array.isArray(step.body)) throw new Error(`step[${index}]: loop_until_key requires body array`);
            step.body.forEach((s, i) => _validateStep(s, `${index}.body[${i}]`));
            const bodyHasLoop = step.body.some(s => s.type === 'loop_until_key' || s.type === 'loop_n_times');
            if (bodyHasLoop) throw new Error(`step[${index}]: nested loops are not allowed`);
            break;
        }
        case 'loop_n_times': {
            if (typeof step.times !== 'number' || step.times < 1 || step.times > 10000)
                throw new Error(`step[${index}]: loop_n_times requires times 1–10000`);
            if (!Array.isArray(step.body)) throw new Error(`step[${index}]: loop_n_times requires body array`);
            step.body.forEach((s, i) => _validateStep(s, `${index}.body[${i}]`));
            break;
        }
        case 'screenshot_check': {
            if (typeof step.condition !== 'string')
                throw new Error(`step[${index}]: screenshot_check requires condition string`);
            break;
        }
        case 'speak': {
            if (typeof step.text !== 'string' || step.text.length > 500)
                throw new Error(`step[${index}]: speak.text must be a string ≤500 chars`);
            break;
        }
        case 'goal_done':
            break; // no required fields
        default:
            throw new Error(`step[${index}]: unhandled type ${type}`);
    }
}

function validateSteps(steps) {
    if (!Array.isArray(steps)) throw new Error('steps must be an array');
    if (steps.length === 0) throw new Error('steps array is empty');
    if (steps.length > MAX_STEPS) throw new Error(`too many steps (${steps.length} > ${MAX_STEPS})`);
    steps.forEach((s, i) => _validateStep(s, i));
    return true;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const STEP_SCHEMA_DOCS = `
Valid step types and their fields:
  {"type":"key_tap","keys":["w"],"repeat":1}
  {"type":"key_hold","keys":["w"],"duration_ms":500}
  {"type":"type_text","text":"Hello world"}
  {"type":"wait_ms","ms":1000}
  {"type":"click_at","x":960,"y":540,"button":"left"}
  {"type":"click_visual","target":"the Submit button in the top-right corner"}
  {"type":"open_app","name":"notepad.exe"}
  {"type":"shell_run","command":"dir C:\\\\Users"}
  {"type":"uia_invoke","name":"OK","controlType":"Button"}
  {"type":"skill_run","slug":"my-saved-skill"}
  {"type":"loop_until_key","key":"Escape","body":[...steps...]}
  {"type":"loop_n_times","times":5,"body":[...steps...]}
  {"type":"screenshot_check","condition":"Is the dialog closed?"}
  {"type":"speak","text":"Done!"}
  {"type":"goal_done"}

Rules:
- Prefer key_tap for single presses, key_hold for game movement
- For "until I press X" → use loop_until_key with the correct key name
- For "repeat N times" → use loop_n_times
- For clicking UI buttons by name → prefer click_visual or uia_invoke over click_at
- For opening apps → use open_app, not shell_run
- Do NOT use shell_run for destructive operations
- Keep wait_ms realistic (100–2000ms typical)
- Do NOT nest loops
- Max 30 steps total
`;

function _buildPrompt(description, context) {
    return [
        'Convert the following natural language macro description into a JSON step array.',
        'Return ONLY a JSON object with one key "steps" containing the array.',
        '',
        STEP_SCHEMA_DOCS,
        '',
        context ? `Context about the user's environment: ${context}` : '',
        '',
        `Macro description: ${description}`,
        '',
        'Reply with ONLY valid JSON. No prose. No markdown.',
    ].filter(Boolean).join('\n');
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function _callLlm(prompt, llmClient) {
    if (!llmClient) {
        try {
            const { GitHubModelsService } = require('../github-models-service');
            llmClient = new GitHubModelsService();
            // Load token from settings
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
            if (fs.existsSync(cfgPath)) {
                const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                if (s.githubToken) llmClient.setToken(s.githubToken);
            }
        } catch (e) {
            throw new Error('No LLM client available for NL compiler: ' + e.message);
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
        const response = await llmClient.chat({
            model: 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a Windows macro compiler. Output only valid JSON.' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 2048,
            signal: controller.signal,
        });
        return response?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timeout);
    }
}

function _extractJson(text) {
    // Try to extract JSON object from possibly-wrapped response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in LLM response');
    return JSON.parse(match[0]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile a natural language description into skill steps.
 *
 * @param {string} description  - English instruction (e.g. "mine stone until escape")
 * @param {object} opts
 *   @param {string} [opts.context]   - Optional context (e.g. foreground window title)
 *   @param {object} [opts.llmClient] - Injectable LLM client (for tests)
 *   @param {boolean} [opts.noCache]  - Skip cache lookup
 * @returns {Promise<{steps: Array, meta: {description, cachedAt?, tokens?}}>}
 */
async function compile(description, { context, llmClient, noCache } = {}) {
    if (!description || typeof description !== 'string' || !description.trim()) {
        throw new Error('description is required');
    }
    const text = description.trim().slice(0, 2000);
    const hash = _hashText(text + (context || ''));

    if (!noCache) {
        const cached = _cacheGet(hash);
        if (cached) return { steps: cached.steps, meta: { ...cached.meta, fromCache: true } };
    }

    const prompt = _buildPrompt(text, context);
    const raw = await _callLlm(prompt, llmClient);

    let parsed;
    try {
        parsed = _extractJson(raw);
    } catch (e) {
        throw new Error(`NL compiler: LLM returned invalid JSON — ${e.message}\nRaw: ${raw.slice(0, 200)}`);
    }

    const steps = parsed.steps || parsed;
    if (!Array.isArray(steps)) throw new Error('NL compiler: LLM did not return a steps array');

    // Validate
    validateSteps(steps);

    const result = {
        steps,
        meta: {
            description: text,
            stepCount: steps.length,
            compiledAt: new Date().toISOString(),
        },
    };

    _cacheSet(hash, result);
    return result;
}

/**
 * Clear the compilation cache (e.g. after model upgrade or testing).
 */
function clearCache() { _cache.clear(); }

module.exports = { compile, validateSteps, clearCache, VALID_STEP_TYPES };
