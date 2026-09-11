import React from 'react';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import SimpleCtaBand from './SimpleCtaBand.jsx';
import SimpleNav from '../SimpleNav/SimpleNav.jsx';
import { SIMPLE_SURFACES } from '../../../constants/simpleSurfaces';

// The band must not need a real PC agent, and it needs a stable download URL to
// assert against. SimpleNav (rendered below for the parity check) reads the same
// hook, so one mock covers both.
const ADDON_URL = 'https://example.test/Simple-Addon-portable.exe';
jest.mock('../../../hooks/simpleAddon/useAddonDetection.js', () => ({
  useAddonDetection: () => ({ isConnected: false, addonStatus: null }),
  ADDON_DOWNLOAD_URL: 'https://example.test/Simple-Addon-portable.exe',
}));

const renderInRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** Letters only, so an emoji icon or the trailing arrow can't affect the label. */
const letters = (el) => el.textContent.replace(/[^\p{L}]/gu, '');

const bandSurfaces = (container) =>
  [...container.querySelectorAll('.simple-cta-surface-link')].map((a) => ({
    to: a.getAttribute('href'),
    label: letters(a.querySelector('.simple-cta-surface-title')),
  }));

/**
 * The closing CTA is where a Discovery page stops selling and starts helping.
 * Its job is to get the visitor *using* Simple — the payment is what happens
 * afterwards, once they like it — so these tests pin the ordering:
 *
 *   the product (Chat + the addon download)  →  then one quiet line about price
 *
 * See docs/implementation/agent.md §16.5 rule 1.
 */
describe('SimpleCtaBand', () => {
  afterEach(cleanup);

  it('leads with the product: the chat and the addon download are the actions', () => {
    const { container } = renderInRouter(<SimpleCtaBand />);
    const actions = container.querySelector('.simple-cta-actions');

    expect(within(actions).getByRole('link', { name: /start chatting/i }))
      .toHaveAttribute('href', '/net');

    const addon = within(actions).getByRole('link', { name: /download the addon/i });
    expect(addon).toHaveAttribute('href', ADDON_URL);
    expect(addon).toHaveAttribute('target', '_blank');
  });

  it('treats price as an afterthought: one quiet line, after the product', () => {
    const { container } = renderInRouter(<SimpleCtaBand />);

    // Exactly one route to pricing in the whole band, and it is not an action.
    const pricing = screen.getAllByRole('link', { name: /see pricing/i });
    expect(pricing).toHaveLength(1);
    expect(within(container.querySelector('.simple-cta-actions')).queryByRole('link', { name: /pricing/i }))
      .toBeNull();

    // …and it is literally last: the note is the band's final element.
    const note = container.querySelector('.simple-cta-note');
    expect(note).toContainElement(pricing[0]);
    expect(note).toBe(container.querySelector('.simple-cta-wrap').lastElementChild);
  });

  it('does not use price-led copy as a call to action', () => {
    renderInRouter(<SimpleCtaBand />);

    // The two phrases that used to sell the price instead of the product.
    expect(screen.queryByText(/see what it costs/i)).toBeNull();
    expect(screen.queryByText(/what i can do for you/i)).toBeNull();
  });

  it('shows the same three surfaces the header switcher shows', () => {
    const band = renderInRouter(<SimpleCtaBand />);
    const nav = renderInRouter(<SimpleNav compact />);

    // The list itself…
    expect(bandSurfaces(band.container)).toEqual(
      SIMPLE_SURFACES.map(({ to, label }) => ({ to, label }))
    );

    // …and the switcher, so the two can never diverge in copy.
    const navLinks = [...nav.container.querySelectorAll('.snav-link')].map((a) => ({
      to: a.getAttribute('href'),
      label: letters(a.querySelector('.snav-link-label')),
    }));
    expect(bandSurfaces(band.container)).toEqual(navLinks);
  });

  it('is a band, not a card grid: every surface link is a real internal <Link>', () => {
    const { container } = renderInRouter(<SimpleCtaBand />);

    for (const { to } of bandSurfaces(container)) {
      // Real hrefs, not onClick handlers — middle-clickable and crawlable.
      expect(to).toMatch(/^\/[\w-]+$/);
    }
  });
});
