/**
 * The pre-paint boot script in `index.html`.
 *
 * The colour mode class and the `data-scheme` attribute have to be on `<body>`
 * before the FIRST frame, which is why an inline script applies them instead of
 * React: both used to be applied in the shared header's mount effect, a frame
 * after the first paint (and later still on a lazy route like `/net`, whose chunk
 * is fetched while the default palette is already on screen). See
 * `FRONTEND_UI_STANDARD.md` §2.
 *
 * That script necessarily COPIES the storage shape of `utils/theme.js` and
 * `utils/scheme.js` — HTML cannot import them — and a renamed key or a changed
 * pair format would fail silently: the page would simply paint the default palette
 * again, which is the bug the script exists to fix. So these tests run the real
 * file's real script, and cross-check the app's own readers against it.
 */
import fs from 'fs';
import path from 'path';
import { initTheme } from './utils/theme.js';
import { initScheme } from './utils/scheme.js';

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/** The only bare `<script>` in the file — the two others carry a `type`. */
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const runBoot = () => new Function(source)();

const painted = () => ({
  mode: ['light-theme', 'dark-theme'].find((c) => document.body.classList.contains(c)),
  scheme: document.body.dataset.scheme,
  hues: [
    document.body.style.getPropertyValue('--scheme-hue-accent'),
    document.body.style.getPropertyValue('--scheme-hue-primary'),
  ],
});

/** jsdom has no `matchMedia`; the script only ever asks about the colour scheme. */
const withOsDark = (dark) => {
  window.matchMedia = jest.fn(() => ({ matches: dark }));
};

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  document.body.removeAttribute('data-scheme');
  document.body.removeAttribute('style');
  withOsDark(false);
});

describe('the pre-paint boot script', () => {
  it('paints the stored mode, so the first frame is the visitor’s and not the default’s', () => {
    localStorage.setItem('theme', 'dark-theme');

    runBoot();

    expect(painted().mode).toBe('dark-theme');
  });

  it('follows the OS when nothing is stored, and when the preference is `system`', () => {
    withOsDark(true);
    runBoot();
    expect(painted().mode).toBe('dark-theme');

    localStorage.setItem('theme', 'system'); // a preference, never a class
    runBoot();
    expect(painted().mode).toBe('dark-theme');
  });

  it('lets an explicit mode beat the OS', () => {
    withOsDark(true);
    localStorage.setItem('theme', 'light-theme');

    runBoot();

    expect(painted().mode).toBe('light-theme');
  });

  it('paints the stored scheme', () => {
    localStorage.setItem('scheme', 'crimson');

    runBoot();

    expect(painted().scheme).toBe('crimson');
  });

  it('carries the custom pair as inline hues — the one scheme a stylesheet cannot hold', () => {
    localStorage.setItem('scheme', 'custom');
    localStorage.setItem('schemeCustom', JSON.stringify({ primary: '#123456', secondary: '#abcdef' }));

    runBoot();

    expect(painted().scheme).toBe('custom');
    expect(painted().hues).toEqual(['#123456', '#abcdef']);
  });

  it('still names the scheme when the stored pair is unusable', () => {
    localStorage.setItem('scheme', 'custom');
    localStorage.setItem('schemeCustom', '{not json');

    runBoot();

    // `body[data-scheme='custom']` seeds its own pair in index.css, so the frame is
    // the default's two hues rather than no colours at all.
    expect(painted().scheme).toBe('custom');
    expect(painted().hues).toEqual(['', '']);
  });

  it('paints a mode even when storage is blocked', () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('storage disabled');
    };
    try {
      expect(() => runBoot()).not.toThrow();
      expect(painted().mode).toBe('light-theme');
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });

  it('agrees with initTheme() and initScheme() about what storage means', () => {
    localStorage.setItem('theme', 'dark-theme');
    localStorage.setItem('scheme', 'sakura');

    runBoot();
    const boot = painted();

    // The app's own readers, run against the same storage. They repaint as they
    // go, which is fine — the boot values were captured first.
    expect(initTheme().applied).toBe(boot.mode);
    expect(initScheme()).toBe(boot.scheme);
  });

  it('leaves the scheme unset when nothing is stored, so the fallbacks still apply', () => {
    runBoot();

    expect(painted().scheme).toBeUndefined();
    expect(initScheme()).toBe('ocean'); // the default lands on mount, not before it
  });
});
