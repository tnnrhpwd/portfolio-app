/**
 * pcTools.test.js — the two tools that act on the user's own PC.
 *
 * The relay is faked: what is under test is what the MODEL is told, not the
 * transport (that has its own suite in addonDispatch.test.js).
 *
 *   - it must not guess tool names, and an unknown name must be refused BEFORE a
 *     dispatch — otherwise the user gets an approval prompt for a tool that does
 *     not exist;
 *   - a refusal and a timeout must read differently, because one means "the user
 *     said no" and the other means "we do not know" — and that difference decides
 *     whether the model tries again;
 *   - the policy the addon published must reach the model, so it can say "this
 *     will ask you on your PC" before promising anything.
 */

jest.mock('../../controllers/addonRelayController', () => ({
  readDeviceTools: jest.fn(),
  dispatchToolToAddon: jest.fn(),
}));

const relay = require('../../controllers/addonRelayController');
const pcTools = require('../../services/pcTools');

const CTX = { userId: 'u1' };
const status = (args = {}) => pcTools.PC_TOOL_EXECUTORS.pc_status(args, CTX);
const doIt = (args) => pcTools.PC_TOOL_EXECUTORS.pc_do(args, CTX);

const device = (over = {}) => ({
  deviceId: 'dev-1',
  hostname: 'STUDIO',
  platform: 'win32/x64',
  online: true,
  tools: [
    { name: 'window_list', category: 'safe-read' },
    { name: 'uia_find', category: 'safe-read' },
    { name: 'open_app', category: 'system' },
    { name: 'shell_run', category: 'shell' },
  ],
  policy: {
    categories: { 'safe-read': 'allow', shell: 'ask', system: 'ask' },
    dryRunMode: false,
    autoApproveAll: false,
    globalKillSwitch: false,
  },
  ...over,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('pc_status', () => {
  test('no PC at all says so, and does not pretend', async () => {
    relay.readDeviceTools.mockResolvedValue({ deviceId: null, online: false, tools: [], policy: null });
    const out = await status();
    expect(out).toMatch(/No PC is connected/);
    expect(out).toMatch(/cannot control a PC that has not connected/);
  });

  test('an addon that stopped heartbeating is reported, not silently empty', async () => {
    relay.readDeviceTools.mockResolvedValue(device({ online: false }));
    expect(await status()).toMatch(/STUDIO.*not responding/);
  });

  test('lists the tools by category with the real policy wording', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    const out = await status();

    expect(out).toMatch(/PC "STUDIO" is connected \(win32\/x64\)/);
    expect(out).toContain('safe-read (runs without asking): window_list, uia_find');
    expect(out).toContain('shell (asks you on your PC first): shell_run');
    expect(out).toContain('system (asks you on your PC first): open_app');
    expect(out).toMatch(/pc_do/);
  });

  test('a category the policy is silent about reads as undecided, not as allowed', async () => {
    relay.readDeviceTools.mockResolvedValue(device({
      tools: [{ name: 'text_type', category: 'system' }],
      policy: { categories: {} },
    }));
    expect(await status()).toContain('system (your PC decides whether to ask)');
  });

  test('shouts about the kill switch and dry-run, because they change every answer', async () => {
    relay.readDeviceTools.mockResolvedValue(device({
      policy: { categories: { shell: 'ask' }, globalKillSwitch: true, dryRunMode: true, autoApproveAll: true },
    }));
    const out = await status();
    expect(out).toMatch(/kill switch is ON/);
    expect(out).toMatch(/Dry-run mode is on/);
    expect(out).toMatch(/auto-approve is ON/);
  });

  test('an older addon that published no catalog is described honestly', async () => {
    relay.readDeviceTools.mockResolvedValue(device({ tools: [] }));
    expect(await status()).toMatch(/has not published its tool list/);
  });
});

describe('pc_do', () => {
  test('needs a tool name', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    expect(await doIt({})).toMatch(/tool is required/);
    expect(relay.dispatchToolToAddon).not.toHaveBeenCalled();
  });

  test('a tool this PC does not have is refused before anything is dispatched', async () => {
    relay.readDeviceTools.mockResolvedValue(device());

    const out = await doIt({ tool: 'shell_run_typo' });

    expect(out).toMatch(/is not one of this PC's tools/);
    expect(out).toContain('shell_run'); // …and it lists what IS available
    expect(relay.dispatchToolToAddon).not.toHaveBeenCalled();
  });

  test('nothing is dispatched to a PC that is not there', async () => {
    relay.readDeviceTools.mockResolvedValue({ deviceId: null, online: false, tools: [], policy: null });
    expect(await doIt({ tool: 'window_list' })).toMatch(/No PC is connected/);
    expect(relay.dispatchToolToAddon).not.toHaveBeenCalled();

    relay.readDeviceTools.mockResolvedValue(device({ online: false }));
    expect(await doIt({ tool: 'window_list' })).toMatch(/not responding/);
    expect(relay.dispatchToolToAddon).not.toHaveBeenCalled();
  });

  test('dispatches with the args as given and reports the result', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    relay.dispatchToolToAddon.mockResolvedValue({ ok: true, result: 'opened notepad' });

    const out = await doIt({ tool: 'open_app', args: { name: 'notepad' } });

    expect(relay.dispatchToolToAddon).toHaveBeenCalledWith({
      userId: 'u1', tool: 'open_app', args: { name: 'notepad' }, timeoutMs: pcTools.PC_TOOL_TIMEOUT_MS,
    });
    expect(out).toBe('pc_do open_app → opened notepad');
  });

  test('junk args become an empty object rather than crashing the dispatch', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    relay.dispatchToolToAddon.mockResolvedValue({ ok: true, result: 'ok' });

    await doIt({ tool: 'window_list', args: 'not-an-object' });
    expect(relay.dispatchToolToAddon.mock.calls[0][0].args).toEqual({});
  });

  test('a REFUSAL says so, and tells the model not to retry it', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    relay.dispatchToolToAddon.mockResolvedValue({ ok: false, error: 'Denied by permission policy (category "shell").' });

    const out = await doIt({ tool: 'shell_run', args: { command: 'dir' } });

    expect(out).toMatch(/was refused on the PC/);
    expect(out).toMatch(/Do not retry/);
  });

  test('a TIMEOUT reads as unknown — not as failure, and not as success', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    relay.dispatchToolToAddon.mockResolvedValue({ ok: false, error: 'the PC did not answer within 120s' });

    const out = await doIt({ tool: 'shell_run' });

    expect(out).toMatch(/did not answer in time/);
    expect(out).toMatch(/may still be waiting for the user to approve/);
    expect(out).toMatch(/do NOT repeat it/);
  });

  test('a very long result is clipped for the context', async () => {
    relay.readDeviceTools.mockResolvedValue(device());
    relay.dispatchToolToAddon.mockResolvedValue({ ok: true, result: 'x'.repeat(50000) });

    const out = await doIt({ tool: 'window_list' });
    expect(out.length).toBeLessThan(9000);
    expect(out).toMatch(/chars omitted/);
  });

  test('a missing catalog skips the name pre-check but still dispatches', async () => {
    // An older addon publishes no list. Refusing here would break a call the
    // addon itself would happily accept, so the check is skipped — not failed.
    relay.readDeviceTools.mockResolvedValue(device({ tools: [] }));
    relay.dispatchToolToAddon.mockResolvedValue({ ok: true, result: 'done' });

    expect(await doIt({ tool: 'whatever_it_is_called' })).toMatch(/^pc_do whatever_it_is_called/);
    expect(relay.dispatchToolToAddon).toHaveBeenCalled();
  });
});

describe('the schemas cost what they should', () => {
  test('two tools, not forty', () => {
    expect(pcTools.PC_TOOL_SCHEMAS).toHaveLength(2);
    expect(pcTools.PC_TOOL_SCHEMAS.map((t) => t.function.name)).toEqual(['pc_status', 'pc_do']);
  });
});
