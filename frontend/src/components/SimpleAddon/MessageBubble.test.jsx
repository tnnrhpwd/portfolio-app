import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import MessageBubble from './MessageBubble.jsx';

jest.mock('../../services/simpleAddonApi', () => ({
  openFile: jest.fn().mockResolvedValue(undefined),
  getAddonBaseUrl: () => 'http://127.0.0.1:3001',
}));

/**
 * `react-markdown` is ESM-only and the root Jest config does not transform
 * `node_modules`, so it cannot be imported here. This stub covers the one piece
 * of its contract these tests depend on: a `[text](url)` link is handed to the
 * caller's `components.a` renderer. **That override is our code, and it is the
 * thing under test** — the assertion is about which element we return for a
 * given href, not about react-markdown's parsing.
 */
jest.mock('react-markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children, components }) => {
      const text = String(children ?? '');
      const Anchor = components?.a;
      const nodes = [];
      const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        nodes.push(
          Anchor
            ? React.createElement(Anchor, { key: match.index, href: match[2] }, match[1])
            : React.createElement('a', { key: match.index, href: match[2] }, match[1])
        );
        cursor = match.index + match[0].length;
      }
      if (cursor < text.length) nodes.push(text.slice(cursor));
      return React.createElement('div', null, nodes);
    },
  };
});

const assistant = (overrides = {}) => ({
  id: 'm1',
  role: 'assistant',
  content: 'Hello',
  timestamp: '2026-09-11T12:00:00.000Z',
  ...overrides,
});

const renderBubble = (message, props = {}) =>
  render(
    <MemoryRouter>
      <MessageBubble message={message} {...props} />
    </MemoryRouter>
  );

/**
 * The chat is where a user finds out they ran out of credits. Two things must
 * hold at that moment, and both used to fail:
 *
 *  1. The upgrade CTA has to work with the chat's markdown setting OFF — the old
 *     `[Upgrade Now →](/pay?plan=pro)` in the message body rendered as literal
 *     brackets and the money path silently did nothing (`BUSINESS.md` (funnel gaps)).
 *  2. Internal links must stay in the app. The old blanket `target="_blank"`
 *     threw "Upgrade Now" into a second browser tab and reloaded the SPA.
 */
describe('MessageBubble', () => {
  afterEach(cleanup);

  it('shows the agent PLAN above the steps it actually took', () => {
    // Two different questions in one bubble, in the order a user asks them:
    // what is it doing (the plan, which they can still correct) and what did it
    // do (the steps, which are evidence). This also pins the WIRING — a plan that
    // arrived on the message but was never passed to PlanChecklist would render
    // nothing and fail silently, which is exactly the bug a component test on its
    // own cannot catch.
    const { container } = renderBubble(assistant({
      content: 'Working on it.',
      plan: {
        items: [
          { id: 'p1', text: 'find the limit', status: 'done' },
          { id: 'p2', text: 'raise it', status: 'in_progress' },
        ],
        counts: { pending: 0, in_progress: 1, done: 1, blocked: 0 },
      },
      steps: [{
        id: 's1', tool: 'repo_search', plane: 'repo', label: 'Searching the repository…',
        status: 'ok', argsPreview: { query: 'x' }, argsRedacted: false, argKeys: [],
        resultPreview: '2 matches', error: null, ms: 40,
      }],
    }));

    expect(screen.getByLabelText('Agent plan')).toBeInTheDocument();
    expect(screen.getByText('raise it')).toBeInTheDocument();
    // The plan comes FIRST: it is the question being asked while the turn runs.
    const html = container.innerHTML;
    expect(html.indexOf('Agent plan')).toBeLessThan(html.indexOf('Agent steps'));
  });

  it('renders no plan frame when the turn published none', () => {
    // Most turns have no plan (one tool call, or a plain reply). An empty frame
    // would make every answer look like it was supposed to have one.
    const { container } = renderBubble(assistant({ content: 'Here you go.' }));

    expect(container.querySelector('.plan')).toBeNull();
  });

  it('threads the retry handler down to the step that needs it', () => {
    // The same class of bug the plan assertion above guards: a prop that arrives
    // at the bubble and is never passed on fails SILENTLY — the button simply is
    // not there, which looks exactly like "this step is not re-askable". A test on
    // StepList alone cannot see it, because StepList is never given the prop.
    const onRetryStep = jest.fn();
    renderBubble(
      assistant({
        content: 'I could not do that.',
        steps: [{
          id: 's1', tool: 'pc_do', plane: 'addon', label: 'Opening Notepad…',
          status: 'denied', argsPreview: null, argsRedacted: true, argKeys: [],
          resultPreview: 'Denied (expired): …', error: null, ms: 0,
          outcome: 'permission', cause: 'expired', reaskable: true,
        }],
      }),
      { onRetryStep },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetryStep).toHaveBeenCalledTimes(1);
    expect(onRetryStep.mock.calls[0][0]).toMatchObject({ id: 's1', cause: 'expired' });
  });

  it('renders no retry button when the chat passes no handler', () => {
    renderBubble(assistant({
      content: 'I could not do that.',
      steps: [{
        id: 's1', tool: 'pc_do', plane: 'addon', label: 'Opening Notepad…',
        status: 'denied', argsPreview: null, argsRedacted: true, argKeys: [],
        resultPreview: 'Denied (expired): …', error: null, ms: 0,
        outcome: 'permission', cause: 'expired', reaskable: true,
      }],
    }));

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('renders a structured action as an in-app link, with markdown ON', () => {
    renderBubble(
      assistant({
        content: 'Usage Limit Reached',
        actions: [{ label: 'Upgrade Now', to: '/pay?plan=pro' }],
      })
    );

    const cta = screen.getByRole('link', { name: /upgrade now/i });
    expect(cta).toHaveAttribute('href', '/pay?plan=pro');
    // A router link, not a new tab.
    expect(cta).not.toHaveAttribute('target');
  });

  it('renders the action with markdown OFF — the reason it is not a markdown link', () => {
    renderBubble(
      assistant({
        content: 'Usage Limit Reached',
        actions: [{ label: 'Upgrade Now', to: '/pay?plan=pro' }],
      }),
      { enableMarkdown: false }
    );

    // Plain-text mode still shows the CTA, still as a link…
    expect(screen.getByRole('link', { name: /upgrade now/i }))
      .toHaveAttribute('href', '/pay?plan=pro');
    // …and the body carries no raw markdown syntax for it.
    expect(screen.queryByText(/\[Upgrade Now\]/)).toBeNull();
  });

  it('can offer a way out instead, when upgrading is paused', () => {
    renderBubble(
      assistant({
        content: 'Usage Limit Reached',
        actions: [{ label: 'Ask us about Pro', to: '/support?tab=contact' }],
      })
    );

    expect(screen.getByRole('link', { name: /ask us about pro/i }))
      .toHaveAttribute('href', '/support?tab=contact');
  });

  it('keeps internal markdown links inside the app', () => {
    renderBubble(assistant({ content: 'See [pricing](/pricing) for details.' }));

    const link = screen.getByRole('link', { name: 'pricing' });
    expect(link).toHaveAttribute('href', '/pricing');
    expect(link).not.toHaveAttribute('target');
  });

  it('still opens external markdown links in a new tab safely', () => {
    renderBubble(assistant({ content: 'Read [the docs](https://example.test/docs).' }));

    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.test/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no action row when the message has none', () => {
    const { container } = renderBubble(assistant({ content: 'Just talking.' }));

    expect(container.querySelector('.message__actions')).toBeNull();
  });

  it('ignores actions on a user message', () => {
    const { container } = renderBubble(
      assistant({ role: 'user', actions: [{ label: 'Upgrade Now', to: '/pay?plan=pro' }] })
    );

    expect(container.querySelector('.message__actions')).toBeNull();
  });

  /**
   * The backend resolves every tool call before it streams a token, so a repo
   * task is an empty bubble for up to a minute — which users read as a freeze
   * (2026-09-14). The progress line is what tells them otherwise.
   */
  describe('progress note', () => {
    it('shows what the agent is doing while its bubble is still empty', () => {
      renderBubble(assistant({ content: '', isStreaming: true, progressNote: 'Editing Net.css…' }));

      expect(screen.getByRole('status')).toHaveTextContent('Editing Net.css…');
    });

    it('disappears once the answer arrives', () => {
      renderBubble(assistant({ content: 'Raised it to 5,000.', progressNote: null }));

      expect(screen.queryByRole('status')).toBeNull();
    });

    it('never renders on an error bubble', () => {
      renderBubble(assistant({ content: '**Error:** boom', isError: true, progressNote: 'Editing Net.css…' }));

      expect(screen.queryByRole('status')).toBeNull();
    });

    it('is absent on a normal finished message', () => {
      renderBubble(assistant({ content: 'All done.' }));

      expect(screen.queryByRole('status')).toBeNull();
    });
  });
});
