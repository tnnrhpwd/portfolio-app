/**
 * Generates a static sitemap.xml listing every publicly-indexable route.
 *
 * Why this exists: the app is a client-side-rendered SPA (Vite + React
 * Router) that only produces a single `index.html` in the build output.
 * @netlify/plugin-sitemap discovers URLs by scanning HTML files in the
 * publish directory, so on a pure SPA build it can only ever find "/" —
 * every other route (About, Projects, tools, etc.) is invisible
 * to it. This script writes a complete sitemap.xml directly instead,
 * covering all real indexable routes.
 *
 * Auth-gated / account pages (login, register, settings, profile, etc.)
 * and legal redirects are intentionally excluded, matching the
 * `noindex` pages tagged via the SEO component.
 */
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://sthopwood.com';
const BUILD_DIR = path.resolve(__dirname, '..', 'build');

// Keep in sync with the public <Route> entries in src/App.js and the
// per-page <SEO path="..."> values.
const ROUTES = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/about', priority: 0.9, changefreq: 'monthly' },
  { path: '/support', priority: 0.6, changefreq: 'monthly' },
  { path: '/privacy', priority: 0.3, changefreq: 'yearly' },
  { path: '/terms', priority: 0.3, changefreq: 'yearly' },
  { path: '/annuities', priority: 0.6, changefreq: 'monthly' },
  { path: '/fluid', priority: 0.6, changefreq: 'monthly' },
  { path: '/projects', priority: 0.8, changefreq: 'monthly' },
  { path: '/halfway', priority: 0.5, changefreq: 'monthly' },
  { path: '/iq', priority: 0.6, changefreq: 'monthly' },
  { path: '/passgen', priority: 0.5, changefreq: 'monthly' },
  { path: '/sleepassist', priority: 0.5, changefreq: 'monthly' },
  { path: '/sonic', priority: 0.5, changefreq: 'monthly' },
  { path: '/wordle', priority: 0.6, changefreq: 'monthly' },
  { path: '/type', priority: 0.6, changefreq: 'monthly' },
  { path: '/wordlesolver', priority: 0.6, changefreq: 'monthly' },
  { path: '/2048', priority: 0.6, changefreq: 'monthly' },
  { path: '/colosseum', priority: 0.6, changefreq: 'monthly' },
  { path: '/uimapper', priority: 0.3, changefreq: 'yearly' },
  { path: '/polls', priority: 0.6, changefreq: 'weekly' },
];

function buildSitemap() {
  const lastmod = new Date().toISOString();
  const urls = ROUTES.map(({ path: routePath, priority, changefreq }) => `  <url>
    <loc>${SITE_URL}${routePath}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    console.error(`[generate-sitemap] Build directory not found: ${BUILD_DIR}`);
    process.exit(1);
  }
  const outPath = path.join(BUILD_DIR, 'sitemap.xml');
  fs.writeFileSync(outPath, buildSitemap(), 'utf8');
  console.log(`[generate-sitemap] Wrote ${ROUTES.length} routes to ${outPath}`);
}

main();
