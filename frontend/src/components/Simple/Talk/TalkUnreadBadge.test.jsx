/**
 * TalkUnreadBadge — the circle beside a link into Talk.
 *
 * The behaviour that matters is what it does at zero, because that is the state
 * it spends almost all of its life in: rendering nothing at all, rather than a
 * badge reading "0" that the eye has to read and dismiss.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import TalkUnreadBadge from './TalkUnreadBadge.jsx';

test('renders nothing when there is nothing waiting', () => {
  const { container } = render(<TalkUnreadBadge count={0} />);
  expect(container).toBeEmptyDOMElement();
});

test('renders nothing for a missing or unusable count', () => {
  const { container } = render(
    <>
      <TalkUnreadBadge />
      <TalkUnreadBadge count={null} />
      <TalkUnreadBadge count={undefined} />
      <TalkUnreadBadge count="nope" />
      <TalkUnreadBadge count={-2} />
    </>
  );
  expect(container).toBeEmptyDOMElement();
});

test('shows the number, named for a screen reader', () => {
  render(<TalkUnreadBadge count={4} />);
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.getByLabelText('4 unread messages')).toHaveAttribute('title', '4 unread messages');
});

test('names a single message in the singular', () => {
  render(<TalkUnreadBadge count={1} />);
  expect(screen.getByLabelText('1 unread message')).toBeInTheDocument();
});

test('accepts a count that arrived as a string', () => {
  render(<TalkUnreadBadge count="7" />);
  expect(screen.getByText('7')).toBeInTheDocument();
});

test('caps the digits so a badge beside a label cannot grow without end', () => {
  render(<TalkUnreadBadge count={1234} />);
  expect(screen.getByText('99+')).toBeInTheDocument();
  // The full number is still what the badge SAYS — only the glyphs are clipped.
  expect(screen.getByLabelText('1234 unread messages')).toBeInTheDocument();
});

test("carries the caller's own class so a surface can place it", () => {
  render(<TalkUnreadBadge count={2} className="sidebar__unread" />);
  expect(screen.getByText('2')).toHaveClass('talk-badge', 'sidebar__unread');
});
