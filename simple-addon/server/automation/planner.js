/**
 * Planner — decomposes a high-level goal into 2–5 concrete sub-goals.
 *
 * Called once at the start of an agent run when a goal looks "big" (no
 * existing children, content over ~120 chars or success criteria contains
 * the word "then"/"and" connecting clauses). The planner asks the LLM for
 * a small JSON plan, validates it, then persists each child via the
 * workspace API with `parentGoalId` set to the parent's slug.
 *
 * Behavior is intentionally conservative:
 *   - Returns early without LLM call if the goal doesn't look big.
 *   - Emits one workspace write per accepted child, but skips a child if a
 *     goal with that slug already exists (idempotent re-planning).
 *   - Never modifies the parent goal's content — just adds children.
 *
 * The agent loop continues to pick whichever child is highest priority via
 * the existing `getNextGoal()` flow.
 */

const STOP_TOKENS = ['then', ' and then ', 'after that', 'finally'];

/**
 * Heuristic for whether to invoke the planner.
 */
function shouldPlan(goal) {
    if (!goal) return false;
    const text = `${goal.content || ''} ${goal.successCriteria || ''}`.toLowerCase();
    if (text.length < 30) return false;
    // Explicit override.
    if (goal.skipPlanner === true) return false;
    // Multi-clause / multi-step language hints.
    if (STOP_TOKENS.some(t => text.includes(t))) return true;
    // Long goal description is a strong signal.
    if (text.length > 240) return true;
    return false;
}

function _buildPlannerPrompt(goal) {
    return [
        'Decompose this goal into 2 to 5 small, concrete, independent sub-goals.',
        'Each sub-goal must be sequenced (do them in order). Order matters.',
        '',
        `Title: ${goal.name}`,
        goal.successCriteria ? `Success criteria: ${goal.successCriteria}` : '',
        '',
        'Details:',
        (goal.content || '').slice(0, 1500),
        '',
        'Reply with ONLY a JSON object (no prose) of shape:',
        '{ "children": [ { "name": "...", "successCriteria": "...", "content": "..." }, ... ] }',
        'Constraints:',
        '- 2 to 5 children, ordered first → last.',
        '- Each name <= 80 chars. Each successCriteria <= 200 chars. Each content <= 600 chars.',
        '- successCriteria must be objectively checkable, not aspirational.',
        '- DO NOT include any text outside the JSON.',
    ].filter(Boolean).join('\n');
}

function _slugify(name, fallback = 'sub') {
    return String(name || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || fallback;
}

function _validatePlan(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('plan must be an object');
    const children = Array.isArray(obj.children) ? obj.children : null;
    if (!children || children.length < 2 || children.length > 5) {
        throw new Error('plan.children must be an array of 2 to 5 items');
    }
    return children.map((c, i) => {
        if (!c || typeof c !== 'object') throw new Error(`child ${i} is not an object`);
        const name = String(c.name || '').slice(0, 80).trim();
        if (!name) throw new Error(`child ${i} missing name`);
        return {
            name,
            successCriteria: String(c.successCriteria || '').slice(0, 200).trim(),
            content: String(c.content || '').slice(0, 600).trim(),
        };
    });
}

/**
 * Plan a goal. Returns { skipped: true } if the goal doesn't look big enough,
 * otherwise { created: N, children: [...] }.
 *
 * @param {object} goal - the workspace goal item
 * @param {object} deps - { wsClient, llm, log, eventBus? }
 */
async function planGoal(goal, { wsClient, llm, log = console.log, eventBus } = {}) {
    if (!shouldPlan(goal)) return { skipped: true, reason: 'small-or-skipped' };
    if (!wsClient || !llm) throw new Error('planGoal requires wsClient + llm');

    log(`[planner] decomposing goal slug=${goal.slug}`);
    eventBus?.publish('planner.start', { goalSlug: goal.slug });

    let plan;
    try {
        const reply = await llm.chat({
            message: _buildPlannerPrompt(goal),
            modelId: 'openai/gpt-4o-mini',
            systemPrompt: 'You are a planning assistant. Reply with ONLY a JSON object — no markdown, no commentary.',
            temperature: 0.2,
            maxLength: 600,
        });
        const text = (reply?.text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
        plan = JSON.parse(text);
    } catch (e) {
        eventBus?.publish('planner.failed', { goalSlug: goal.slug, error: e.message });
        return { skipped: false, error: `LLM/JSON parse failed: ${e.message}` };
    }

    let children;
    try { children = _validatePlan(plan); }
    catch (e) {
        eventBus?.publish('planner.failed', { goalSlug: goal.slug, error: e.message });
        return { skipped: false, error: `plan validation failed: ${e.message}` };
    }

    // Persist each child, skipping any slug collisions (idempotent).
    let created = 0;
    const accepted = [];
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        const slug = `${goal.slug}--${i + 1}-${_slugify(c.name)}`;
        try {
            // Probe for existing item — if present, skip without overwriting.
            try { await wsClient.getGoal(slug); accepted.push({ slug, skipped: true, name: c.name }); continue; }
            catch (e) { if (e.status !== 404) throw e; }

            await wsClient.upsertGoal(slug, {
                name: c.name,
                content: c.content,
                successCriteria: c.successCriteria,
                status: 'active',
                priority: 1000 - i,           // earlier child = higher priority
                parentGoalId: goal.slug,
                tags: ['planner-generated'],
            });
            accepted.push({ slug, skipped: false, name: c.name });
            created++;
        } catch (e) {
            accepted.push({ slug, skipped: true, error: e.message });
        }
    }

    log(`[planner] created ${created}/${children.length} sub-goals under ${goal.slug}`);
    eventBus?.publish('planner.done', { goalSlug: goal.slug, created, total: children.length });
    return { skipped: false, created, total: children.length, children: accepted };
}

module.exports = { planGoal, shouldPlan, _validatePlan, _slugify, _buildPlannerPrompt };
