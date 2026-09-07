/**
 * fix-stripe-products.js — align the live Stripe catalog with the app's pricing.
 *
 * Expected catalog (per backend/constants/pricing.js + docs/guides/ACTION_PLAN.md):
 *   - "Pro Membership"      → active $15.00/month price (+ $144.00/year annual)
 *   - "Simple Membership"   → legacy product, should be archived
 *
 * The live checkout (services/stripeService.js getOrCreatePriceId) looks up
 * PLAN_TO_STRIPE_PRODUCT['pro'] and uses the first active price matching the
 * requested interval. If that product's monthly price is $12 (not $15), every
 * checkout charges $12 while the site copy says $15 — this script fixes that.
 *
 * DRY RUN by default. Pass --apply to actually write to Stripe.
 *
 *   node backend/scripts/fix-stripe-products.js            # dry run (safe)
 *   node backend/scripts/fix-stripe-products.js --apply    # apply changes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PLAN_TO_STRIPE_PRODUCT, PLAN_IDS } = require('../constants/pricing');
const { loadAllSecrets } = require('../utils/awsSecrets');

const PRO_MONTHLY_CENTS = 1500; // $15.00/mo
const PRO_ANNUAL_CENTS = 14400; // $144.00/yr
const LEGACY_PRODUCT_NAME = 'Simple Membership';
const PRO_PRODUCT_NAME = 'Pro Membership';

const apply = process.argv.includes('--apply');

function summarizePrice(p) {
  const amt = p.unit_amount == null ? 'n/a' : `$${(p.unit_amount / 100).toFixed(2)}`;
  const interval = p.recurring?.interval || 'one-time';
  return `${amt}/${interval} (${p.active ? 'active' : 'archived'}, ${p.id})`;
}

async function main() {
  // Hydrate STRIPE_KEY (and any other config) from AWS Secrets Manager if not
  // already in the environment — the same bootstrap path server.js uses at boot.
  await loadAllSecrets();

  const STRIPE_KEY = process.env.STRIPE_KEY;
  if (!STRIPE_KEY) {
    console.error('❌ STRIPE_KEY is not set (check backend/.env or Secrets Manager).');
    process.exit(1);
  }
  const stripe = require('stripe')(STRIPE_KEY);

  console.log(apply ? '▶ APPLY MODE — writing to Stripe' : '🔍 DRY RUN — no changes will be written\n');

  // ── Resolve the Pro product ──
  let proProduct = null;
  try {
    proProduct = await stripe.products.retrieve(PLAN_TO_STRIPE_PRODUCT[PLAN_IDS.PRO]);
  } catch (_) { /* fall through to name search */ }

  if (!proProduct || proProduct.name !== PRO_PRODUCT_NAME) {
    console.log(`ℹ️  PLAN_TO_STRIPE_PRODUCT['pro'] (${PLAN_TO_STRIPE_PRODUCT[PLAN_IDS.PRO]}) did not resolve to "${PRO_PRODUCT_NAME}" — searching by name.`);
    const products = await stripe.products.list({ active: true, limit: 100 });
    proProduct = products.data.find((p) => p.name === PRO_PRODUCT_NAME);
  }

  if (!proProduct) {
    console.error(`❌ Could not find an active product named "${PRO_PRODUCT_NAME}".`);
    process.exit(1);
  }
  console.log(`✔ Pro product: "${proProduct.name}" (${proProduct.id})`);

  // ── Ensure a $15/month price and a $144/year price ──
  const prices = await stripe.prices.list({ product: proProduct.id, active: true, limit: 100 });

  const monthlyPrices = prices.data.filter((p) => p.recurring?.interval === 'month');
  const annualPrices = prices.data.filter((p) => p.recurring?.interval === 'year');

  let goodMonthly = monthlyPrices.find((p) => p.unit_amount === PRO_MONTHLY_CENTS);
  const badMonthly = monthlyPrices.filter((p) => p.unit_amount !== PRO_MONTHLY_CENTS);

  console.log('\nMonthly prices on Pro product:');
  for (const p of monthlyPrices) {
    console.log(`  ${p.unit_amount === PRO_MONTHLY_CENTS ? '✔' : '✖'} ${summarizePrice(p)}`);
  }
  if (!goodMonthly) {
    console.log(`  → ${apply ? 'Creating' : 'Would create'} a $${(PRO_MONTHLY_CENTS / 100).toFixed(2)}/month price.`);
    if (apply) {
      goodMonthly = await stripe.prices.create({
        product: proProduct.id,
        unit_amount: PRO_MONTHLY_CENTS,
        currency: 'usd',
        recurring: { interval: 'month' },
      });
      console.log(`    Created ${summarizePrice(goodMonthly)}`);
    }
  }

  // Point the product's default price at the $15 price first — Stripe won't
  // archive a price while it's still the product default.
  if (apply && goodMonthly && proProduct.default_price !== goodMonthly.id) {
    await stripe.products.update(proProduct.id, { default_price: goodMonthly.id });
    console.log(`  → Set product default price to $${(PRO_MONTHLY_CENTS / 100).toFixed(2)}/month (${goodMonthly.id})`);
  }

  for (const p of badMonthly) {
    console.log(`  → ${apply ? 'Archiving' : 'Would archive'} mismatched ${summarizePrice(p)}`);
    if (apply) {
      try {
        await stripe.prices.update(p.id, { active: false });
      } catch (err) {
        console.error(`    ⚠️ Could not archive ${p.id}: ${err.message}`);
      }
    }
  }

  console.log('\nAnnual prices on Pro product:');
  if (annualPrices.length === 0) {
    console.log(`  → ${apply ? 'Creating' : 'Would create'} a $${(PRO_ANNUAL_CENTS / 100).toFixed(2)}/year price.`);
    if (apply) {
      const created = await stripe.prices.create({
        product: proProduct.id,
        unit_amount: PRO_ANNUAL_CENTS,
        currency: 'usd',
        recurring: { interval: 'year' },
      });
      console.log(`    Created ${summarizePrice(created)}`);
    }
  } else {
    for (const p of annualPrices) {
      const ok = p.unit_amount === PRO_ANNUAL_CENTS;
      console.log(`  ${ok ? '✔' : '⚠'} ${summarizePrice(p)}`);
    }
  }

  // ── Archive the legacy "Simple Membership" product ──
  const allProducts = await stripe.products.list({ active: true, limit: 100 });
  const legacy = allProducts.data.find((p) => p.name === LEGACY_PRODUCT_NAME);
  if (legacy) {
    console.log(`\nLegacy product found: "${legacy.name}" (${legacy.id})`);
    console.log(`  → ${apply ? 'Archiving' : 'Would archive'} "${LEGACY_PRODUCT_NAME}" (no longer used).`);
    if (apply) await stripe.products.update(legacy.id, { active: false });
  } else {
    console.log(`\n✔ No active "${LEGACY_PRODUCT_NAME}" product found — nothing to archive.`);
  }

  console.log(apply ? '\nDone — changes applied.' : '\nDone (dry run). Re-run with --apply to write these changes.');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
