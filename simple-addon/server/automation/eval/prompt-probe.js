/**
 * prompt-probe.js — see the EXACT system prompt and tool surface the agent gets,
 * WITHOUT updating the installed addon.
 *
 * Why this exists. The prompt is the single biggest lever on whether the agent
 * ACTS (clicks, types) or just reads the screen forever, but it was only ever
 * observable by releasing a build, updating the app, running the real task and
 * reading main.log afterwards — a whole cycle per attempt. That cycle produced
 * five releases in one day and found one problem at a time.
 *
 * This prints, offline and read-only:
 *   - the full system prompt, exactly as assembled (rules included),
 *   - every tool name offered to the model, with its category,
 *   - whether the ACTING tools are present at all — if click_at / uia_invoke /
 *     text_type were ever missing from this list, no prompt wording could help.
 *
 * Usage:
 *   node server/automation/eval/prompt-probe.js            # prompt + tools
 *   node server/automation/eval/prompt-probe.js --tools    # tool list only
 *   node server/automation/eval/prompt-probe.js --grep ACT # show rules mentioning ACT
 *
 * Nothing is executed on the machine: no tool is run and no LLM is called.
 */

const stubApp = {
    use() {}, get() {}, post() {}, put() {}, patch() {}, delete() {}, all() {},
};

async function buildRealRegistry() {
    // mountAutomation registers every tool into the singleton registry. It wants
    // an express-like app; a no-op stub is enough because we never serve.
    const automation = require('../index');
    try {
        automation.mountAutomation(stubApp, { log: () => {} });
    } catch (e) {
        console.error('mountAutomation failed:', e.message);
        console.error('(the tool list below may be incomplete or empty)');
    }
    return automation.registry;
}

async function buildPrompt(registry) {
    const { AgentLoop } = require('../agent-loop');
    const noop = () => {};
    const loop = new AgentLoop({
        registry,
        events: { publish() {}, _log: [] },
        log: noop,
        contextFactory: (extra = {}) => ({ log: noop, ...extra }),
        wsClient: {
            async getContext() { return { workspaceContext: '' }; },
            async listSkills() { return { entries: [] }; },
            async getGoal() { return null; },
            async getRecentActions() { return []; },
            async appendLog() { return {}; },
        },
        perception: null,
        planner: { shouldPlan: () => false, planGoal: async () => ({ skipped: true }) },
        skillModule: { getAllCachedSkills: () => [] },
        memory: {
            async recallEpisodes() { return []; },
            async recallLessons() { return []; },
            async recallSuggestions() { return []; },
        },
        llmClient: { async chat() { return { text: '', toolCalls: [] }; } },
    });
    // The real request this whole line of work came from.
    loop.state.currentGoal = {
        slug: 'probe',
        name: 'please google message my girlfriend that I love her. Hint: I am already signed into google message on microsoft edge. Dakota is my girlfriend, the one I message the most. please verify before sending the message.',
        status: 'active',
        content: 'message Dakota on Google Messages',
    };
    loop.state.step = 1;
    const frame = await loop.observe();
    const situation = await loop.orient(frame);
    return { situation, frame };
}

(async () => {
    const argv = process.argv.slice(2);
    const toolsOnly = argv.includes('--tools');
    const grepIdx = argv.indexOf('--grep');
    const needle = grepIdx !== -1 ? String(argv[grepIdx + 1] || '').toUpperCase() : null;

    const registry = await buildRealRegistry();
    const tools = registry.list();
    const ACTING = ['click_at', 'uia_invoke', 'text_type', 'input_tap', 'uia_find', 'mouse_path', 'mouse_drag', 'screen_ocr', 'screen_set_of_marks'];

    console.log('=== TOOL SURFACE (' + tools.length + ' tools offered to the model) ===');
    const groups = {};
    tools.forEach((t) => { (groups[t.category] = groups[t.category] || []).push(t.name); });
    Object.keys(groups).sort().forEach((cat) => {
        console.log(`  ${cat} (${groups[cat].length}): ${groups[cat].sort().join(' ')}`);
    });

    const missing = ACTING.filter((n) => !tools.some((t) => t.name === n));
    console.log('');
    console.log(missing.length === 0
        ? '  ✅ every ACTING tool is present — the model can click and type'
        : `  ⚠️  MISSING ACTING TOOLS: ${missing.join(', ')} — no prompt wording can compensate`);

    if (toolsOnly) process.exit(0);

    const { situation } = await buildPrompt(registry);
    const prompt = String(situation.systemPrompt || '');
    const lines = prompt.split('\n');

    console.log('');
    console.log('=== SYSTEM PROMPT (' + prompt.length + ' chars, ' + lines.length + ' lines) ===');
    if (needle) {
        lines.forEach((l, i) => {
            if (l.toUpperCase().includes(needle)) console.log(String(i + 1).padStart(4) + '| ' + l);
        });
        console.log(`(filtered to lines containing "${needle}")`);
    } else {
        lines.forEach((l, i) => console.log(String(i + 1).padStart(4) + '| ' + l));
    }
})().catch((e) => {
    console.error('probe failed:', e && e.stack ? e.stack : e);
    process.exit(1);
});
