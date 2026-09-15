import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import TalkAvatar from './TalkAvatar.jsx';

/**
 * TalkAvatar — the picture when there is one, initials when there isn't.
 *
 * The fallback is the interesting half: a contact list is a column of these, so
 * "GU" vs "GW" has to distinguish two people, and the `<img>` must carry the
 * name for anyone using a screen reader.
 */

const PICTURE = 'data:image/jpeg;base64,AAAA';

afterEach(cleanup);

describe('TalkAvatar', () => {
  test('draws the picture with the person named in the alt text', () => {
    render(<TalkAvatar src={PICTURE} name="Guest User" />);
    const img = screen.getByRole('img', { name: "Guest User's profile picture" });
    expect(img).toHaveAttribute('src', PICTURE);
  });

  test('falls back to initials when there is no picture', () => {
    const { container } = render(<TalkAvatar name="Guest User" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).toBe('GU');
  });

  test('the initials are decorative — the name is always beside them', () => {
    const { container } = render(<TalkAvatar name="Guest User" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test('an unknown or missing name still renders a frame, never "undefined"', () => {
    const { container } = render(<TalkAvatar />);
    expect(container.textContent).toBe('?');
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });

  test('the caller owns the frame class so each place can size it', () => {
    const { container } = render(<TalkAvatar name="Sam H." className="talk-dm-avatar" />);
    expect(container.firstChild).toHaveClass('talk-dm-avatar');
    expect(container.firstChild).not.toHaveClass('talk-avatar');
  });

  test('the picture uses the shared image class, so both frames style it once', () => {
    const { container } = render(<TalkAvatar src={PICTURE} name="Guest User" />);
    expect(container.querySelector('img')).toHaveClass('talk-avatar__img');
  });
});
