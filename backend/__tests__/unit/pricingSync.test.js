/**
 * pricingSync.test.js — drift guard between the canonical backend pricing
 * constants and the frontend mirror.
 *
 * Why this exists: Render deploys `backend/` with rootDir=backend and Netlify
 * builds `frontend/` separately, so a single cross-package source file isn't
 * viable without changing the deploy topology. Instead, this test pins the
 * shared, user-facing subset of both files and fails CI if they ever diverge.
 *
 * The frontend file is ESM (Vite), which Node/Jest won't parse as-is, so we
 * transpile it to CommonJS with @babel/core (already a devDependency) and
 * evaluate the result in a sandbox.
 *
 * If you add/change a shared constant, update SHARED_KEYS here.
 */

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const backendPricing = require('../../constants/pricing.js');

/** Load the ESM frontend pricing module by transpiling it to CommonJS. */
function loadFrontendPricing() {
  const file = path.resolve(__dirname, '../../../frontend/src/constants/pricing.js');
  const source = fs.readFileSync(file, 'utf8');
  const { code } = babel.transformSync(source, {
    filename: file,
    presets: [['@babel/preset-env', { modules: 'commonjs', targets: { node: 'current' } }]],
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', 'require', code)(mod.exports, mod, require);
  return mod.exports;
}

const frontendPricing = loadFrontendPricing();

const SHARED_KEYS = [
  'PLAN_IDS',
  'PLAN_NAMES',
  'STORAGE_DISPLAY',
  'QUOTAS',
  'FEATURES',
  'DESCRIPTIONS',
];

describe('pricing constants — frontend mirror matches backend', () => {
  test.each(SHARED_KEYS)('%s is identical in both packages', (key) => {
    expect(frontendPricing[key]).toBeDefined();
    expect(frontendPricing[key]).toEqual(backendPricing[key]);
  });
});
