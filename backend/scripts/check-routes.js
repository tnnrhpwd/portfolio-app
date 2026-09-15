/**
 * Throwaway check: load the real Express router and assert the routes a feature
 * needs are actually registered (and in a safe order relative to `/:id`).
 *
 *   node backend/scripts/check-routes.js /u/:username /messenger/avatars
 *
 * Lives here rather than being typed into a shell because `node -e` with quotes
 * kept getting mangled by PowerShell.
 */
const path = require('path');

const wanted = process.argv.slice(2);
const router = require(path.join(__dirname, '..', 'routes', 'routeData.js'));

const all = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).map((m) => m.toUpperCase()).join(',')} ${layer.route.path}`);

const genericIndex = all.findIndex((line) => line.endsWith(' /:id'));

let failed = false;
for (const route of wanted) {
    const hits = all.filter((line) => line.endsWith(` ${route}`));
    const index = all.findIndex((line) => line.endsWith(` ${route}`));
    const afterGeneric = index > genericIndex && genericIndex !== -1 && !route.includes('/', 1);
    if (hits.length === 0) failed = true;
    console.log(`${hits.length ? 'OK  ' : 'MISS'} ${route}  ->  ${hits.join(' | ') || '(not registered)'}`);
}

console.log(`\n${all.length} routes registered; generic /:id at position ${genericIndex}.`);
process.exit(failed ? 1 : 0);
