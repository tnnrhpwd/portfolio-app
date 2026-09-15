import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { SITE_NAME, SITE_URL } from '../../constants/site.js';
import { profilePath } from '../../utils/userProfileUtils.js';
import './ShareProfile.css';

/**
 * ShareProfile — the share sheet for a member page (`/u/<name>`).
 *
 * One sheet rather than four controls in the page's action row, because the link
 * is the thing being shared and every other control on the sheet is a way of
 * MOVING that one string: the two platforms take it in a query parameter, the QR
 * code is the same string handed to a camera, and Instagram takes it nowhere at
 * all (it publishes no share endpoint — see `handleInstagram`). So the address is
 * stated once, as a field you can select, and the rest of the sheet is routing.
 *
 * ⚠️ The address is `SITE_URL` + `profilePath(...)` — the SAME URL the page's own
 * canonical tag carries (`components/SEO/SEO.jsx`) — and deliberately NOT
 * `window.location`. In dev those differ, and the one a share sheet must hand out
 * is the public one: a QR code encoding `127.0.0.1` is a code that opens nothing
 * on the phone that scanned it.
 *
 * The sheet is a modal (`ProfilePictureEditor` is the sibling reference): overlay
 * click and Escape close it, it is a real `role="dialog"`, and the page owns the
 * open/closed state so a route change unmounts it.
 */

/** The absolute address of a member page. Exported so a test can pin it to the
 *  canonical form rather than to whatever the component happens to print. */
export const profileShareLink = nickname =>
  `${SITE_URL}${profilePath(nickname)}`;

/** X (formerly Twitter). `x.com/intent/post` is the current endpoint — the old
 *  `twitter.com/intent/tweet` still redirects, but it is the deprecated name. */
export const xShareUrl = (link, text) =>
  `https://x.com/intent/post?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

/** Facebook's sharer takes the URL alone; the card itself is built from the
 *  page's own Open Graph tags, so there is nothing else to send it. */
export const facebookShareUrl = link =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;

/** Where Instagram's button goes. Not a share URL — there isn't one. */
export const INSTAGRAM_URL = 'https://www.instagram.com/';

function ShareProfile({ name, open, onClose }) {
  const [note, setNote] = useState('');
  const inputRef = useRef(null);
  const link = profileShareLink(name);

  // Escape closes the sheet, the same contract as the photo editor's modal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // A sheet that was just opened has done nothing yet. Without this, the last
  // visit's "Link copied." would still be on screen claiming this one had.
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      // Clipboard access is per-origin and can be refused (an insecure context, a
      // denied permission). Selecting the text keeps the promise the sheet makes —
      // the address is in your hands — at the cost of one keystroke instead of none.
      inputRef.current?.select();
      return false;
    }
  }, [link]);

  const handleCopy = useCallback(async () => {
    const copied = await copyLink();
    setNote(
      copied
        ? 'Link copied.'
        : 'This browser blocked the copy — the link is selected.'
    );
  }, [copyLink]);

  /**
   * Instagram publishes NO link-sharing endpoint — there is no `instagram.com/share?url=`
   * to send someone to, and pretending otherwise would open a page that silently
   * dropped the link. So this button does the only thing Instagram supports:
   * copies the address (so it is on the clipboard before the tab changes) and
   * opens Instagram, where it can be pasted into a story, a bio or a DM. The note
   * says so, because the tab changing is otherwise indistinguishable from a share
   * that worked.
   */
  const handleInstagram = useCallback(async () => {
    const copied = await copyLink();
    window.open(INSTAGRAM_URL, '_blank', 'noopener,noreferrer');
    setNote(
      copied
        ? 'Link copied — paste it into Instagram.'
        : 'Instagram has no share link. Select the address above and copy it.'
    );
  }, [copyLink]);

  if (!open) return null;

  return (
    <div className='sp-overlay' role='presentation' onMouseDown={onClose}>
      <div
        className='sp-sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='sp-title'
        onMouseDown={event => event.stopPropagation()}
      >
        <header className='sp-head'>
          <div>
            <p className='sp-eyebrow'>Share</p>
            {/* The nickname, not a sentence: this is a service surface (§5.7). */}
            <h2 className='sp-title' id='sp-title'>
              {name}
            </h2>
          </div>
          <button
            type='button'
            className='sp-close'
            onClick={onClose}
            aria-label='Close share sheet'
          >
            ✕
          </button>
        </header>

        <div>
          <label className='sp-label' htmlFor='sp-link'>
            Page address
          </label>
          <div className='sp-link-field'>
            <input
              id='sp-link'
              ref={inputRef}
              className='sp-input'
              type='text'
              value={link}
              readOnly
              onFocus={event => event.target.select()}
            />
            <button
              type='button'
              className='sp-btn sp-btn--primary'
              onClick={handleCopy}
            >
              Copy
            </button>
          </div>
        </div>

        <ul className='sp-targets'>
          <li>
            {/* A real anchor, not a `window.open`: the intent URLs are ordinary
                pages, so the browser's own new-tab behaviour (middle click, open
                in background, no popup blocker) applies. Both are external, so
                `rel` names both protections (§8). */}
            <a
              className='sp-btn'
              href={xShareUrl(link, `${name} on ${SITE_NAME}`)}
              target='_blank'
              rel='noopener noreferrer'
            >
              X
            </a>
          </li>
          <li>
            <button
              type='button'
              className='sp-btn'
              onClick={handleInstagram}
              title='Instagram has no share link — this copies the address and opens Instagram'
            >
              Instagram
            </button>
          </li>
          <li>
            <a
              className='sp-btn'
              href={facebookShareUrl(link)}
              target='_blank'
              rel='noopener noreferrer'
            >
              Facebook
            </a>
          </li>
        </ul>

        <div className='sp-qr'>
          <QRCodeSVG
            className='sp-qr-code'
            value={link}
            size={156}
            level='M'
            marginSize={2}
            bgColor='#ffffff'
            fgColor='#101b22'
            title={`QR code for ${name}'s page`}
          />
          <p className='sp-qr-hint'>
            Scan with a phone camera to open the page.
          </p>
        </div>

        {/* The sheet's one line of feedback. `role="status"` rather than a toast:
            it lands next to the control that produced it, and it is the only
            explanation the Instagram button can give. */}
        <p className='sp-note' role='status'>
          {note}
        </p>
      </div>
    </div>
  );
}

export default ShareProfile;
