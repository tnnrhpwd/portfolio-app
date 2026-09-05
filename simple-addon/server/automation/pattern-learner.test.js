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
