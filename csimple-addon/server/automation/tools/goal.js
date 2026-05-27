/**
 * Goal management tools — the agent uses these to update its own worklist.
 *
 * goal_update: mark progress, change status, append notes (writes to backend
 *              via workspace-client → kind=goal).
 * goal_create: spawn a sub-goal (parentGoalId = current goal slug).
 * goal_ask_user: request human input — sets status='blocked' with a question.
 */

const ws = require('../workspace-client');

const STATUSES = ['active', 'paused', 'blocked', 'done', 'failed'];

function slugify(s, fallback = 'goal') {
    const out = String(s || '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
    return (out || fallback).slice(0, 100);
}

const goalUpdate = {
    name: 'goal_update',
    category: 'safe-read',  // metadata write, not local side-effect
    description:
        'Update a goal\'s status, priority, or append notes to its content. ' +
        'Use this to mark progress (status=done/failed), pause/resume, or record findings.',
    parameters: {
        type: 'object',
        properties: {
            slug: { type: 'string', description: 'Goal slug. Defaults to the currently executing goal.' },
            status: { type: 'string', enum: STATUSES },
            priority: { type: 'integer', description: '0-100' },
            appendNotes: { type: 'string', description: 'Text appended to the goal\'s content with a timestamp.' },
        },
    },
    async run(args, ctx) {
        const slug = args.slug || ctx?.goalSlug;
        if (!slug) throw new Error('no slug provided and no active goal in context');
        const existing = await ws.getGoal(slug).catch(() => null);
        if (!existing) throw new Error(`goal not found: ${slug}`);
        const next = {
            name: existing.name,
            content: existing.content || '',
        };
        if (args.appendNotes) {
            next.content = (existing.content || '') + `\n\n[${new Date().toISOString()}] ${args.appendNotes}`;
        }
        if (args.status)   next.status   = args.status;
        if (typeof args.priority === 'number') next.priority = args.priority;
        const out = await ws.upsertGoal(slug, next);
        return { slug, status: out.status, priority: out.priority };
    },
};

const goalCreate = {
    name: 'goal_create',
    category: 'safe-read',
    description: 'Create a new goal (optionally as a sub-goal of the current one).',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string' },
            description: { type: 'string', description: 'Markdown body for the goal.' },
            priority: { type: 'integer' },
            successCriteria: { type: 'string' },
            parentGoalSlug: { type: 'string', description: 'Defaults to current goal.' },
        },
        required: ['title'],
    },
    async run(args, ctx) {
        const slug = slugify(args.title);
        const body = {
            name: String(args.title).slice(0, 120),
            content: args.description || '',
            status: 'active',
            priority: typeof args.priority === 'number' ? args.priority : 50,
            successCriteria: args.successCriteria,
            parentGoalId: args.parentGoalSlug || ctx?.goalSlug || undefined,
            createdBy: 'agent',
        };
        const out = await ws.upsertGoal(slug, body);
        return { slug, name: out.name, status: out.status };
    },
};

const goalAskUser = {
    name: 'goal_ask_user',
    category: 'safe-read',
    description:
        'Pause the active goal and ask the human a question. The agent will stop ' +
        'work on this goal until the user updates it (status active).',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            slug: { type: 'string', description: 'Defaults to current goal.' },
        },
        required: ['question'],
    },
    async run(args, ctx) {
        const slug = args.slug || ctx?.goalSlug;
        if (!slug) throw new Error('no slug provided and no active goal in context');
        const existing = await ws.getGoal(slug).catch(() => null);
        if (!existing) throw new Error(`goal not found: ${slug}`);
        const note = `\n\n[${new Date().toISOString()}] AGENT QUESTION: ${args.question}`;
        await ws.upsertGoal(slug, {
            name: existing.name,
            content: (existing.content || '') + note,
            status: 'blocked',
        });
        return { slug, blocked: true, question: args.question };
    },
};

module.exports = { goalUpdate, goalCreate, goalAskUser };
