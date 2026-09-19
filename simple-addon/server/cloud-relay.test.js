/**
 * Unit tests for CloudRelayService's two new behaviours (cloud harness, P2):
 *
 *   1. the ADAPTIVE poll interval — a burst of cloud-dispatched tool calls used
 *      to pay the 3s idle interval on every step;
 *   2. the `tool` command kind — one tool call from the cloud, executed through
 *      the injected handler (which routes through the real tool registry, and so
 *      through permissions.js).
 *
 * Plain node, like the rest of this tree: `node simple-addon/server/cloud-relay.test.js`.
 * Everything is inside an async main: `require` plus top-level `await` makes Node
 * refuse to guess the module format.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CloudRelayService } = require('./cloud-relay');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

/** A fetch stub: records the calls, answers with `respond(url)`. */
function stubFetch(respond) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const body = respond(String(url), opts) ?? {};
    return {
      ok: body.__status ? body.__status < 400 : true,
      status: body.__status || 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

function makeRelay(options = {}) {
  const relay = new CloudRelayService(options.chatHandler || (async () => 'chat'), options);
  relay._token = 'test-token';
  relay._running = true;
  return relay;
}

(async () => {
  // ── Adaptive poll interval ────────────────────────────────────────────────
  {
    const relay = makeRelay();
    check('idle cadence is the slow one', relay._nextPollDelay() === 3000, String(relay._nextPollDelay()));

    relay._lastWorkAt = Date.now();
    check('recent work makes it poll fast', relay._nextPollDelay() === 500, String(relay._nextPollDelay()));

    relay._lastWorkAt = Date.now() - 60000;
    check('a burst goes quiet again after the hot window', relay._nextPollDelay() === 3000);

    relay._serverPollMs = 800;
    check('the server hint wins when present', relay._nextPollDelay() === 800, String(relay._nextPollDelay()));

    // A hint can only ever be a hint: a bad value must not make the addon hammer
    // the queue, or put it to sleep for a minute.
    relay._serverPollMs = 5;
    check('an absurdly small hint is clamped up', relay._nextPollDelay() === 250, String(relay._nextPollDelay()));
    relay._serverPollMs = 999999;
    check('an absurdly large hint is clamped down', relay._nextPollDelay() === 3000, String(relay._nextPollDelay()));
    relay._serverPollMs = null;
  }

  // ── The poll adopts the hint and marks the hot window ────────────────────
  {
    const relay = makeRelay();
    stubFetch(() => ({ commands: [{ id: 'c1', type: 'tool', payload: { tool: 'shell_run', args: {} } }], pollMs: 500 }));
    let executed = 0;
    relay._executeCommand = async () => { executed++; };

    await relay._pollForCommands();

    check('the hint from the server is adopted', relay._serverPollMs === 500);
    check('delivered work opens the hot window', (Date.now() - relay._lastWorkAt) < 1000);
    check('the delivered command is dispatched', executed === 1);
  }

  {
    const relay = makeRelay();
    stubFetch(() => ({ commands: [] }));
    relay._serverPollMs = 500; // was hot on the last poll…
    await relay._pollForCommands();
    check('an empty poll drops the hint so the cadence relaxes', relay._serverPollMs === null);
  }

  // ── The `tool` command kind ──────────────────────────────────────────────
  {
    const seen = [];
    const relay = makeRelay({
      toolHandler: async (payload) => { seen.push(payload); return 'tool output'; },
    });
    const calls = stubFetch(() => ({}));

    await relay._executeCommand({ id: 't1', type: 'tool', payload: { tool: 'uia_invoke', args: { name: 'Save' } } });

    check('the tool handler gets the tool and args', seen.length === 1 && seen[0].tool === 'uia_invoke');
    check('the args survive the relay', seen[0].args.name === 'Save');
    const posted = calls.find((c) => c.url.includes('/result/'));
    check('the result is posted back for the cloud to read', posted && posted.body.result === 'tool output');
  }

  {
    // A refused tool must come back as an ERROR the model can act on, not a
    // silent success — the addon's permission gate is what says no.
    const relay = makeRelay({
      toolHandler: async () => { throw new Error('Denied by permission policy (category "shell").'); },
    });
    const calls = stubFetch(() => ({}));

    await relay._executeCommand({ id: 't2', type: 'tool', payload: { tool: 'shell_run', args: {} } });

    const posted = calls.find((c) => c.url.includes('/result/'));
    check('a refusal is posted as an error', posted && /Denied by permission policy/.test(posted.body.error));
    check('a refusal posts no result', posted && posted.body.result === undefined);
  }

  {
    const relay = makeRelay({ toolHandler: null });
    const calls = stubFetch(() => ({}));
    await relay._executeCommand({ id: 't3', type: 'tool', payload: { tool: 'x', args: {} } });
    const posted = calls.find((c) => c.url.includes('/result/'));
    check('a relay with no tool handler fails cleanly', posted && /not configured/.test(posted.body.error));
  }

  // ── Existing kinds still work, and a command never runs twice ────────────
  {
    const relay = makeRelay({ chatHandler: async () => 'hello' });
    const calls = stubFetch(() => ({}));
    await relay._executeCommand({ id: 'c1', type: 'chat', payload: { message: 'hi' } });
    check('chat still works', calls.some((c) => c.body && c.body.result === 'hello'));

    await relay._executeCommand({ id: 'u1', type: 'not-a-real-kind', payload: {} });
    const err = calls[calls.length - 1];
    check('an unknown kind is reported, not thrown', /Unknown command type/.test(err.body.error));
  }

  {
    const relay = makeRelay({ toolHandler: async () => { await new Promise((r) => setTimeout(r, 30)); return 'once'; } });
    const calls = stubFetch(() => ({}));
    const slow = relay._executeCommand({ id: 'dup', type: 'tool', payload: { tool: 'x', args: {} } });
    await relay._executeCommand({ id: 'dup', type: 'tool', payload: { tool: 'x', args: {} } }); // re-delivery
    await slow;
    const results = calls.filter((c) => c.url.includes('/result/'));
    check('a re-delivered command is not executed twice', results.length === 1, `${results.length} result(s)`);
    check('and it is no longer in flight', relay._inFlight.size === 0);
  }

  // ── The catalog the cloud publishes to the model ─────────────────────────
  {
    const relay = makeRelay();
    check('no catalog getter means nothing is published', relay._catalogForHeartbeat() === undefined);

    relay.setToolCatalog(() => ({
      tools: [
        { name: 'window_list', category: 'safe-read' },
        { name: 'shell_run', category: 'shell' },
        { name: '', category: 'shell' },                       // nameless → dropped
        { name: 'x'.repeat(80), category: 'y'.repeat(80) },     // clamped
      ],
      policy: { categories: { shell: 'ask' }, globalKillSwitch: true },
    }));
    const catalog = relay._catalogForHeartbeat();
    check('the catalog carries the tools', catalog.tools.length === 3, String(catalog.tools.length));
    check('a nameless entry is dropped', !catalog.tools.some((t) => !t.name));
    check('a long name is clamped', catalog.tools.every((t) => t.name.length <= 40 && t.category.length <= 24));
    check('the policy travels with it', catalog.policy.categories.shell === 'ask' && catalog.policy.globalKillSwitch === true);
    check('the policy is normalised to booleans', catalog.policy.dryRunMode === false);
  }

  {
    // A broken getter must not take the heartbeat down with it — the relay's job
    // is the connection, not the catalog.
    const relay = makeRelay({ toolCatalog: () => { throw new Error('registry exploded'); } });
    check('a throwing catalog getter yields no catalog', relay._catalogForHeartbeat() === undefined);
  }

  {
    const relay = makeRelay({
      toolCatalog: () => ({ tools: Array.from({ length: 200 }, (_, i) => ({ name: `t${i}`, category: 'safe-read' })) }),
    });
    check('the catalog is capped', relay._catalogForHeartbeat().tools.length === 60);
  }

  {
    // …and it really is on the wire.
    const relay = makeRelay({ toolCatalog: () => ({ tools: [{ name: 'window_list', category: 'safe-read' }] }) });
    const calls = stubFetch(() => ({ success: true }));
    await relay._sendHeartbeat();
    const beat = calls.find((c) => c.url.includes('/heartbeat'));
    check('the heartbeat publishes the catalog', beat && beat.body.tools[0].name === 'window_list');
  }

  // ── The handler is wired to the registry, not around it ──────────────────
  {
    const source = fs.readFileSync(path.join(__dirname, 'automation', 'index.js'), 'utf-8');
    const wired = source.split('setToolHandler(')[1] || '';
    check('mountAutomation registers a tool handler', /setToolHandler\(/.test(source));
    check('and it goes through the registry, so permissions.js still applies',
      /registry\.executeTool\(/.test(wired));
  }

  console.log(`\ncloud-relay.test: ${pass}/${pass + fail} PASS`);
  process.exit(fail > 0 ? 1 : 0);
})();
