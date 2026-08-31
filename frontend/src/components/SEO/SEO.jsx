import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'STHopwood';
const SITE_URL = 'https://sthopwood.com';
const DEFAULT_IMAGE = `${SITE_URL}/STHlogo192.png`;

/**
 * Sets per-page <title>, meta description, canonical URL, and Open Graph /
 * Twitter tags. Renders on top of the static defaults in index.html so
 * every route gets unique, crawlable metadata instead of one generic set.
 *
 * @param {string} title - Page title (site name is appended automatically).
 * @param {string} description - Page meta description (~150-160 chars ideal).
 * @param {string} [path] - Route path (e.g. "/about") used to build the canonical/OG URL.
 * @param {string} [image] - Absolute URL to a social preview image.
 * @param {boolean} [noindex] - Set true to keep the page out of search results.
 * @param {object|object[]} [jsonLd] - Optional JSON-LD structured data object(s)
 *   (e.g. schema.org Person/WebSite) rendered as <script type="application/ld+json">.
 */
function SEO({ title, description, path = '', image = DEFAULT_IMAGE, noindex = false, jsonLd }) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  // Browser tab title: clean brand name in production, "Dev" on the local dev server.
  const tabTitle = import.meta.env.DEV ? 'Dev' : SITE_NAME;
  const url = `${SITE_URL}${path}`;
  const jsonLdItems = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{tabTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* JSON-LD structured data (schema.org) */}
      {jsonLdItems.map((item, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(item)}
        </script>
      ))}
    </Helmet>
  );
}

export default SEO;
export { SITE_NAME, SITE_URL, DEFAULT_IMAGE };
