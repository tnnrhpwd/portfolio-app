/**
 * Standalone unit tests for the skill generalizer (recorder/generalize.js).
 *
 * Uses an injected fake `llmClient` (no network calls) so this runs fully
 * offline/deterministic, matching the testability seam already used by
 * agent-loop.js / tools/skill.js (`ctx.llm`) and nl-compiler.js
 * (`opts.llmClient`).
 *
 * Run with: `node csimple-addon/server/automation/recorder/generalize.test.js`
 * Exit code 0 on success, 1 on first failure.
 */

const { generalizeSkill, clearCache, _summarizeLiteralSteps, _redactArgs } = require('./generalize');

let failed = 0;
let total = 0;

function check(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

function fakeLlm(replyText) {
    return { chat: async () => ({ choices: [{ message: { content: replyText } }] }) };
}

function literalSkill(steps) {
    return {
        name: 'demo skill',
        slug: 'demo-skill',
        description: '',
        steps,
        params: [],
        metadata: { sourceSessionId: 'sess1', compilerVersion: 1 },
    };
}

(async () => {
    // ─── _summarizeLiteralSteps / _redactArgs ─────────────────────────────
    {
        const steps = [
            { tool: '_marker', args: { label: 'x' } },
            { tool: 'click_at', args: { x: 10, y: 20 } },
            { tool: 'mouse_path', args: { path: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } },
            { tool: 'type_text', args: { text: 'a'.repeat(300) } },
        ];
        const summary = _summarizeLiteralSteps(steps);
        check('_summarizeLiteralSteps drops _marker steps', summary.length === 3);
        check('_redactArgs collapses mouse paths', summary[1].args.path === '[2 point path]');
        check('_redactArgs caps long strings', summary[2].args.text.length <= 202);
    }

    // ─── generalizeSkill: empty steps → no-op with metadata note ──────────
    {
        const skill = literalSkill([]);
        const out = await generalizeSkill(skill, { llmClient: fakeLlm('{}') });
        check('empty steps → generalized=false', out.metadata.generalized === false);
        check('empty steps → generalizeError set', typeof out.metadata.generalizeError === 'string');
        check('empty steps → original steps preserved', out.steps.length === 0);
    }

    // ─── generalizeSkill: happy path replaces literal steps ───────────────
    {
        clearCache();
        const skill = literalSkill([
            { tool: 'window_focus', args: { titleContains: 'Notepad' } },
            { tool: 'click_at', args: { x: 500, y: 500 } },
        ]);
        const llmReply = JSON.stringify({
            steps: [
                { type: 'uia_invoke', name: 'File', controlType: 'MenuItem' },
                { type: 'goal_done' },
            ],
        });
        const out = await generalizeSkill(skill, { llmClient: fakeLlm(llmReply), goalDescription: 'open the file menu' });
        check('happy path → generalized=true', out.metadata.generalized === true);
        check('happy path → steps replaced with abstracted schema', out.steps[0].type === 'uia_invoke');
        check('happy path → literalStepCount recorded', out.metadata.literalStepCount === 2);
        check('happy path → goalDescription recorded', out.metadata.goalDescription === 'open the file menu');
        check('happy path → does not mutate input skill', skill.steps[0].tool === 'window_focus');
    }

    // ─── generalizeSkill: caching avoids a second LLM call ────────────────
    {
        clearCache();
        const skill = literalSkill([{ tool: 'click_at', args: { x: 1, y: 1 } }]);
        let calls = 0;
        const llmClient = { chat: async () => { calls++; return { choices: [{ message: { content: '{"steps":[{"type":"goal_done"}]}' } }] }; } };
        const first = await generalizeSkill(skill, { llmClient });
        const second = await generalizeSkill(skill, { llmClient });
        check('cache: first call hits LLM', calls === 1);
        check('cache: second identical call is served from cache', second.metadata.fromCache === true);
        check('cache: first call is not marked fromCache', first.metadata.fromCache === false);
    }

    // ─── generalizeSkill: invalid LLM output falls back gracefully ───────
    {
        clearCache();
        const skill = literalSkill([{ tool: 'click_at', args: { x: 1, y: 1 } }]);
        const out = await generalizeSkill(skill, { llmClient: fakeLlm('not json at all') });
        check('invalid LLM output → generalized=false', out.metadata.generalized === false);
        check('invalid LLM output → original literal steps preserved', out.steps[0].tool === 'click_at');
        check('invalid LLM output → generalizeError set', typeof out.metadata.generalizeError === 'string');
    }

    // ─── generalizeSkill: LLM output failing schema validation falls back ─
    {
        clearCache();
        const skill = literalSkill([{ tool: 'click_at', args: { x: 1, y: 1 } }]);
        const badReply = JSON.stringify({ steps: [{ type: 'not_a_real_type' }] });
        const out = await generalizeSkill(skill, { llmClient: fakeLlm(badReply) });
        check('schema-invalid LLM output → generalized=false', out.metadata.generalized === false);
        check('schema-invalid LLM output → original literal steps preserved', out.steps[0].tool === 'click_at');
    }

    console.log(`\n${total - failed}/${total} passed`);
    if (failed > 0) process.exit(1);
})().catch(e => {
    console.error('Unhandled error in generalize.test.js:', e);
    process.exit(1);
});
