import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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
 *     brackets and the money path silently did nothing (§16.4).
 *  2. Internal links must stay in the app. The old blanket `target="_blank"`
 *     threw "Upgrade Now" into a second browser tab and reloaded the SPA.
 */
describe('MessageBubble', () => {
  afterEach(cleanup);

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
});
