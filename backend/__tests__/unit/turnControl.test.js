/**
 * turnControl.test.js — cancel and approve an in-flight turn.
 *
 * The failure this whole module exists for: a tool turn was fire-and-forget. The
 * client could stop *rendering* tokens, but the backend kept making model calls
 * and kept executing tools — up to 18 calls and a repository commit after the
 * user had walked away.
 *
 * The contracts worth pinning, in order of how easily they break:
 *   - a cancel DENIES anything parked on a prompt (otherwise a cancelled turn
 *     sits on its timeout while the user waits for nothing)
 *   - asking twice for the same tool does not prompt twice (the model commits,
 *     then commits again → a loop of dialogs)
 *   - every promise resolves exactly once, and never rejects
 */

const turnControl = require('../../services/harness/turnControl.js');

afterEach(() => {
  turnControl._resetForTests();
  jest.useRealTimers();
});

describe('cancel', () => {
  test('marks the turn cancelled, with the reason', () => {
    const turn = turnControl.openTurn('run_1');
    expect(turn.isCancelled()).toBe(false);

    expect(turnControl.cancelTurn('run_1', 'the client disconnected')).toEqual({
      found: true,
      reason: 'the client disconnected',
    });

    expect(turn.isCancelled()).toBe(true);
    expect(turn.cancelReason()).toBe('the client disconnected');
  });

  test('an unknown or already-finished turn is not an error', () => {
    expect(turnControl.cancelTurn('nope')).toEqual({ found: false });
    expect(turnControl.cancelTurn(null)).toEqual({ found: false });
    expect(turnControl.cancelTurn(undefined)).toEqual({ found: false });
  });

  test('cancelling denies a prompt the turn is parked on', async () => {
    const turn = turnControl.openTurn('run_2');
    const pending = turn.requestApproval({ tool: 'repo_commit_changes' });
    expect(turnControl.pendingApprovalCount()).toBe(1);

    turnControl.cancelTurn('run_2');

    await expect(pending.promise).resolves.toEqual({
      approved: false,
      reason: 'the turn was cancelled',
    });
    expect(turnControl.pendingApprovalCount()).toBe(0);
  });

  test('a turn opened without an id is a programming error, not a silent no-op', () => {
    expect(() => turnControl.openTurn()).toThrow(/runId/);
  });
});

describe('requestApproval', () => {
  test('resolves approved when the client says yes', async () => {
    const turn = turnControl.openTurn('run_3');
    const { id, promise } = turn.requestApproval({ tool: 'repo_commit_changes' });

    expect(turnControl.resolveApproval(id, true)).toBe(true);
    await expect(promise).resolves.toEqual({ approved: true, reason: 'approved' });
  });

  test('resolves denied, with the reason the client gave', async () => {
    const turn = turnControl.openTurn('run_4');
    const { id, promise } = turn.requestApproval({ tool: 'repo_commit_changes' });

    expect(turnControl.resolveApproval(id, false, 'not yet')).toBe(true);
    await expect(promise).resolves.toEqual({ approved: false, reason: 'not yet' });
  });

  test('answers only once — a second click is a no-op, not a second resolution', () => {
    const turn = turnControl.openTurn('run_5');
    const { id } = turn.requestApproval({ tool: 'repo_commit_changes' });

    expect(turnControl.resolveApproval(id, true)).toBe(true);
    expect(turnControl.resolveApproval(id, false)).toBe(false);
  });

  test('an unknown approval id is a no-op (expired, or already answered)', () => {
    expect(turnControl.resolveApproval('ap_nope', true)).toBe(false);
    expect(turnControl.resolveApproval(null, true)).toBe(false);
  });

  test('asking twice for the SAME tool does not prompt twice', async () => {
    const turn = turnControl.openTurn('run_6');
    const first = turn.requestApproval({ tool: 'repo_commit_changes' });
    turnControl.resolveApproval(first.id, true);
    await first.promise;

    const second = turn.requestApproval({ tool: 'repo_commit_changes' });
    expect(second.id).toBeNull();
    await expect(second.promise).resolves.toEqual({ approved: true, reason: 'approved earlier this turn' });
    // A DIFFERENT tool still asks.
    expect(turn.requestApproval({ tool: 'repo_push' }).id).not.toBeNull();
  });

  test('a cancelled turn approves nothing', async () => {
    const turn = turnControl.openTurn('run_7');
    turnControl.cancelTurn('run_7');

    const { id, promise } = turn.requestApproval({ tool: 'repo_commit_changes' });
    expect(id).toBeNull();
    await expect(promise).resolves.toMatchObject({ approved: false });
  });

  test('an unanswered prompt denies itself rather than pinning the turn forever', async () => {
    jest.useFakeTimers();
    const turn = turnControl.openTurn('run_8');
    const { promise } = turn.requestApproval({ tool: 'repo_commit_changes' });

    jest.advanceTimersByTime(turnControl.APPROVAL_TIMEOUT_MS);

    await expect(promise).resolves.toEqual({
      approved: false,
      reason: 'no answer in time — try again if you still want this',
    });
  });

  test('heartbeats while pending, so an idle stream is not dropped', async () => {
    jest.useFakeTimers();
    const turn = turnControl.openTurn('run_9');
    const heartbeat = jest.fn();
    const { id, promise } = turn.requestApproval({ tool: 'repo_commit_changes', heartbeat });

    jest.advanceTimersByTime(turnControl.HEARTBEAT_MS * 2);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    turnControl.resolveApproval(id, true);
    await promise;
    // …and stops once answered.
    jest.advanceTimersByTime(turnControl.HEARTBEAT_MS * 3);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  test('a throwing heartbeat cannot break the prompt', async () => {
    jest.useFakeTimers();
    const turn = turnControl.openTurn('run_10');
    const { id, promise } = turn.requestApproval({
      tool: 'repo_commit_changes',
      heartbeat: () => { throw new Error('stream gone'); },
    });

    expect(() => jest.advanceTimersByTime(turnControl.HEARTBEAT_MS)).not.toThrow();
    turnControl.resolveApproval(id, true);
    await expect(promise).resolves.toMatchObject({ approved: true });
  });
});

describe('bookkeeping', () => {
  test('closing a turn denies anything still pending and forgets the turn', async () => {
    const turn = turnControl.openTurn('run_11');
    const pending = turn.requestApproval({ tool: 'repo_commit_changes' });
    expect(turnControl.activeTurnCount()).toBe(1);

    turn.close();

    await expect(pending.promise).resolves.toEqual({ approved: false, reason: 'the turn ended' });
    expect(turnControl.activeTurnCount()).toBe(0);
    expect(turnControl.pendingApprovalCount()).toBe(0);
    expect(turnControl.cancelTurn('run_11')).toEqual({ found: false });
  });

  test('turns do not collide', () => {
    turnControl.openTurn('run_a');
    turnControl.openTurn('run_b');
    expect(turnControl.activeTurnCount()).toBe(2);
    expect(turnControl.cancelTurn('run_a').found).toBe(true);
    expect(turnControl.cancelTurn('run_b').found).toBe(true);
  });
});
