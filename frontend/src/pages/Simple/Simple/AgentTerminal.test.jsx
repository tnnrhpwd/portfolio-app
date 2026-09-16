import React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AgentTerminal from './AgentTerminal.jsx';

jest.mock('../../../services/simpleAddonApi.js', () => ({
  getAgentEventsUrl: jest.fn(),
}));

jest.mock('../../../services/goalAgentApi.js', () => ({
  getGoalAgentStatus: jest.fn(),
}));

// eslint-disable-next-line import/first
import { getAgentEventsUrl } from '../../../services/simpleAddonApi.js';
// eslint-disable-next-line import/first
import { getGoalAgentStatus } from '../../../services/goalAgentApi.js';

/**
 * jsdom has no EventSource. This stands in for the addon's stream: it records
 * every listener the console registers and can hand back an event, which is the
 * only way to prove the console maps a *named* SSE event (not `onmessage`).
 */
class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  close() { this.closed = true; }

  /** Deliver a named event the way the addon's SSE endpoint does. */
  emit(type, payload) {
    for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(payload) });
  }
}

const lastStream = () => MockEventSource.instances[MockEventSource.instances.length - 1];

/** A cloud run: the steps the server persisted for the goal. */
const cloudStatus = {
  agent: {
    steps: [
      { kind: 'plan', ts: '2026-09-15T14:00:00.000Z', text: 'Read the goal and listed three options' },
      { kind: 'tool', ts: '2026-09-15T14:00:05.000Z', text: 'Calling list_goals', meta: { tool: 'list_goals' } },
      { kind: 'result', ts: '2026-09-15T14:00:09.000Z', text: 'Done — two goals advanced' },
    ],
  },
};

const renderTerminal = (props = {}) => render(
  <AgentTerminal token="t" addonConnected={false} currentGoalSlug={null} running={false} {...props} />
);

beforeEach(() => {
  jest.clearAllMocks();
  MockEventSource.instances = [];
  global.EventSource = MockEventSource;
  getAgentEventsUrl.mockReturnValue('http://127.0.0.1:4000/api/agent/events?sinceSeq=0');
  getGoalAgentStatus.mockResolvedValue(cloudStatus);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  delete global.EventSource;
});

describe('AgentTerminal', () => {
  test('offline and no run: says so, and asks for nothing', async () => {
    renderTerminal();

    expect(await screen.findByText(/desktop agent is offline/)).toBeInTheDocument();
    expect(screen.getByText('No agent')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(getGoalAgentStatus).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  test('connected but idle: opens the stream and waits for the first step', async () => {
    renderTerminal({ addonConnected: true });

    expect(await screen.findByText(/Nothing yet — press/)).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(getAgentEventsUrl).toHaveBeenCalledWith({ sinceSeq: 0 });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastStream().url).toMatch(/\/api\/agent\/events/);
  });

  test('a running local agent is the source, and named events land as lines', async () => {
    renderTerminal({ addonConnected: true, running: true, currentGoalSlug: 'garden' });
    await screen.findByText(/Waiting for the first step/);

    act(() => {
      lastStream().emit('tool.start', { type: 'tool.start', seq: 4, ts: '2026-09-15T14:00:00.000Z', tool: 'list_files', args: { dir: 'Documents' } });
      lastStream().emit('goal.done', { type: 'goal.done', seq: 5, ts: '2026-09-15T14:00:30.000Z', result: 'Two files counted' });
    });

    expect(await screen.findByText('list_files')).toBeInTheDocument();
    expect(screen.getByText('goal done')).toBeInTheDocument();
    expect(screen.getByText('Local agent')).toBeInTheDocument();
    // The local stream wins while it is live: no point polling the same run in
    // its slower cloud shape.
    expect(getGoalAgentStatus).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('list_files')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  test('with no live local run, the cloud steps are read and shown', async () => {
    renderTerminal({ token: 't', currentGoalSlug: 'garden', addonConnected: false });

    expect(await screen.findByText('calling list_goals')).toBeInTheDocument();
    expect(screen.getByText(/Read the goal and listed three options/)).toBeInTheDocument();
    expect(screen.getByText(/^Done — two goals advanced$/)).toBeInTheDocument();
    expect(getGoalAgentStatus).toHaveBeenCalledWith('t', 'garden');
    expect(screen.getByText('Cloud run')).toBeInTheDocument();
    expect(screen.getByText(/updated every 2s/)).toBeInTheDocument();
  });

  test('a rejected cloud poll is swallowed, and the next tick still lands', async () => {
    jest.useFakeTimers();
    getGoalAgentStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(cloudStatus);
    renderTerminal({ token: 't', currentGoalSlug: 'garden' });

    // The mount tick fails; nothing is thrown at the user and the log is empty.
    await act(async () => { await Promise.resolve(); });
    expect(getGoalAgentStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('calling list_goals')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/desktop agent is offline/)).toBeInTheDocument();

    // Two seconds later the poll succeeds and the run shows up.
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByText('calling list_goals')).toBeInTheDocument();
  });

  test('following is on by default and can be held', async () => {
    renderTerminal({ token: 't', currentGoalSlug: 'garden' });
    await screen.findByText('calling list_goals');

    const follow = screen.getByRole('button', { name: /Following/ });
    expect(follow).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(follow);
    expect(screen.getByRole('button', { name: /Held/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the stream is closed when the terminal goes away', async () => {
    const { unmount } = renderTerminal({ addonConnected: true, running: true });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    unmount();
    expect(lastStream().closed).toBe(true);
  });
});
