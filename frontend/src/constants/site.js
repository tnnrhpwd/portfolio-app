/**
 * The site's own identity — name and canonical origin.
 *
 * ⚠️ These live here rather than in `components/SEO/SEO.jsx` (which re-exports
 * them, so `import { SITE_URL } from '.../SEO.jsx'` keeps working) because a
 * component that wants the ORIGIN — a share sheet, an OG card — has no use for
 * `<Helmet>`, and that module reads `import.meta.env.DEV` at module scope, which
 * is a syntax error under the Jest (CommonJS) runner. A constant should never
 * drag a renderer, or an `import.meta`, along with it.
 *
 * One origin, one place: the canonical tag, the Open Graph URL and the address a
 * share sheet hands out are the same string, and that is the point of it being
 * here.
 */
export const SITE_NAME = 'STHopwood';
export const SITE_URL = 'https://sthopwood.com';
export const DEFAULT_IMAGE = `${SITE_URL}/STHlogo192.png`;
