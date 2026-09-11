import React from 'react';
import { render, cleanup } from '@testing-library/react';
import ProfileAvatar from './ProfileAvatar.jsx';

/**
 * ProfileAvatar is the one place the "uploaded photo vs. default checkmark"
 * decision is made, and it must pick the right alt text for each case.
 */
describe('ProfileAvatar', () => {
  afterEach(cleanup);

  it('renders the uploaded picture when one is provided', () => {
    const picture = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const { container } = render(<ProfileAvatar picture={picture} name="Tanner" />);
    const img = container.querySelector('img');

    expect(img.getAttribute('src')).toBe(picture);
    expect(img.getAttribute('alt')).toBe("Tanner's profile picture");
  });

  it('falls back to the default checkmark (decorative) when there is no picture', () => {
    const { container } = render(<ProfileAvatar picture={null} name="Tanner" />);
    const img = container.querySelector('img');

    expect(img.getAttribute('src')).toBeTruthy();
    expect(img.getAttribute('src')).not.toContain('data:image');
    // The default avatar is decorative — the name is always adjacent in the UI.
    expect(img.getAttribute('alt')).toBe('');
  });

  it('applies the requested size modifier', () => {
    const { container } = render(<ProfileAvatar size="lg" />);

    expect(container.querySelector('.profile-avatar').className).toContain('profile-avatar--lg');
  });
});
