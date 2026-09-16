/**
 * goalReview.js — the "work on my goals" pass: read the goal list, propose
 * changes to it.
 *
 * The Map pass (`goalMap.js`) draws the goals you have. This one questions them:
 * a goal aimed at the wrong horizon, a long-term aim that has no steps under it,
 * a goal with no plan, a goal that implies another one. It is the difference
 * between a list you maintain by hand and a list that gets tidied.
 *
 * Everything the model returns is treated as untrusted and normalised here, for
 * the same reason the map is: asking for a shape is not enforcing it. A proposal
 * that names a goal which no longer exists, or asks for a horizon that isn't in
 * the vocabulary, is dropped rather than stored — a proposal the apply step can't
 * execute is worse than no proposal, because the user has to discover that.
 *
 * This module is PURE. It never touches DynamoDB, never calls a model, and never
 * writes: the caller (workspaceController.generateGoalReview) does all three.
 */

const { GOAL_HORIZONS } = require('./workspaceGoals');

// ── Limits ──────────────────────────────────────────────────────────────────

/** Goals sent to the model. The list is ranked, so the tail is the least useful. */
const GOAL_MAX = 60;
/** Proposals kept. A review nobody can read is a review nobody applies. */
const ITEM_MAX = 10;
/** Goals a single split may propose. A dream broken into 8 pieces is not a plan. */
const SPLIT_MAX = 4;
/** Steps a single plan may propose. */
const PLAN_STEP_MAX = 8;
/** Observations kept per review ("lessons"). */
const LESSON_MAX = 5;

const TITLE_MAX = 120;
const WHY_MAX = 240;
const TEXT_MAX = 400;
const STEP_MAX = 200;
const LESSON_MAX_TEXT = 280;

/** The proposal kinds, and what each one is allowed to carry. */
const PROPOSAL_KINDS = Object.freeze(['horizon', 'split', 'plan', 'new-goal']);

/** Kinds that create something new rather than editing an existing goal. */
const CREATING_KINDS = Object.freeze(['split', 'new-goal']);

/** Children of a split must be STARTABLE work: week or quarter, never another
 *  aim. A "break this down" proposal that returns three more life goals has
 *  achieved nothing. */
const CHILD_HORIZONS = GOAL_HORIZONS.slice(0, GOAL_HORIZONS.indexOf('quarter') + 1);

/**
 * Pick the goals worth reviewing when there are more than fit.
 *
 * Deliberately NOT the map's ranking: that one leads with whatever is `active`,
 * which is right for "draw my current work" and wrong here. A review is about the
 * list as a whole, so it leads with the goals that are hardest to get right — the
 * long-horizon aims (they need steps, not effort) and the ones with no horizon at
 * all (nothing has been decided about them) — then the ordinary live work, then
 * the finished tail.
 */
function selectGoalsForReview(goals, { max = GOAL_MAX } = {}) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    const rank = (g) => {
        if (g.status === 'done' || g.status === 'failed') return 3;
        if (g.horizon === 'year' || g.horizon === 'life') return 0; // aims: do they have a way in?
        if (!g.horizon) return 1;                                    // undecided
        return 2;                                                    // near-term, already scoped
    };
    const ordered = [...list].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (a.status === 'blocked' && b.status !== 'blocked') return -1;
        if (b.status === 'blocked' && a.status !== 'blocked') return 1;
        const pa = typeof a.priority === 'number' ? a.priority : 50;
        const pb = typeof b.priority === 'number' ? b.priority : 50;
        if (pa !== pb) return pb - pa;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    return {
        goals: ordered.slice(0, max),
        total: list.length,
        truncated: Math.max(0, list.length - max),
    };
}

/** One line per goal: enough to judge the horizon and to spot what's missing. */
function describeGoal(goal) {
    const bits = [
        `"${goal.name || goal.slug}"`,
        `slug ${goal.slug}`,
        goal.status || 'active',
        typeof goal.priority === 'number' ? `priority ${goal.priority}` : null,
        goal.horizon ? `horizon ${goal.horizon}` : 'horizon NONE',
        goal.parentGoalId ? `child of ${goal.parentGoalId}` : null,
        goal.targetDate ? `target ${goal.targetDate}` : null,
        // The plan is a separate item, but a goal whose text is a single line has
        // nothing to work from — that is the signal the `plan` proposal needs.
        goal.content ? `detail: ${String(goal.content).replace(/\s+/g, ' ').slice(0, 200)}` : 'detail: (none)',
    ].filter(Boolean);
    return `- ${bits.join(' | ')}`;
}

/** The prompt. Schema first, rules second, the data last. */
function buildGoalReviewPrompt(goals) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    return [
        "Review this person's goal list and propose concrete changes to it.",
        '',
        'Return ONLY this JSON shape:',
        '{"items":[{"kind":"horizon|split|plan|new-goal","goalSlug":"<existing slug, or omit for new-goal>","title":"<short, imperative>","why":"<one sentence>","patch":{}}],"lessons":["<observation>"]}',
        '',
        'Proposal kinds, and the ONLY patch each one may carry:',
        `- "horizon"  → patch: {"horizon":"${GOAL_HORIZONS.join('|')}"} — the goal is aimed at the wrong horizon.`,
        '  Only propose this when the goal\'s own words say so (a retirement aim sitting at "week", a chore sitting at "life").',
        `- "split"    → patch: {"children":[{"title":"…","horizon":"week|quarter","description":"…"}]} — the goal is a long-term AIM with no steps under it (horizon year/life). 1-${SPLIT_MAX} children, each something that can be started now.`,
        '  Never split a goal that already has children, and never split a near-term goal.',
        `- "plan"     → patch: {"steps":["…"]} — the goal has no detail to work from. 3-${PLAN_STEP_MAX} short steps.`,
        `- "new-goal" → patch: {"title":"…","horizon":"${GOAL_HORIZONS.join('|')}","description":"…"} — a goal that clearly follows from the list but is not on it. Omit "goalSlug".`,
        '',
        'Rules:',
        '- Use each goal\'s slug EXACTLY as given. Never invent one, and never propose more than one "horizon", "split" or "plan" for the same goal.',
        `- At most ${ITEM_MAX} proposals, most important first. Fewer is better: this is a change list, not a rewrite.`,
        '- Propose only changes that follow from the goals below. Do not invent ambitions the person never expressed.',
        '- "why" is one sentence, addressed to them, saying what is wrong now — not what the change does.',
        '- Put anything you NOTICED but cannot express as a change (a pattern, a repeated blocker) in "lessons": one short sentence each, at most ' + LESSON_MAX + '.',
        '- Reply with JSON only. No prose, no markdown fences.',
        '',
        `Goals (${list.length}):`,
        ...list.map(describeGoal),
    ].join('\n');
}

// ── Normalising the answer ──────────────────────────────────────────────────

function cleanText(value, max) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A stable id for a proposal, so staging one survives a re-render (and a
 *  re-generation of the same suggestion is recognisably the same suggestion). */
function proposalId(kind, goalSlug, index) {
    return `${kind}:${goalSlug || 'new'}:${index}`;
}

function normalizeChildren(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((child) => {
            const title = cleanText(child?.title, TITLE_MAX);
            if (!title) return null;
            return {
                title,
                horizon: CHILD_HORIZONS.includes(child?.horizon) ? child.horizon : 'quarter',
                description: cleanText(child?.description, TEXT_MAX),
            };
        })
        .filter(Boolean)
        .slice(0, SPLIT_MAX);
}

function normalizeSteps(raw) {
    return (Array.isArray(raw) ? raw : [])
        .map((step) => cleanText(typeof step === 'string' ? step : step?.text, STEP_MAX))
        .filter(Boolean)
        .slice(0, PLAN_STEP_MAX);
}

/**
 * One proposed item → the shape the panel renders and the apply step executes,
 * or null when it can't be executed.
 *
 * @param {object} raw   One entry of the model's `items` array (untrusted)
 * @param {Map} bySlug   The goals that actually exist, by slug
 * @param {number} index Position in the model's list (part of the id)
 */
function normalizeProposal(raw, bySlug, index) {
    const kind = PROPOSAL_KINDS.includes(raw?.kind) ? raw.kind : null;
    if (!kind) return null;

    const why = cleanText(raw?.why, WHY_MAX);
    const title = cleanText(raw?.title, TITLE_MAX);
    const patch = raw?.patch && typeof raw.patch === 'object' ? raw.patch : {};

    if (kind === 'new-goal') {
        const newTitle = cleanText(patch.title || title, TITLE_MAX);
        if (!newTitle) return null;
        return {
            id: proposalId(kind, null, index),
            kind,
            goalSlug: null,
            title: newTitle,
            why,
            patch: {
                title: newTitle,
                // A new goal with no horizon is a goal nobody will ever work on
                // deliberately; the model is told to pick one, and quarter is the
                // honest default when it doesn't.
                horizon: GOAL_HORIZONS.includes(patch.horizon) ? patch.horizon : 'quarter',
                description: cleanText(patch.description, TEXT_MAX),
            },
        };
    }

    const goalSlug = cleanText(raw?.goalSlug, 100);
    const goal = bySlug.get(goalSlug);
    // No goal, no proposal: applying it would either fail or hit the wrong goal.
    if (!goal) return null;

    if (kind === 'horizon') {
        const horizon = GOAL_HORIZONS.includes(patch.horizon) ? patch.horizon : null;
        // Only interesting when it actually changes something.
        if (!horizon || horizon === (goal.horizon || null)) return null;
        return {
            id: proposalId(kind, goalSlug, index),
            kind,
            goalSlug,
            goalName: goal.name || goalSlug,
            title: title || `Re-scope "${goal.name || goalSlug}" to ${horizon}`,
            why,
            patch: { horizon, from: goal.horizon || null },
        };
    }

    if (kind === 'split') {
        const children = normalizeChildren(patch.children);
        if (!children.length) return null;
        return {
            id: proposalId(kind, goalSlug, index),
            kind,
            goalSlug,
            goalName: goal.name || goalSlug,
            title: title || `Break "${goal.name || goalSlug}" into ${children.length} step${children.length === 1 ? '' : 's'}`,
            why,
            patch: { children },
        };
    }

    // kind === 'plan'
    const steps = normalizeSteps(patch.steps);
    if (steps.length < 2) return null;
    return {
        id: proposalId(kind, goalSlug, index),
        kind,
        goalSlug,
        goalName: goal.name || goalSlug,
        title: title || `Plan "${goal.name || goalSlug}"`,
        why,
        patch: { steps },
    };
}

/**
 * The model's answer → what the panel renders and the apply step executes.
 *
 * @param {object} raw      Parsed JSON from the model (any shape — not trusted)
 * @param {Array}  goals    The goals that were sent
 * @returns {{items: Array, lessons: Array, stats: object}}
 */
function normalizeGoalReview(raw, goals) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    const bySlug = new Map(list.map((g) => [g.slug, g]));

    const seen = new Set();
    const items = [];
    for (const [index, candidate] of (Array.isArray(raw?.items) ? raw.items : []).entries()) {
        const item = normalizeProposal(candidate, bySlug, index);
        if (!item) continue;
        // One change per goal per kind: the model sometimes restates itself, and
        // two "split this dream" cards would both create children.
        const key = `${item.kind}:${item.goalSlug || item.patch.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        if (items.length >= ITEM_MAX) break;
    }

    const lessons = (Array.isArray(raw?.lessons) ? raw.lessons : [])
        .map((text, i) => ({ id: `lesson:${i}`, text: cleanText(typeof text === 'string' ? text : text?.text, LESSON_MAX_TEXT) }))
        .filter((l) => l.text)
        .slice(0, LESSON_MAX);

    return {
        items,
        lessons,
        stats: {
            goalCount: list.length,
            proposalCount: items.length,
            newGoalCount: items.filter((i) => i.kind === 'new-goal').length,
            splitCount: items.filter((i) => i.kind === 'split').length,
        },
    };
}

/**
 * What applying a set of staged proposals would WRITE.
 *
 * Split out from the controller so the batch can be tested without DynamoDB, and
 * so the endpoint is a thin executor: it takes the writes this returns and makes
 * them. Anything it cannot resolve (a goal deleted since the review was stored) is
 * reported in `skipped` rather than silently dropped.
 *
 * @param {Array}  items   Staged proposals, in the order the user sees them
 * @param {Array}  goals   The current goals (the review may be hours old)
 * @returns {{writes: Array, skipped: Array}}
 */
function planReviewApplication(items, goals) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    const bySlug = new Map(list.map((g) => [g.slug, g]));
    const writes = [];
    const skipped = [];

    for (const item of Array.isArray(items) ? items : []) {
        if (!item || typeof item !== 'object') continue;
        const { kind, goalSlug, patch } = item;
        if (!PROPOSAL_KINDS.includes(kind)) {
            skipped.push({ id: item.id || null, reason: 'unknown-kind' });
            continue;
        }

        if (kind === 'new-goal') {
            const title = cleanText(patch?.title, TITLE_MAX);
            if (!title) { skipped.push({ id: item.id, reason: 'no-title' }); continue; }
            writes.push({
                op: 'goal-create',
                title,
                content: cleanText(patch?.description, TEXT_MAX),
                horizon: GOAL_HORIZONS.includes(patch?.horizon) ? patch.horizon : null,
            });
            continue;
        }

        const goal = bySlug.get(goalSlug);
        if (!goal) { skipped.push({ id: item.id, reason: 'goal-gone', goalSlug }); continue; }

        if (kind === 'horizon') {
            const horizon = GOAL_HORIZONS.includes(patch?.horizon) ? patch.horizon : null;
            if (!horizon) { skipped.push({ id: item.id, reason: 'bad-horizon' }); continue; }
            // Only if it is still a change — the user may have re-scoped the goal
            // by hand between the review and the apply.
            if (horizon === (goal.horizon || null)) { skipped.push({ id: item.id, reason: 'already-set', goalSlug }); continue; }
            writes.push({ op: 'goal-horizon', goalSlug, horizon });
            continue;
        }

        if (kind === 'split') {
            const children = normalizeChildren(patch?.children);
            if (!children.length) { skipped.push({ id: item.id, reason: 'no-children' }); continue; }
            writes.push({ op: 'goal-split', goalSlug, children });
            continue;
        }

        // kind === 'plan'
        const steps = normalizeSteps(patch?.steps);
        if (steps.length < 2) { skipped.push({ id: item.id, reason: 'no-steps' }); continue; }
        writes.push({ op: 'plan-create', goalSlug, title: goal.name || goalSlug, steps });
    }

    return { writes, skipped };
}

module.exports = {
    GOAL_MAX,
    ITEM_MAX,
    SPLIT_MAX,
    PLAN_STEP_MAX,
    LESSON_MAX,
    PROPOSAL_KINDS,
    CREATING_KINDS,
    selectGoalsForReview,
    describeGoal,
    buildGoalReviewPrompt,
    normalizeGoalReview,
    planReviewApplication,
};
