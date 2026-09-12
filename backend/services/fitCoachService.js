/**
 * fitCoachService.js — turns a /fit athlete's logged data into training advice.
 *
 * Split in two on purpose:
 *
 *   1. **Pure functions** — payload normalisation, red-flag screening, prompt
 *      assembly, and response parsing. No AWS, no Express, no clock. These are
 *      the parts worth testing, and they are the parts that decide whether the
 *      feature is safe.
 *   2. **`getCoachAdvice`** — one LLM call, with the completion function
 *      injected so tests can drive it without Bedrock.
 *
 * Safety posture (this is a fitness feature that accepts pain reports, so it
 * needs one):
 *   - Red-flag symptoms short-circuit *before* the model is called. A
 *     language model must never get a chance to soften "chest pain".
 *   - Pain at or above `SEE_A_PROFESSIONAL_SEVERITY` also short-circuits.
 *   - The system prompt forbids diagnosis and forbids advising anyone to train
 *     through sharp pain.
 *   - Every response carries `HEALTH_DISCLAIMER`, appended server-side so a
 *     model that forgets it can't strip it.
 */

const { logger } = require('../utils/logger');

const HEALTH_DISCLAIMER =
    'This is general training information, not medical advice. Fit is not a doctor, ' +
    'physiotherapist, or dietitian, and it cannot diagnose anything. Talk to a qualified ' +
    'health professional before starting a new programme, and stop immediately if something ' +
    'hurts — especially if the pain is sharp, sudden, or getting worse.';

/** Pain at or above this (self-reported 0–10) leaves the training lane entirely. */
const SEE_A_PROFESSIONAL_SEVERITY = 7;

/**
 * Symptoms that must never be answered with training advice. Each entry is a
 * plain-language phrase paired with how it should be described back.
 */
const RED_FLAGS = [
    // Stems end in `\w*` or an explicit inflected form, because `\bnumb\b`
    // does not match "numbness" — and a screening rule that only catches the
    // exact word you happened to think of is worse than useless.
    { pattern: /\bchest (pain|tightness|pressure)\b/i, label: 'chest pain or pressure' },
    { pattern: /\b(shortness of breath|can'?t breathe|breathless)\w*/i, label: 'breathlessness' },
    { pattern: /\b(faint\w*|passed out|black(ed)? out|dizzy spell\w*)/i, label: 'fainting or blackouts' },
    { pattern: /\b(numb|numbness|numbed|tingl\w*|pins and needles)\b/i, label: 'numbness or tingling' },
    { pattern: /\b(radiat\w*|shooting|travels? down|down the (arm|leg))\b/i, label: 'pain radiating down a limb' },
    { pattern: /\b(gives? way|gave way|buckl\w*|instabilit\w*)/i, label: 'a joint giving way' },
    { pattern: /\b(wakes? me|waking me|night pain)\b/i, label: 'pain that wakes you at night' },
    { pattern: /\b(swell\w*|swollen)\b.{0,40}\b(fever|hot|red|warm)\w*/i, label: 'swelling with heat or fever' },
    { pattern: /\b(lost|los(e|ing)) (weight|feeling)\b|\bunexplained weight loss\b/i, label: 'unexplained weight loss' },
    { pattern: /\b(fell|fell over|collision|car accident|twisted my)\b/i, label: 'pain after a fall or impact' },
    { pattern: /\b(blood in|bloody)\b/i, label: 'blood' },
    { pattern: /\bpregnan\w*/i, label: 'pregnancy' },
    { pattern: /\b(heart condition|cardiac|pacemaker|aneurysm|blood clot|dvt)\b/i, label: 'a diagnosed heart or clotting condition' },
    { pattern: /\b(concussion|head injury|hit my head)\b/i, label: 'a head injury' },
];

const LIMITS = {
    text: 200,
    notes: 800,
    sessions: 20,
    runs: 20,
    checkIns: 30,
    planDays: 6,
    planItems: 12,
    adjustments: 6,
    bullets: 5,
};

// ── Normalisation ────────────────────────────────────────────────────────
function str(value, max = LIMITS.text) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function num(value, { min = -Infinity, max = Infinity, fallback = null } = {}) {
    // `Number(null)` is 0 and `Number('')` is 0, so "not provided" would
    // silently become a real-looking zero (a 0/10 pain score, a 0 km run).
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** A plain body measurement: positive or unknown — never a clamped nonsense value. */
function positive(value, { min, max } = {}) {
    const raw = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(raw) || raw <= 0) return null;
    return Math.min(max, Math.max(min, raw));
}

function list(value, cap) {
    return Array.isArray(value) ? value.slice(0, cap) : [];
}

/**
 * Coerce whatever the client sent into a bounded, predictable shape.
 *
 * Everything the prompt is built from passes through here, so a malicious or
 * buggy client can't stuff unbounded text into the model's context (and can't
 * blow up the token estimate the credit gate runs on).
 */
function normalizePayload(raw = {}) {
    const profile = raw.profile || {};
    const lifts = profile.lifts || {};
    const pain = raw.pain || {};

    return {
        profile: {
            goal: str(profile.goal, 24),
            level: str(profile.level, 24),
            daysPerWeek: num(profile.daysPerWeek, { min: 1, max: 7, fallback: null }),
            sessionMinutes: num(profile.sessionMinutes, { min: 10, max: 180, fallback: null }),
            equipment: list(profile.equipment, 8).map((e) => str(e, 24)).filter(Boolean),
            units: profile.units === 'lb' ? 'lb' : 'kg',
            heightCm: positive(profile.heightCm, { min: 90, max: 260 }),
            bodyWeight: positive(profile.bodyWeight, { min: 20, max: 400 }),
            // Only the five reference lifts are meaningful, and each is a weight.
            lifts: ['bench', 'squat', 'deadlift', 'ohp', 'row'].reduce((acc, key) => {
                const entry = lifts[key];
                const weight = num(entry && typeof entry === 'object' ? entry.weight : entry, {
                    min: 0,
                    max: 1000,
                    fallback: null,
                });
                const reps = num(entry && typeof entry === 'object' ? entry.reps : null, {
                    min: 1,
                    max: 30,
                    fallback: null,
                });
                if (weight) acc[key] = { weight, reps: reps || 5 };
                return acc;
            }, {}),
        },
        plan: {
            days: list(raw.plan && raw.plan.days, LIMITS.planDays).map((day) => ({
                name: str(day && day.name, 40),
                focus: str(day && day.focus, 80),
                items: list(day && day.items, LIMITS.planItems).map((item) => ({
                    name: str(item && item.name, 60),
                    prescription: str(item && item.prescription, 40),
                    load: str(item && item.load, 32),
                })),
            })),
        },
        sessions: list(raw.sessions, LIMITS.sessions).map((s) => ({
            date: str(s && s.date, 24),
            dayName: str(s && s.dayName, 40),
            sets: num(s && s.sets, { min: 0, max: 500, fallback: 0 }),
            volume: num(s && s.volume, { min: 0, max: 500000, fallback: 0 }),
            cardioMinutes: num(s && s.cardioMinutes, { min: 0, max: 600, fallback: 0 }),
            rpe: str(s && s.rpe, 4),
            notes: str(s && s.notes, LIMITS.notes),
        })),
        runs: list(raw.runs, LIMITS.runs).map((r) => ({
            date: str(r && r.date, 24),
            distance: num(r && r.distance, { min: 0, max: 200, fallback: null }),
            unit: r && r.unit === 'mi' ? 'mi' : 'km',
            minutes: num(r && r.minutes, { min: 0, max: 1440, fallback: null }),
            effort: num(r && r.effort, { min: 0, max: 10, fallback: null }),
            pain: str(r && r.pain, LIMITS.notes),
        })),
        checkIns: list(raw.checkIns, LIMITS.checkIns).map((c) => ({
            date: str(c && c.date, 24),
            weight: positive(c && c.weight, { min: 20, max: 400 }),
        })).filter((c) => c.weight),
        pain: {
            area: str(pain.area, 32),
            severity: num(pain.severity, { min: 0, max: 10, fallback: null }),
            timing: str(pain.timing, 40),
            notes: str(pain.notes, LIMITS.notes),
        },
        question: str(raw.question, LIMITS.notes),
    };
}

// ── Red-flag screening ───────────────────────────────────────────────────
/**
 * Scan free text for symptoms that rule out training advice.
 *
 * Deliberately blunt: false positives here cost a doctor's visit, false
 * negatives cost an injury.
 */
function detectRedFlags(payload) {
    const haystack = [payload.pain.notes, payload.question, ...payload.sessions.map((s) => s.notes), ...payload.runs.map((r) => r.pain)]
        .filter(Boolean)
        .join(' \n ');

    const found = [];
    RED_FLAGS.forEach((flag) => {
        if (flag.pattern.test(haystack) && !found.includes(flag.label)) found.push(flag.label);
    });
    return found;
}

const PROFESSIONAL_RESPONSE = {
    summary:
        'Hold off on training advice — what you have described is something a health professional should look at first.',
    loadAdjustments: [],
    running: '',
    recovery: [
        'Keep moving gently if it is comfortable — walking and easy range of motion usually beat total rest.',
        'Do not train through sharp pain, and avoid loading the area until you have been assessed.',
    ],
    watchOuts: ['Symptoms that get worse, or that appear during everyday activity, need prompt attention.'],
    seeAProfessional: true,
    seeAProfessionalReason: '',
};

// ── Prompt ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the training advisor inside "Fit", a Push/Pull/Legs workout generator and tracker.

You are NOT a doctor, physiotherapist, or dietitian. You never diagnose, never name a condition as though it were confirmed, and never tell anyone to train through sharp pain.

Rules you must follow:
- Base every recommendation on the athlete's own logged data. If the data is thin, say what to log first instead of guessing.
- Load changes are small and specific: suggest a weight, a range, or a deload — keep changes under about 10%.
- If pain is reported, respect it: work around it, reduce load or range, or swap the movement. Never "push through".
- Cardio advice must fit the lifting: easy work never competes with a hard leg day, and weekly distance grows by at most about 10%.
- Be concrete and brief. No motivational filler, no emojis, no markdown headings.
- Reply with ONLY a JSON object, no prose around it and no code fences:
{"summary":"2-4 sentences on the single most important thing to change","loadAdjustments":[{"exercise":"name","suggestion":"specific change"}],"running":"1-2 sentences on running or cardio","recovery":["short actionable bullet"],"watchOuts":["short bullet"],"seeAProfessional":false,"seeAProfessionalReason":""}`;

function describeProfile(profile) {
    const lines = [
        `Goal: ${profile.goal || 'not set'}`,
        `Experience: ${profile.level || 'not set'}`,
        `Days per week: ${profile.daysPerWeek ?? 'not set'}`,
        `Time per session: ${profile.sessionMinutes ? `${profile.sessionMinutes} min` : 'not set'}`,
        `Equipment: ${profile.equipment.length ? profile.equipment.join(', ') : 'not set'}`,
        `Units: ${profile.units}`,
    ];
    if (profile.heightCm) lines.push(`Height: ${profile.heightCm} cm`);
    if (profile.bodyWeight) lines.push(`Body weight: ${profile.bodyWeight} ${profile.units}`);

    const liftKeys = Object.keys(profile.lifts);
    if (liftKeys.length) {
        lines.push(
            `Known working sets: ${liftKeys
                .map((k) => `${k} ${profile.lifts[k].weight} ${profile.units} × ${profile.lifts[k].reps}`)
                .join(', ')}`
        );
    } else {
        lines.push('Known working sets: none provided');
    }
    return lines.join('\n');
}

function describePlan(plan) {
    if (!plan.days.length) return 'No plan has been generated yet.';
    return plan.days
        .map((day) => {
            const items = day.items.map((i) => `${i.name} ${i.prescription}${i.load ? ` @ ${i.load}` : ''}`).join('; ');
            return `- ${day.name} (${day.focus}): ${items || 'no movements listed'}`;
        })
        .join('\n');
}

function describeSessions(sessions) {
    if (!sessions.length) return 'No sessions logged yet.';
    return sessions
        .map(
            (s) =>
                `- ${s.date} ${s.dayName}: ${s.sets} sets, ${s.volume} volume, ${s.cardioMinutes} min cardio` +
                `${s.rpe ? `, RPE ${s.rpe}` : ''}${s.notes ? ` — notes: ${s.notes}` : ''}`
        )
        .join('\n');
}

function describeRuns(runs) {
    if (!runs.length) return 'No runs logged yet.';
    return runs
        .map(
            (r) =>
                `- ${r.date}: ${r.distance ?? '?'} ${r.unit} in ${r.minutes ?? '?'} min` +
                `${r.effort !== null ? `, effort ${r.effort}/10` : ''}${r.pain ? ` — pain: ${r.pain}` : ''}`
        )
        .join('\n');
}

function describeCheckIns(checkIns) {
    if (!checkIns.length) return 'No body-weight check-ins yet.';
    return checkIns.map((c) => `- ${c.date}: ${c.weight}`).join('\n');
}

function describePain(pain) {
    if (pain.area === 'none' || (!pain.area && pain.severity === null && !pain.notes)) return 'Nothing reported.';
    return [
        pain.area ? `Area: ${pain.area}` : null,
        pain.severity !== null ? `Severity: ${pain.severity}/10` : null,
        pain.timing ? `When: ${pain.timing}` : null,
        pain.notes ? `Notes: ${pain.notes}` : null,
    ]
        .filter(Boolean)
        .join('\n');
}

function buildCoachMessages(payload) {
    const user = [
        'ATHLETE',
        describeProfile(payload.profile),
        '',
        'CURRENT WEEK',
        describePlan(payload.plan),
        '',
        `RECENT SESSIONS (most recent first, ${payload.sessions.length})`,
        describeSessions(payload.sessions),
        '',
        'RECENT RUNS',
        describeRuns(payload.runs),
        '',
        'BODY WEIGHT CHECK-INS',
        describeCheckIns(payload.checkIns),
        '',
        'PAIN REPORT',
        describePain(payload.pain),
    ];

    if (payload.question) {
        user.push('', 'ATHLETE QUESTION', payload.question);
    }
    user.push('', 'What is the one change that would help most right now?');

    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user.join('\n') },
    ];
}

// ── Response parsing ─────────────────────────────────────────────────────
/** Pull the first balanced JSON object out of a model reply. */
function extractJson(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
        const ch = cleaned[i];
        if (escaped) {
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (ch === '"') {
            inString = !inString;
        } else if (!inString && ch === '{') {
            depth += 1;
        } else if (!inString && ch === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(cleaned.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function bulletList(value, cap = LIMITS.bullets) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => str(typeof v === 'string' ? v : v && v.text, LIMITS.notes)).filter(Boolean).slice(0, cap);
}

/**
 * Coerce a model reply into the response contract. A reply that isn't JSON at
 * all still becomes a usable `summary` rather than an error — the athlete
 * asked a question and deserves an answer, not a parser stack trace.
 */
function parseCoachAdvice(raw) {
    const parsed = extractJson(raw);

    if (!parsed || typeof parsed !== 'object') {
        const text = str(raw, 1200);
        if (!text) return null;
        return {
            summary: text,
            loadAdjustments: [],
            running: '',
            recovery: [],
            watchOuts: [],
            seeAProfessional: false,
            seeAProfessionalReason: '',
        };
    }

    const loadAdjustments = list(parsed.loadAdjustments, LIMITS.adjustments)
        .map((entry) => ({
            exercise: str(entry && entry.exercise, 60),
            suggestion: str(entry && entry.suggestion, LIMITS.notes),
        }))
        .filter((entry) => entry.exercise && entry.suggestion);

    const advice = {
        summary: str(parsed.summary, 1200),
        loadAdjustments,
        running: str(parsed.running, LIMITS.notes),
        recovery: bulletList(parsed.recovery),
        watchOuts: bulletList(parsed.watchOuts),
        seeAProfessional: Boolean(parsed.seeAProfessional),
        seeAProfessionalReason: str(parsed.seeAProfessionalReason, LIMITS.notes),
    };

    // A reply with nothing usable in it is a failed reply.
    const hasContent =
        advice.summary || advice.running || advice.loadAdjustments.length || advice.recovery.length || advice.watchOuts.length;
    return hasContent ? advice : null;
}

// ── The call ─────────────────────────────────────────────────────────────
/**
 * Produce coaching advice for one athlete.
 *
 * `complete` is injected (defaults to Bedrock, then DeepSeek) so this is
 * testable without AWS. Returns `{ advice, provider, usage, screened }`.
 *
 * `screened: true` means red flags were detected and the model was never
 * called — the response is deterministic and the caller should not bill for it.
 */
async function getCoachAdvice(rawPayload, { complete } = {}) {
    const payload = normalizePayload(rawPayload);

    const flags = detectRedFlags(payload);
    const severePain = payload.pain.severity !== null && payload.pain.severity >= SEE_A_PROFESSIONAL_SEVERITY;

    if (flags.length || severePain) {
        const reason = flags.length
            ? `You mentioned ${flags.join(', ')}.`
            : `You rated the pain ${payload.pain.severity}/10.`;
        logger.info(`[fit-coach] screened without an LLM call (${flags.length} flag(s), severe=${severePain})`);
        return {
            advice: { ...PROFESSIONAL_RESPONSE, seeAProfessionalReason: reason },
            provider: 'screened',
            usage: null,
            screened: true,
        };
    }

    const messages = buildCoachMessages(payload);
    const runCompletion = complete || defaultComplete;
    const response = await runCompletion(messages);
    const raw = response?.choices?.[0]?.message?.content || '';
    const advice = parseCoachAdvice(raw);

    if (!advice) throw new Error('Coach returned no usable advice');

    return { advice, provider: response?.provider || 'llm', usage: response?.usage || null, screened: false };
}

/** Bedrock first, then DeepSeek — the same order the rest of the backend uses. */
async function defaultComplete(messages) {
    const { createBedrockCompletion } = require('./bedrockService');
    const { createCompletion, PROVIDERS } = require('../utils/llmProviders');

    try {
        const response = await createBedrockCompletion(messages, { maxTokens: 700, temperature: 0.4 });
        return { ...response, provider: 'bedrock' };
    } catch (err) {
        logger.warn('[fit-coach] Bedrock failed, trying DeepSeek:', err.message);
    }

    if (PROVIDERS.deepseek.apiKey) {
        try {
            const response = await createCompletion('deepseek', 'deepseek-chat', messages, {
                maxTokens: 700,
                temperature: 0.4,
            });
            return { ...response, provider: 'deepseek' };
        } catch (err) {
            logger.warn('[fit-coach] DeepSeek failed:', err.message);
        }
    }

    throw new Error('All LLM providers failed');
}

module.exports = {
    HEALTH_DISCLAIMER,
    SEE_A_PROFESSIONAL_SEVERITY,
    RED_FLAGS,
    PROFESSIONAL_RESPONSE,
    SYSTEM_PROMPT,
    LIMITS,
    normalizePayload,
    detectRedFlags,
    buildCoachMessages,
    extractJson,
    parseCoachAdvice,
    describeProfile,
    describePlan,
    describeSessions,
    describeRuns,
    describeCheckIns,
    describePain,
    getCoachAdvice,
};
