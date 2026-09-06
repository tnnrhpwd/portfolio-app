/**
 * Standalone unit tests for the pattern learner's pure pieces
 * (fingerprinting, tokenization, repeated-sequence detection, and the
 * action-log fetch that feeds them).
 * Run: `node simple-addon/server/automation/pattern-learner.test.js`
 */

const { PatternLearner } = require('./pattern-learner');

let failed = 0, total = 0;
function assert(name, cond, detail) {
    total++;
    if (cond) console.log(`  PASS  ${name}`);
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function makeLearner() {
    return new PatternLearner();
}

async function main() {
    // ─── _fingerprint ────────────────────────────────────────────────────────
    {
        const L = makeLearner();
        assert('fingerprint: PII tool → tool:pii', L._fingerprint({ tool: 'text_type', args: { text: 'secret' } }) === 'text_type:pii');
        assert('fingerprint: boring tool → null', L._fingerprint({ tool: 'uia_snapshot', args: {} }) === null);
        const fp = L._fingerprint({ tool: 'shell_run', args: { command: 'x' } });
        assert('fingerprint: interesting tool → tool:hash', typeof fp === 'string' && fp.startsWith('shell_run:'));
        const fp2 = L._fingerprint({ tool: 'shell_run', args: { command: 'different value, same arg keys' } });
        assert('fingerprint: same arg keys → same fingerprint', fp === fp2);
    }

    // ─── _tokenize ───────────────────────────────────────────────────────────
    {
        const L = makeLearner();
        const tokens = L._tokenize([
            { tool: 'text_type', args: { text: 'a' } },
            { tool: 'uia_snapshot', args: {} },
            { tool: 'shell_run', args: { command: 'x' } },
        ]);
        assert('tokenize: filters boring tools', tokens.length === 2);
    }

    // ─── _findRepeatedSequences ──────────────────────────────────────────────
    {
        const L = makeLearner();
        const tokens = ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'];
        const seqs = L._findRepeatedSequences(tokens);
        assert('findRepeated: finds "a→b→c" ×3', seqs.length >= 1 && seqs[0].key === 'a→b→c' && seqs[0].count >= 3);
    }
    {
        const L = makeLearner();
        const seqs = L._findRepeatedSequences(['x', 'y', 'z', 'w']);
        assert('findRepeated: no repeats → []', Array.isArray(seqs) && seqs.length === 0);
    }

    // ─── _fetchEntries ───────────────────────────────────────────────────────
    {
        const L = makeLearner();
        L.configure({ wsClient: { getActionLog: async () => [{ tool: 'a' }, { tool: 'b' }] } });
        const entries = await L._fetchEntries();
        assert('fetchEntries: uses getActionLog', entries.length === 2 && entries[0].tool === 'a');
    }
    {
        const L = makeLearner();
        const entries = await L._fetchEntries();
        assert('fetchEntries: no wsClient → []', Array.isArray(entries) && entries.length === 0);
    }
    {
        const L = makeLearner();
        L.configure({ wsClient: {} }); // no getActionLog method
        const entries = await L._fetchEntries();
        assert('fetchEntries: no getActionLog → []', Array.isArray(entries) && entries.length === 0);
    }

    // ─── Phase 5 (meta-loop): draftSkillFromSequence ─────────────────────────
    {
        const L = makeLearner();
        const saved = [];
        const canned = [];
        for (let r = 0; r < 3; r++) {
            canned.push({ tool: 'shell_run', args: { command: 'echo hi' } });
            canned.push({ tool: 'text_type', args: { text: 'secret-pii' } });
            canned.push({ tool: 'uia_invoke', args: { name: 'OK' } });
        }
        L.configure({
            wsClient: {
                getActionLog: async () => canned,
                upsertSkill: async (slug, body) => { saved.push({ slug, body }); return {}; },
            },
        });

        const suggestions = await L.analyze({ force: true });
        assert('promote: analyze finds a 3× repeated 3-step sequence', suggestions.length >= 1 && !!suggestions[0].sequenceKey);

        const key = suggestions[0].sequenceKey;
        const draft = await L.draftSkillFromSequence(key);
        assert('promote: 3+ repeats → draft with 3 steps', draft !== null && Array.isArray(draft.skill.steps) && draft.skill.steps.length === 3);
        assert('promote: draft slug is deterministic + prefixed', !!draft && draft.skill.slug.startsWith('pattern-'));
        assert('promote: PII tool args stripped from draft', !!draft && JSON.stringify(draft.skill.steps[1].args) === '{}');
        assert('promote: nothing saved without consent (save=false)', saved.length === 0);

        await L.draftSkillFromSequence(key, { save: true });
        assert('promote: save=true persists one draft via upsertSkill', saved.length === 1 && saved[0].body.content.includes('"draft":true'));
    }
    {
        const L = makeLearner();
        const draft = await L.draftSkillFromSequence('nonexistent→key');
        assert('promote: unknown sequenceKey → null', draft === null);
    }
    {
        // T5.1 refinement: `generalize` without an LLM client is a safe no-op
        // (the draft stays literal rather than crashing or dropping steps).
        const L = makeLearner();
        const canned = [];
        for (let r = 0; r < 3; r++) {
            canned.push({ tool: 'shell_run', args: { command: 'echo hi' } });
            canned.push({ tool: 'text_type', args: { text: 'secret-pii' } });
            canned.push({ tool: 'uia_invoke', args: { name: 'OK' } });
        }
        L.configure({ wsClient: { getActionLog: async () => canned, upsertSkill: async () => ({}) } });
        const suggestions = await L.analyze({ force: true });
        const key = suggestions[0].sequenceKey;
        const draft = await L.draftSkillFromSequence(key, { generalize: true });
        assert('promote: generalize without llmClient → literal draft', draft !== null && draft.skill.steps[0].tool === 'shell_run');
    }

    console.log('');
    if (failed === 0) {
        console.log(`pattern-learner.test: ${total}/${total} PASS`);
        process.exit(0);
    } else {
        console.log(`pattern-learner.test: ${failed}/${total} FAILED`);
        process.exit(1);
    }
}

main();
