/**
 * goalMap — the data behind the `/plans` **Map** view.
 *
 * Turns a flat list of goals into a small graph: each goal in one category, in a
 * sequence, with the dependencies between individual goals. The categories and the
 * sequence come from a language model (see `generateGoalMap` in
 * workspaceController.js); this module is the two pure halves either side of it:
 *
 *   · `buildGoalMapPrompt()` writes the question.
 *   · `normalizeGoalMap()` decides what of the answer can be TRUSTED.
 *
 * ⚠️ The second half is not a formality. A model is a fallible source: it invents
 * slugs, repeats one, forgets another, points a goal at itself, or files a goal
 * under a category it never declared. Everything the UI renders comes through
 * `normalizeGoalMap()`, so a graph can never reference a goal that doesn't exist,
 * lose a goal that does, or draw an edge to nothing — whatever the model returned.
 *
 * No AWS, no network, no clock: both functions are pure, so the rules above are
 * pinned by unit tests instead of by hoping.
 */

/** Categories beyond this are folded into the catch-all "Other". A legend stops
 *  being readable before a hue ramp does. The catch-all is added ON TOP of this
 *  cap, so a legend is at most CATEGORY_MAX + 1 lanes — the cap is about how many
 *  groups the model may invent, not about the lane count. */
const CATEGORY_MAX = 8;
/** Goals beyond this are left off one generation — a graph of 200 nodes is not a
 *  map, and neither is a 200-item prompt. */
const GOAL_MAX = 120;
const LABEL_MAX = 28;
const CATEGORY_ID_MAX = 40;
/** Prerequisites per goal. Beyond a few, "depends on" stops meaning anything. */
const DEPENDS_MAX = 3;

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
// Category ids are slug-shaped, and restrictive on purpose: they travel through
// URLs, CSS class names and `dependsOn` strings.
const CATEGORY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** The bucket for anything the model didn't place. Always rendered LAST. */
const FALLBACK_CATEGORY = Object.freeze({ id: 'other', label: 'Other' });

/**
 * Which goals are worth spending tokens on, when there are more than fit.
 *
 * Live work first (a map of what you're doing beats a map of what you finished),
 * then the states that ask for attention, then the finished ones, and inside each
 * status the priority and recency the page already sorts by. The tail is REPORTED
 * (`truncated`) rather than silently dropped — the view says so.
 */
function selectGoalsForMap(goals, { max = GOAL_MAX } = {}) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    const rank = { active: 0, blocked: 1, paused: 2, failed: 3, done: 4 };
    const ordered = [...list].sort((a, b) => {
        const ra = rank[a?.status] ?? 5;
        const rb = rank[b?.status] ?? 5;
        if (ra !== rb) return ra - rb;
        const pa = typeof a?.priority === 'number' ? a.priority : 50;
        const pb = typeof b?.priority === 'number' ? b.priority : 50;
        if (pa !== pb) return pb - pa; // 0-100, higher = more important
        return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
    });
    return {
        goals: ordered.slice(0, max),
        total: list.length,
        truncated: Math.max(0, list.length - max),
    };
}

/** One line per goal: the fields the categoriser actually needs, and nothing that
 *  costs tokens without informing the answer. */
function describeGoal(goal) {
    const bits = [
        `"${goal.name || goal.slug}"`,
        goal.status || 'active',
        typeof goal.priority === 'number' ? `priority ${goal.priority}` : null,
        goal.targetDate ? `target ${goal.targetDate}` : null,
        goal.content ? `detail: ${String(goal.content).replace(/\s+/g, ' ').slice(0, 160)}` : null,
        goal.vision ? `vision: ${String(goal.vision).replace(/\s+/g, ' ').slice(0, 120)}` : null,
    ].filter(Boolean);
    return `- ${goal.slug} | ${bits.join(' | ')}`;
}

/** The prompt. Schema first, rules second, the data last — the order a model reads
 *  a JSON task best, and the order that keeps the rules adjacent to the shape. */
function buildGoalMapPrompt(goals) {
    const list = Array.isArray(goals) ? goals.filter(Boolean) : [];
    return [
        "Organise this person's goals into a MAP: thematic categories, and the order they should be done in, with the dependencies between individual goals.",
        '',
        'Return ONLY this JSON shape:',
        '{"categories":[{"id":"web","label":"Web development"}],"nodes":[{"slug":"<goal slug>","category":"web","order":1,"dependsOn":["<goal slug>"]}]}',
        '',
        'Rules:',
        `- 3-${CATEGORY_MAX} categories. "id" is lowercase letters/digits/-/_ (max ${CATEGORY_ID_MAX} chars); "label" is 1-3 words for a legend.`,
        '- Use EVERY goal below EXACTLY once, with its "slug" copied verbatim.',
        '- "order" is the position INSIDE its category: 1 = do this first. Number them tightly (1, 2, 3, …) so the sequence is readable.',
        `- "dependsOn" lists the slugs this goal cannot start before (its prerequisites). At most ${DEPENDS_MAX} each, never itself, and only slugs from the list. Most goals have none — an empty array or an omitted key is correct and common.`,
        '- Group by SUBJECT, never by status: a finished goal belongs in its subject\'s category.',
        '- Reply with JSON only. No prose, no markdown fences.',
        '',
        `Goals (${list.length}):`,
        ...list.map(describeGoal),
    ].join('\n');
}

/** `"Web Development"` → `"web-development"`, for an id the model didn't give. */
function categoryIdFrom(label, taken) {
    const base = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, CATEGORY_ID_MAX);
    let id = CATEGORY_ID_RE.test(base) ? base : 'category';
    let n = 2;
    while (taken.has(id)) {
        const suffix = `-${n}`;
        id = `${base.slice(0, CATEGORY_ID_MAX - suffix.length)}${suffix}`;
        n += 1;
    }
    return id;
}

function cleanLabel(label, fallback) {
    const text = String(label || '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text;
}

/**
 * The model's answer → the map the view renders.
 *
 * Every rule the prompt asks for is enforced here, because asking is not
 * enforcing: unknown slugs are dropped, duplicates keep their first placement,
 * self- and unknown-dependencies are removed, a category the model used but never
 * declared is invented from its id, the category count is capped (overflow folds
 * into "Other"), and any goal the model forgot is appended to "Other" so the map
 * still covers the workspace.
 *
 * @param {object} raw   Parsed JSON from the model (any shape — it is not trusted)
 * @param {Array}  goals The goals the prompt was built from (workspace list entries)
 * @returns {{categories: Array, nodes: Array, stats: object}}
 */
function normalizeGoalMap(raw, goals) {
    const list = Array.isArray(goals) ? goals.filter((g) => g && SLUG_RE.test(String(g.slug || ''))) : [];
    const goalBySlug = new Map(list.map((g) => [g.slug, g]));

    // ── Categories ───────────────────────────────────────────────────────────
    const categories = [];
    const categoryIds = new Set();
    const pushCategory = (id, label) => {
        if (categoryIds.has(id) || categories.length >= CATEGORY_MAX) return null;
        const entry = { id, label: cleanLabel(label, id) };
        categories.push(entry);
        categoryIds.add(id);
        return entry;
    };

    const rawCategories = Array.isArray(raw?.categories) ? raw.categories : [];
    for (const entry of rawCategories) {
        if (!entry || typeof entry !== 'object') continue;
        const label = cleanLabel(entry.label, '');
        const givenId = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
        // A category with neither an id nor a label can't be named in the legend
        // OR referenced by a node, so there is nothing to keep.
        if (!givenId && !label) continue;
        const id = CATEGORY_ID_RE.test(givenId) ? givenId : categoryIdFrom(label, categoryIds);
        pushCategory(id, label || id);
    }

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodes = [];
    const placed = new Set();
    const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];

    // Dependencies may reference a goal whose own node has not been read yet
    // (order in the array is the model's, not ours), so collect them first and
    // filter once the placement is settled.
    const pendingDeps = [];

    for (const entry of rawNodes) {
        if (!entry || typeof entry !== 'object') continue;
        const slug = typeof entry.slug === 'string' ? entry.slug : '';
        if (!goalBySlug.has(slug) || placed.has(slug)) continue;

        const goal = goalBySlug.get(slug);
        let categoryId = typeof entry.category === 'string' ? entry.category.toLowerCase() : '';
        if (!CATEGORY_ID_RE.test(categoryId) || !categoryIds.has(categoryId)) {
            // A category the model used but never declared is a real category —
            // it just forgot the legend. Derive it rather than discarding the
            // grouping. Past the cap, everything lands in "Other".
            if (categoryId && CATEGORY_ID_RE.test(categoryId)) {
                const created = pushCategory(categoryId, categoryId);
                if (!created) categoryId = FALLBACK_CATEGORY.id;
            } else {
                categoryId = FALLBACK_CATEGORY.id;
            }
        }

        const order = Number.isFinite(entry.order) && entry.order > 0 ? Math.floor(entry.order) : null;
        nodes.push({ slug, category: categoryId, order, dependsOn: [] });
        placed.add(slug);
        if (Array.isArray(entry.dependsOn)) pendingDeps.push({ slug, dependsOn: entry.dependsOn });
    }

    for (const { slug, dependsOn } of pendingDeps) {
        const node = nodes.find((n) => n.slug === slug);
        if (!node) continue;
        const seen = new Set();
        for (const candidate of dependsOn) {
            const dep = typeof candidate === 'string' ? candidate : '';
            if (!dep || dep === slug || !placed.has(dep) || seen.has(dep)) continue;
            seen.add(dep);
            node.dependsOn.push(dep);
            if (node.dependsOn.length >= DEPENDS_MAX) break;
        }
    }

    // ── Goals the model never placed ─────────────────────────────────────────
    // They are appended to "Other" rather than dropped: a goal that exists and
    // isn't on the map is the one failure a reader cannot detect.
    const unmapped = list.filter((g) => !placed.has(g.slug));
    if (unmapped.length > 0) {
        let next = nodes
            .filter((n) => n.category === FALLBACK_CATEGORY.id)
            .reduce((max, n) => Math.max(max, n.order || 0), 0) + 1;
        for (const goal of unmapped) {
            // `placed` is updated as we go, so a slug repeated in the input list
            // can't be appended twice.
            if (placed.has(goal.slug)) continue;
            nodes.push({ slug: goal.slug, category: FALLBACK_CATEGORY.id, order: next, dependsOn: [] });
            placed.add(goal.slug);
            next += 1;
        }
    }

    // ── The catch-all, last ──────────────────────────────────────────────────
    // Added whenever anything uses it (including the invented category ids above);
    // `normalizeGoalMap` therefore always returns a set of categories every node
    // points at, which is the invariant the layout relies on.
    if (nodes.some((n) => n.category === FALLBACK_CATEGORY.id)) {
        if (categoryIds.has(FALLBACK_CATEGORY.id)) {
            // Declared by the model — move it to the end so the legend matches the
            // lane order the map draws.
            const at = categories.findIndex((c) => c.id === FALLBACK_CATEGORY.id);
            if (at >= 0) categories.push(...categories.splice(at, 1));
        } else {
            categories.push({ ...FALLBACK_CATEGORY });
            categoryIds.add(FALLBACK_CATEGORY.id);
        }
    }

    const edgeCount = nodes.reduce((n, node) => n + node.dependsOn.length, 0);
    return {
        categories,
        nodes,
        stats: {
            goalCount: list.length,
            mappedCount: nodes.length,
            categoryCount: categories.length,
            edgeCount,
            appendedCount: unmapped.length,
        },
    };
}

/** One-line shape summary for the response `meta` (and for logs). */
function goalMapStats(map) {
    return map?.stats || {
        goalCount: 0,
        mappedCount: 0,
        categoryCount: 0,
        edgeCount: 0,
        appendedCount: 0,
    };
}

module.exports = {
    CATEGORY_MAX,
    GOAL_MAX,
    DEPENDS_MAX,
    FALLBACK_CATEGORY,
    selectGoalsForMap,
    buildGoalMapPrompt,
    normalizeGoalMap,
    goalMapStats,
};
