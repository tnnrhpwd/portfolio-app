import React from 'react';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import ShareProfile, {
  INSTAGRAM_URL,
  facebookShareUrl,
  profileShareLink,
  xShareUrl,
} from './ShareProfile.jsx';

/**
 * The share sheet's whole job is to hand out ONE string correctly, so that is what
 * these tests pin: the address (against the canonical form, not against whatever
 * the component prints), where each platform is sent, and what the clipboard
 * receives. The QR code encodes the same string, so a link that is right here is
 * right there.
 */

const NICKNAME = 'tnnrhpwd';
const LINK = 'https://sthopwood.com/u/tnnrhpwd';

let writeText;
let openSpy;

beforeEach(() => {
  writeText = jest.fn().mockResolvedValue(undefined);
  // jsdom ships no clipboard at all, so the property has to be defined rather
  // than assigned.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderSheet = (props = {}) =>
  render(<ShareProfile name={NICKNAME} open onClose={() => {}} {...props} />);

describe('ShareProfile — the address', () => {
  it('is the canonical one: the site origin plus the route profilePath builds', () => {
    expect(profileShareLink(NICKNAME)).toBe(LINK);
    // The nickname is user data, so it is encoded exactly as the route expects.
    expect(profileShareLink('Guest User')).toBe(
      'https://sthopwood.com/u/Guest%20User'
    );
  });

  it('renders nothing at all while it is closed', () => {
    const { container } = renderSheet({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the address in a read-only field, so it can be selected by hand', () => {
    renderSheet();
    const field = screen.getByLabelText('Page address');
    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute('readonly');
  });
});

describe('ShareProfile — the platforms', () => {
  it('sends X the address and a name, in a new tab', () => {
    renderSheet();
    const anchor = screen.getByRole('link', { name: 'X' });
    expect(anchor).toHaveAttribute(
      'href',
      xShareUrl(LINK, `${NICKNAME} on STHopwood`)
    );
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('sends Facebook the address alone — the card comes from the page itself', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
      'href',
      facebookShareUrl(LINK)
    );
  });

  it('gives Instagram the link on the clipboard and says so, because it has no share link', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

    // The copy is awaited BEFORE the tab opens (the order is the point: the link
    // has to be on the clipboard by the time Instagram is in front of you), so the
    // call lands a microtask after the click.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        INSTAGRAM_URL,
        '_blank',
        'noopener,noreferrer'
      )
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      /paste it into Instagram/i
    );
  });
});

describe('ShareProfile — copying', () => {
  it('copies the address and reports it', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');
  });

  it('selects the field instead when the clipboard is refused', async () => {
    writeText.mockRejectedValueOnce(new Error('NotAllowedError'));
    renderSheet();
    const field = screen.getByLabelText('Page address');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/blocked the copy/i)
    );
    // The fallback is the selection, so the address is still one keystroke away.
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
  });

  it('starts each visit with no claim from the last one', async () => {
    const { rerender } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Link copied.');

    rerender(<ShareProfile name={NICKNAME} open={false} onClose={() => {}} />);
    rerender(<ShareProfile name={NICKNAME} open onClose={() => {}} />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('ShareProfile — the code and the keyboard', () => {
  it('renders a code for the page it names', () => {
    const { container } = renderSheet();
    const code = container.querySelector('svg.sp-qr-code');
    expect(code).toBeInTheDocument();
    expect(code.querySelector('title')).toHaveTextContent(
      `QR code for ${NICKNAME}'s page`
    );
    // The encoded payload is the address field's own value (`value={link}`), which
    // the assertions above pin to the canonical URL — the modules themselves are
    // geometry, not text, so there is nothing else to read back here.
    expect(screen.getByLabelText('Page address')).toHaveValue(
      profileShareLink(NICKNAME)
    );
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    renderSheet({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
