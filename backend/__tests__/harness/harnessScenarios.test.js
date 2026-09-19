/**
 * harnessScenarios.test.js — the §0 properties, end to end, one scenario each.
 *
 * `NET_HARNESS_PLAN.md` §0 defines "strong harness" as six properties, and says
 * each must be falsifiable. The unit suites prove the PARTS (the loop's sequence,
 * the journal's redaction, the taxonomy, the budget). Nothing yet proved the
 * WHOLE: a real route, a real loop, a real journal, a scripted model, and an
 * assertion about what the user would actually get. That is this file.
 *
 * Why it drives `streamCompressionRequest()` rather than `runToolLoop()`:
 * everything interesting about this harness is the WIRING — which tools are
 * offered, what the journal records, what reaches the client, which notice the
 * model is handed, whether a refusal is retried. A test of the loop alone cannot
 * falsify a property that lives in the joins.
 *
 * The oracle is Bedrock's own validation (`enforceAwsToolRules`), so a request the
 * real API would reject fails here rather than in production.
 *
 * Reading order = the property order:
 *
 *   1 acts instead of narrating      → an act-nudge turn ends with a step
 *   2 steps are observable           → the journal holds them, redacted, persisted
 *   3 the turn is controllable       → cancel leaves a legal, recorded turn
 *   4 both hands work in one loop    → three planes in one turn
 *   5 verification closes            → the agent runs a check before claiming
 *   6 cost is governed               → a runaway turn is trimmed, then stopped
 *
 * Plus the two failure guards P6 introduced, because they are properties too: a
 * refusal is never retried, and a transient READ is.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ kind: 'converse', input })),
    ConverseStreamCommand: jest.fn().mockImplementation((input) => ({ kind: 'stream', input })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn() },
    PutCommand: class { constructor(input) { this.input = input; } },
    UpdateCommand: class { constructor(input) { this.input = input; } },
    GetCommand: class { constructor(input) { this.input = input; } },
}));

jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../utils/paginatedScan', () => ({ paginatedScan: jest.fn(async () => []) }));
jest.mock('../../utils/apiUsageTracker', () => ({
    API_COSTS: { bedrock: { default: { input: 0.000001, output: 0.000002 } } },
    isSpecialUser: jest.fn(() => false),
}));
jest.mock('../../services/workspaceContext', () => ({
    buildWorkspaceContext: jest.fn(async () => ({ workspaceContext: '', sections: [], bytes: 0 })),
}));
jest.mock('../../services/memoryService', () => ({
    getGoalsSummary: jest.fn(async () => null),
    logAction: jest.fn(async () => {}),
}));
jest.mock('../../utils/llmProviders', () => ({
    checkApiUsage: jest.fn(async () => ({ canMake: true })),
    trackCompletion: jest.fn(async () => ({ success: true })),
    MODEL_TIER_REQUIREMENTS: {},
    PROVIDERS: {},
    createCompletion: jest.fn(),
    streamCompletion: jest.fn(),
    getDefaultModel: jest.fn(() => ({
        provider: 'bedrock',
        model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    })),
}));

/**
 * The tool surface a scenario sees. Schemas matter as much as executors: the
 * capability filter, the plane map and the AWS validation oracle all read them,
 * so a missing schema would reject the request rather than fail the assertion.
 */
jest.mock('../../services/netTools', () => ({
    TOOL_SCHEMAS: [
        { type: 'function', function: { name: 'save_note', description: 'Save a note', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_search', description: 'Search the repo', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_edit_file', description: 'Edit a file', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_run', description: 'Run a check', parameters: { type: 'object', properties: {} } } },
        // The ONLY 'ask'-policy tool (toolScopes.js TOOL_POLICY) — the approval and
        // refusal scenarios must use it, because every other tool runs unprompted.
        { type: 'function', function: { name: 'repo_commit_changes', description: 'Commit', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'pc_status', description: 'What the PC offers', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'pc_do', description: 'Act on the PC', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'set_plan', description: 'Publish the plan', parameters: { type: 'object', properties: {} } } },
    ],
    executeTool: jest.fn(async () => 'ok'),
}));

const { streamCompressionRequest } = require('../../services/llmService');
const { executeTool } = require('../../services/netTools');

/**
 * The REAL `set_plan` executor, reached past the mock.
 *
 * The plan is the model describing its own work, so the parts worth testing are
 * the ones netTools owns: normalising what it sent, stashing it on the tool
 * context, and rendering the checklist back. A hand-written stub in the mock
 * factory would test the stub.
 */
const realToolSurface = jest.requireActual('../../services/netTools.js');

/** Route `set_plan` at the real executor; everything else is a stub. */
function withRealSetPlan() {
    executeTool.mockImplementation(async (name, args, ctx) => (
        name === 'set_plan' ? realToolSurface.executeTool(name, args, ctx) : 'ok'
    ));
}
const turnControl = require('../../services/harness/turnControl.js');
const { setRunStoreForTests } = require('../../services/harness/stepJournal.js');

const ADMIN_USER_ID = 'admin-user-1';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// ── The model, scripted ────────────────────────────────────────────────────

let toolUseSeq = 0;

/** The model asks for one tool (optionally with prose alongside it). */
function asksFor(name, input = {}, prose = null) {
    const content = [];
    if (prose) content.push({ text: prose });
    content.push({ toolUse: { toolUseId: `tooluse_${++toolUseSeq}`, name, input } });
    return {
        output: { message: { role: 'assistant', content } },
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

/** The model answers in prose and asks for nothing — the loop's exit. */
function says(text) {
    return {
        output: { message: { role: 'assistant', content: [{ text }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

/**
 * Walk a fixed transcript, repeating the last entry when it runs out — which is
 * how a "runaway" model is expressed.
 */
function scriptedModel(responses) {
    let i = 0;
    return async (command) => {
        enforceAwsToolRules(command.input);
        if (command.kind === 'stream') return streamOf(['streamed answer']);
        return responses[Math.min(i++, responses.length - 1)];
    };
}

/** Exactly what AWS raises for an invalid Converse request. */
function validationException(message) {
    const err = new Error(message);
    err.name = 'ValidationException';
    err.$metadata = { httpStatusCode: 400 };
    return err;
}

/** AWS's own rules for tool blocks — the oracle for every request this suite makes. */
function enforceAwsToolRules(input) {
    const blocks = (input.messages || []).flatMap((m) => m.content || []);
    if (blocks.some((b) => b.toolUse || b.toolResult) && !input.toolConfig) {
        throw validationException(
            'The toolConfig field must be defined when using toolUse and toolResult content blocks.'
        );
    }
    if (input.toolConfig) {
        // `toolConfig.tools` may end with a `{ cachePoint }` entry (P4 prompt
        // caching) — it is not a tool spec, so it must not be read as one. The
        // oracle is about which TOOLS are defined.
        const defined = new Set(
            input.toolConfig.tools.filter((t) => t?.toolSpec).map((t) => t.toolSpec.name)
        );
        for (const block of blocks) {
            if (block.toolUse && !defined.has(block.toolUse.name)) {
                throw validationException(`The tool name ${block.toolUse.name} is not defined in the toolConfig.`);
            }
        }
    }
}

function streamOf(tokens) {
    return {
        stream: (async function* () {
            for (const text of tokens) yield { contentBlockDelta: { delta: { text } } };
            yield { messageStop: { stopReason: 'end_turn' } };
            yield { metadata: { usage: { inputTokens: 200, outputTokens: 10, totalTokens: 210 } } };
        })(),
    };
}

// ── The request, the response, and the journal ─────────────────────────────

function fakeReq(message) {
    // The shape the route actually parses: the addon sends its JSON payload
    // wrapped in `Net:`, and `req.user` carries the membership rank the tier
    // guard reads. Copied from the streaming-tools suite on purpose — a scenario
    // that invents its own request shape tests the fixture, not the harness.
    const payload = {
        message,
        // Two turns ⇒ not the first exchange, so no title-generation call muddies
        // the model-call counts.
        conversationHistory: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ],
        behaviorFile: 'default.txt',
    };
    return {
        body: {
            data: JSON.stringify({ text: `Net:${JSON.stringify(payload)}` }),
            provider: 'bedrock',
            model: MODEL_ID,
        },
        user: { id: ADMIN_USER_ID, email: 'admin@example.com', nickname: 'Admin', text: '|Rank:Pro' },
    };
}

function fakeRes() {
    const events = [];
    const listeners = {};
    const res = {
        events,
        listeners,
        headersSent: false,
        writableEnded: false,
        writeHead: jest.fn(),
        write: jest.fn((chunk) => {
            const match = /^data: (.*)\n\n$/.exec(chunk);
            if (match && match[1] !== '[DONE]') {
                const event = JSON.parse(match[1]);
                events.push(event);
                // The route announces the turn's id as soon as the stream opens; a
                // scenario needs it to cancel the turn it is currently inside.
                if (event.type === 'run') res.runId = event.runId;
            }
            return true;
        }),
        on: jest.fn((name, fn) => {
            (listeners[name] = listeners[name] || []).push(fn);
            return res;
        }),
        end: jest.fn(() => { res.writableEnded = true; }),
    };
    return res;
}

/** The steps a run recorded, in order. */
const stepsOf = (run) => (run ? run.steps.map((s) => `${s.tool}:${s.status}`) : []);

/** All assistant text the turn produced, from either delivery path. */
function answerText(res) {
    return res.events
        .filter((e) => e.type === 'token' || e.type === 'content')
        .map((e) => e.text)
        .join('');
}

const fakeDynamo = () => ({ send: jest.fn(async () => ({})) });

/** An in-memory journal store, so a scenario can assert what was PERSISTED. */
function memoryStore() {
    let runs = [];
    return {
        load: jest.fn(async () => runs),
        save: jest.fn(async (_userId, next) => { runs = next; }),
        all: () => runs,
        latest: () => runs[0] || null,
    };
}

let store;

beforeEach(() => {
    jest.clearAllMocks();
    toolUseSeq = 0;
    turnControl._resetForTests();
    process.env.ADMIN_USER_ID = ADMIN_USER_ID;
    delete process.env.NET_CONTEXT_MAX_CHARS;
    store = memoryStore();
    setRunStoreForTests(store);
    mockSend.mockImplementation(scriptedModel([says('ok')]));
});

afterAll(() => setRunStoreForTests(null));

// ── 1. Intent is decided, not hoped for ────────────────────────────────────

describe('property 1 — a turn that narrates an outcome is made to act', () => {
    it('nudges once, runs the tool, and the step is in the journal', async () => {
        // The reported failure mode: the user asks for an OUTCOME and the model
        // replies with prose about it. Round 1 = "I'll save that", round 2 (after
        // the nudge) = the tool call, round 3 = the confirmation.
        mockSend.mockImplementation(scriptedModel([
            says('Sure, I will add that goal for you.'),
            asksFor('save_note', { text: 'book the ferry' }),
            says('Saved.'),
        ]));
        executeTool.mockResolvedValue('Note saved.');

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('save a note to book the ferry'), res, fakeDynamo());

        // The nudge is the specific corrective line, appended to the system prompt
        // of the SECOND call — not merely "some tool text was in a prompt", which
        // would be true of every turn and would prove nothing.
        const systems = mockSend.mock.calls.map(([c]) => JSON.stringify(c.input?.system || ''));
        expect(systems.length).toBeGreaterThanOrEqual(3);
        expect(systems[0]).not.toMatch(/YOU ANSWERED WITHOUT ACTING/);
        expect(systems[1]).toMatch(/YOU ANSWERED WITHOUT ACTING/);
        // The property, stated as a fact about the record: the turn ACTED.
        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(stepsOf(store.latest())).toEqual(['save_note:ok']);
        // …and the user's answer is the model's confirmation, not the preamble.
        expect(answerText(res)).toContain('Saved');
    });

    it('believes the model when it declines twice — no infinite nudging', async () => {
        mockSend.mockImplementation(scriptedModel([says('Here is a summary of your goals.')]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('what are my goals?'), res, fakeDynamo());

        expect(executeTool).not.toHaveBeenCalled();
        // A chat turn records a run with no steps, and the answer still arrives.
        expect(store.latest().steps).toEqual([]);
        expect(res.events.filter((e) => e.type === 'token').map((e) => e.text).join('')).toBe('streamed answer');
    });
});

// ── 2. Steps are observable ────────────────────────────────────────────────

describe('property 2 — steps are structured, redacted and persisted', () => {
    it('records each step live, then persists the whole turn exactly once', async () => {
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_search', { query: 'MARKER' }),
            asksFor('repo_read_file', { path: 'backend/services/llmService.js' }),
            says('Found it.'),
        ]));
        executeTool.mockImplementation(async (name) => (name === 'repo_search' ? '2 matches' : 'file body'));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('where is MARKER?'), res, fakeDynamo());

        // Live: a step event per call, opened and closed, so the UI can update a row.
        const stepEvents = res.events.filter((e) => e.type === 'step').map((e) => e.step);
        expect(stepEvents.map((s) => s.status)).toEqual(['running', 'ok', 'running', 'ok']);
        expect(stepEvents[0].tool).toBe('repo_search');
        expect(stepEvents[0].plane).toBe('repo');

        // Persisted: ONE write for the turn, carrying the steps.
        expect(store.save).toHaveBeenCalledTimes(1);
        const run = store.latest();
        expect(run.outcome).toBe('completed');
        expect(run.steps).toHaveLength(2);
        expect(run.steps.map((s) => s.ms)).toEqual([expect.any(Number), expect.any(Number)]);
        expect(run.rounds).toBe(2);
    });

    it('does not carry a private argument into the record', async () => {
        // The journal's redaction rule, asserted through the real route: a note
        // body is the user's own writing and must not be duplicated into a
        // transcript that a later screen renders.
        mockSend.mockImplementation(scriptedModel([
            asksFor('save_note', { text: 'my diary entry about the ferry' }),
            says('Saved.'),
        ]));
        executeTool.mockResolvedValue('Note saved.');

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('save a note'), res, fakeDynamo());

        const step = store.latest().steps[0];
        expect(step.argsRedacted).toBe(true);
        expect(step.argKeys).toEqual(['text']);
        expect(JSON.stringify(store.latest())).not.toContain('diary');
    });
});

// ── 3. The turn is controllable ────────────────────────────────────────────

describe('property 3 — the turn can be stopped, and the record says so', () => {
    it('a cancel mid-turn finishes the step it is on and ends the turn legally', async () => {
        const res = fakeRes();
        let ran = 0;
        executeTool.mockImplementation(async (name) => {
            ran += 1;
            // The user hits Stop while the first tool is running. The cancel is
            // noticed at the next SAFE BOUNDARY — never mid-step, because a
            // half-applied edit is worse than a slow one.
            if (ran === 1) turnControl.cancelTurn(res.runId, 'stopped');
            return `${name} done`;
        });
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_search', { query: 'a' }, 'Searching.'),
            asksFor('repo_read_file', { path: 'a.js' }, 'Reading.'),
            says('never reached'),
        ]));

        await streamCompressionRequest(fakeReq('find it'), res, fakeDynamo());

        expect(res.events.some((e) => e.type === 'cancelled')).toBe(true);
        expect(ran).toBe(1); // the second tool never ran
        const run = store.latest();
        expect(run.outcome).toBe('cancelled');
        expect(run.steps).toHaveLength(1);
        expect(run.steps[0].status).toBe('ok');
    });

    it('a refused step is recorded as a refusal, not as a failure or a success', async () => {
        // Only `ask`-policy tools prompt (toolScopes.js), and `repo_commit_changes`
        // is the only one. The gate denies it here, which is what a user clicking
        // Deny produces.
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_commit_changes', { message: 'Fix the footer' }),
            says('Understood — nothing was committed.'),
        ]));

        const res = fakeRes();
        const pending = streamCompressionRequest(fakeReq('commit the change'), res, fakeDynamo());
        const approval = await waitForEvent(res, 'approval');
        expect(approval.approval.options).toEqual(['Approve', 'Deny']);
        expect(turnControl.resolveApproval(approval.approval.id, false, 'you declined')).toBe(true);
        await pending;

        expect(executeTool).not.toHaveBeenCalled();
        const step = store.latest().steps[0];
        // `denied` is its own state: a red ✕ would report the user's decision as a
        // fault, and a ✓ would report it as work that happened.
        expect(step.status).toBe('denied');
        expect(step.outcome).toBe('permission');
    });
});

// ── 4. Both hands work in one loop ─────────────────────────────────────────

describe('property 4 — cloud, repo and PC in ONE turn', () => {
    it('uses all three planes without the user picking a mode', async () => {
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_search', { query: 'Net.jsx' }),
            asksFor('pc_status', {}),
            asksFor('pc_do', { tool: 'open_app', args: { name: 'edge' } }),
            asksFor('save_note', { text: 'done' }),
            says('Opened Edge and saved a note.'),
        ]));
        executeTool.mockImplementation(async (name) => {
            if (name === 'pc_status') return 'This PC offers 18 tools (safe-read: allow, others: ask).';
            if (name === 'pc_do') return 'pc_do open_app → opened';
            return `${name} ok`;
        });

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('find the net page and open edge, then note it'), res, fakeDynamo());

        const planes = store.latest().steps.map((s) => s.plane);
        // The point of the property: ONE turn, one loop, three planes. Before P2
        // this was impossible — the message went to the addon's loop OR the cloud.
        expect(new Set(planes)).toEqual(new Set(['repo', 'addon', 'cloud']));
        expect(store.latest().steps.every((s) => s.status === 'ok')).toBe(true);
    });
});

// ── 5. Verification closes ─────────────────────────────────────────────────

describe('property 5 — a change is checked, not asserted', () => {
    it('runs the allowlisted check before claiming the work is done', async () => {
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_edit_file', { path: 'backend/constants/costs.js', old_string: 'a', new_string: 'b' }),
            asksFor('repo_run', { task: 'test:file', target: 'backend/__tests__/unit/costs.test.js' }),
            says('Changed and verified: the costs suite passes.'),
        ]));
        executeTool.mockImplementation(async (name) => {
            if (name === 'repo_run') return 'PASS backend/__tests__/unit/costs.test.js (1.2s)';
            return 'edited';
        });

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('raise the goal limit'), res, fakeDynamo());

        const steps = store.latest().steps;
        expect(steps.map((s) => s.tool)).toEqual(['repo_edit_file', 'repo_run']);
        // The evidence is what makes the claim true — and it is in the record.
        expect(steps[1].resultPreview).toMatch(/PASS/);
        expect(executeTool).toHaveBeenCalledWith('repo_run', expect.objectContaining({ task: 'test:file' }), expect.anything());
    });
});

// ── 6. Cost is governed ────────────────────────────────────────────────────

describe('property 6 — a runaway turn is bounded, and says why', () => {
    it('stops on the context budget with a wrap-up whose notice names the real reason', async () => {
        // Every round returns a huge result and the model never stops asking, so
        // the history outgrows the budget. Trimming is tried first — the loop only
        // gives up when it cannot win.
        process.env.NET_CONTEXT_MAX_CHARS = '4000';
        executeTool.mockImplementation(async () => `Error: ${'x'.repeat(6000)}`);
        mockSend.mockImplementation(scriptedModel([asksFor('repo_read_file', { path: 'huge.js' })]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('read the huge file'), res, fakeDynamo());

        // The wrap-up call is made with the notice, and it is the CONTEXT notice —
        // telling the model it ran out of rounds would be a lie (rounds remain).
        const systems = mockSend.mock.calls.map(([c]) => JSON.stringify(c.input?.system || ''));
        expect(systems.some((s) => /CONTEXT LIMIT REACHED/.test(s))).toBe(true);
        expect(systems.some((s) => /TOOL LIMIT REACHED/.test(s))).toBe(false);
        // The turn ended without an error, and the loop stopped early rather than
        // spending all 16 rounds.
        expect(res.events.some((e) => e.type === 'error')).toBe(false);
        expect(store.latest().rounds).toBeLessThan(16);
    });
});

// ── The failure guards P6 added, also properties ───────────────────────────

describe('failure handling — a refusal is never retried, a transient read is', () => {
    it('does not repeat a refused step, and tells the model not to', async () => {
        mockSend.mockImplementation(scriptedModel([
            asksFor('pc_do', { tool: 'shell_run', args: { command: 'dir' } }),
            says('The PC refused it, so I have not run it.'),
        ]));
        executeTool.mockResolvedValue('Denied: pc_do shell_run was refused on the PC: denied by policy.');

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('list my files on the pc'), res, fakeDynamo());

        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(store.latest().steps[0].outcome).toBe('permission');
        expect(store.latest().steps[0].status).toBe('denied');
        // The instruction reached the model, which is the whole point of the taxonomy.
        expect(mockSend.mock.calls.some(([c]) => JSON.stringify(c.input.messages).includes('HARNESS: REFUSED'))).toBe(true);
    });

    it('retries a flaky READ below the model, and records one step', async () => {
        let calls = 0;
        executeTool.mockImplementation(async () => {
            calls += 1;
            return calls === 1 ? 'Error: connect ETIMEDOUT' : '2 matches';
        });
        mockSend.mockImplementation(scriptedModel([
            asksFor('repo_search', { query: 'x' }),
            says('Found 2 matches.'),
        ]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('search for x'), res, fakeDynamo());

        expect(executeTool).toHaveBeenCalledTimes(2);
        const run = store.latest();
        // ONE step, and it is `ok`: the retry is a detail of ONE step, not a
        // second step the user has to read.
        expect(run.steps).toHaveLength(1);
        expect(run.steps[0]).toMatchObject({ status: 'ok', retried: true, outcome: null });
        expect(run.rounds).toBe(1);
        expect(res.events.some((e) => e.type === 'error')).toBe(false);
    });
});

// ── Continuity: the SECOND turn knows what the first one left unfinished ────

describe('continuity — a turn picks up where the last one stopped', () => {
    /**
     * The system prompt of every model call this turn made.
     *
     * `system` is a BLOCK array (`[{text}, {cachePoint}]` — see
     * bedrockPromptCache.js), so reading it as a string would compare against
     * "[object Object]" and quietly make every `not.toContain` assertion pass.
     */
    const systemPrompts = () => mockSend.mock.calls.map(([c]) => {
        const system = c.input?.system;
        if (Array.isArray(system)) return system.map((b) => b?.text || '').join('\n');
        return String(system || '');
    });

    it('carries an unfinished plan into the NEXT turn', async () => {
        // Turn 1: publish a plan, do the first step, run out of luck on the second.
        withRealSetPlan();
        mockSend.mockImplementation(scriptedModel([
            asksFor('set_plan', { items: [
                { text: 'find the limit', status: 'in_progress' },
                { text: 'raise it', status: 'pending' },
            ] }),
            asksFor('repo_search', { query: 'MAX_GOAL' }),
            says('Found it; I have not changed anything yet.'),
        ]));
        executeTool.mockImplementation(async (name, args, ctx) => (
            name === 'set_plan' ? realToolSurface.executeTool(name, args, ctx) : '2 matches'
        ));
        await streamCompressionRequest(fakeReq('raise the goal limit'), fakeRes(), fakeDynamo());

        // The turn is now the previous turn. Its plan is unfinished.
        expect(store.latest().plan.items.some((i) => i.status !== 'done')).toBe(true);

        // Turn 2: a fresh request. The model has NOT been sent the previous prose's
        // tool results — those live on the assistant message — so without this note
        // it would have no idea any of it happened.
        mockSend.mockClear();
        mockSend.mockImplementation(scriptedModel([says('Continuing.')]));
        await streamCompressionRequest(fakeReq('keep going'), fakeRes(), fakeDynamo());

        const prompt = systemPrompts()[0];
        expect(prompt).toContain('WHERE THE LAST TURN LEFT OFF');
        expect(prompt).toContain('it was working on: find the limit');
        expect(prompt).toContain('[pending] raise it');
        // …and it is told to resume rather than start over.
        expect(prompt).toMatch(/pick up from the step above rather than starting again/);
    });

    it('carries a FAILED step forward, with its kind', async () => {
        // Turn 1: a step fails with a classification the model must not have to
        // rediscover — here a refusal, which also means "do not retry it yourself".
        mockSend.mockImplementation(scriptedModel([
            asksFor('pc_do', { tool: 'shell_run' }),
            says('The PC refused that.'),
        ]));
        executeTool.mockResolvedValue('Denied: pc_do shell_run was refused on the PC: denied by policy.');
        await streamCompressionRequest(fakeReq('list my files on the pc'), fakeRes(), fakeDynamo());

        mockSend.mockClear();
        mockSend.mockImplementation(scriptedModel([says('Understood.')]));
        await streamCompressionRequest(fakeReq('ok'), fakeRes(), fakeDynamo());

        const prompt = systemPrompts()[0];
        expect(prompt).toContain('pc_do (permission)');
        expect(prompt).toMatch(/Do not retry a refused step on your own/);
    });

    it('says NOTHING after a turn that finished cleanly', async () => {
        // The case that decides whether this is signal or wallpaper: most turns
        // succeed, and a note on every one of them is a note the model skips.
        mockSend.mockImplementation(scriptedModel([asksFor('repo_search', { query: 'x' }), says('Found it.')]));
        executeTool.mockResolvedValue('2 matches');
        await streamCompressionRequest(fakeReq('search for x'), fakeRes(), fakeDynamo());

        mockSend.mockClear();
        mockSend.mockImplementation(scriptedModel([says('Sure.')]));
        await streamCompressionRequest(fakeReq('hello again'), fakeRes(), fakeDynamo());

        expect(systemPrompts()[0]).not.toContain('WHERE THE LAST TURN LEFT OFF');
    });

    it('says nothing when there is no journal to read', async () => {
        // A first-ever turn, and the failure mode that must never happen: an
        // unreadable journal cannot be allowed to break a turn.
        store.load.mockRejectedValue(new Error('table missing'));

        mockSend.mockImplementation(scriptedModel([asksFor('repo_search', { query: 'x' }), says('Ok.')]));
        executeTool.mockResolvedValue('2 matches');
        const res = fakeRes();
        await streamCompressionRequest(fakeReq('search for x'), res, fakeDynamo());

        expect(res.events.some((e) => e.type === 'error')).toBe(false);
        expect(systemPrompts()[0]).not.toContain('WHERE THE LAST TURN LEFT OFF');
    });
});

// ── The plan surface (P5) ──────────────────────────────────────────────────

describe('the plan surface — what the agent says it is doing', () => {
    const planCall = (items) => asksFor('set_plan', { items });
    const planEvents = (res) => res.events.filter((e) => e.type === 'plan').map((e) => e.plan);

    it('publishes a plan, updates it, and ends with nothing in progress', async () => {
        withRealSetPlan();
        mockSend.mockImplementation(scriptedModel([
            // Publish before doing anything: this is what makes the turn legible
            // while it runs rather than only reviewable after it.
            planCall([
                { text: 'find the limit', status: 'in_progress' },
                { text: 'raise it', status: 'pending' },
                { text: 'check it', status: 'pending' },
            ]),
            asksFor('repo_search', { query: 'MAX_GOAL' }),
            // Move the marker as the work happens.
            planCall([
                { text: 'find the limit', status: 'done' },
                { text: 'raise it', status: 'in_progress' },
                { text: 'check it', status: 'pending' },
            ]),
            asksFor('repo_edit_file', { path: 'x.js' }),
            asksFor('repo_run', { task: 'typecheck' }),
            // …and finish with a complete plan.
            planCall([
                { text: 'find the limit', status: 'done' },
                { text: 'raise it', status: 'done' },
                { text: 'check it', status: 'done' },
            ]),
            says('Raised the limit and checked it.'),
        ]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('raise the goal limit'), res, fakeDynamo());

        // One event per CHANGE, not per step: the checklist redraws three times
        // because the plan moved three times, and not on the other steps.
        const plans = planEvents(res);
        expect(plans).toHaveLength(3);
        expect(plans[0].items.map((i) => i.status)).toEqual(['in_progress', 'pending', 'pending']);
        expect(plans[1].items.map((i) => i.status)).toEqual(['done', 'in_progress', 'pending']);
        // The property the tool exists for: the user can see where the agent is,
        // and when it stops, nothing is left claiming to be running.
        expect(plans[2].counts).toMatchObject({ in_progress: 0, done: 3 });

        // Persisted WITH the turn — a plan means nothing apart from the steps that
        // carried it out, so the two are stored together.
        const run = store.latest();
        expect(run.plan.items).toHaveLength(3);
        expect(run.plan.counts.done).toBe(3);
        expect(run.steps.map((s) => s.tool)).toEqual([
            'set_plan', 'repo_search', 'set_plan', 'repo_edit_file', 'repo_run', 'set_plan',
        ]);
    });

    it('gives the model the checklist back, with the rule to keep it current', async () => {
        withRealSetPlan();
        mockSend.mockImplementation(scriptedModel([
            planCall([{ text: 'only step', status: 'in_progress' }]),
            says('Done.'),
        ]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('do the thing'), res, fakeDynamo());

        // The tool result is the ONLY prompt the model gets about updating the
        // plan, and it arrives exactly when that reminder is worth having.
        // (Matched loosely because the serialised message escapes its quotes.)
        const sentToModel = mockSend.mock.calls.map(([c]) => JSON.stringify(c.input.messages || [])).join(' ');
        expect(sentToModel).toContain('PLAN VISIBLE TO THE USER');
        expect(sentToModel).toMatch(/call set_plan again when .*only step.* finishes/);
    });

    it('a turn that publishes no plan sends no plan event and persists none', async () => {
        // The plan is an opt-in artefact. A one-step turn has no plan, and the
        // client must not be sent an empty checklist to render.
        mockSend.mockImplementation(scriptedModel([asksFor('save_note', { text: 'x' }), says('Saved.')]));
        executeTool.mockResolvedValue('ok');

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('save a note'), res, fakeDynamo());

        expect(planEvents(res)).toEqual([]);
        expect(store.latest().plan).toBeNull();
    });

    it('a chat turn publishes no plan at all', async () => {
        mockSend.mockImplementation(scriptedModel([says('Here is a summary.')]));

        const res = fakeRes();
        await streamCompressionRequest(fakeReq('what are my goals?'), res, fakeDynamo());

        expect(planEvents(res)).toEqual([]);
        expect(store.latest().plan).toBeNull();
    });
});

/** Poll until an event of this type appears (the approval scenario needs it). */
async function waitForEvent(res, type, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const found = res.events.find((e) => e.type === type);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for a "${type}" event (saw: ${res.events.map((e) => e.type).join(', ')})`);
}
