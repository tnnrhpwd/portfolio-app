import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing, getUserStorage } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import {
  PLAN_IDS,
  PLAN_NAMES,
  MONTHLY_PRICES,
  ANNUAL_PRICES,
  AI_CREDIT_ALLOWANCE,
  STORAGE_DISPLAY,
  FEATURES,
  DESCRIPTIONS,
  COMPARISON,
  formatUsd,
  formatUsdCompact,
} from '../../constants/pricing';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import useScrollReveal from '../../hooks/useScrollReveal';
import usePurchaseGate from '../../hooks/usePurchaseGate';
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection.js';
import perceiveImg from '../../assets/art/simple-perceive.png';
import actImg from '../../assets/art/simple-act.png';
import repeatImg from '../../assets/art/simple-repeat.png';
import './Pricing.css';

/** Yearly-vs-monthly saving, derived so the badge can't drift from the prices. */
const ANNUAL_SAVINGS_PERCENT = Math.round(
  (1 - ANNUAL_PRICES[PLAN_IDS.PRO] / (MONTHLY_PRICES[PLAN_IDS.PRO] * 12)) * 100
);

const FREE_CREDITS = formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.FREE]);
const PRO_CREDITS = formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.PRO]);

const FAQ_ITEMS = [
  {
    q: 'What does Free include?',
    a: `AI chat with a ${FREE_CREDITS}/month cloud-credit allowance, the full Simple desktop addon with unlimited local automation, and ${STORAGE_DISPLAY[PLAN_IDS.FREE]} of cloud storage.`,
  },
  {
    q: 'What do I get with Pro?',
    a: `Everything in Free, plus a ${PRO_CREDITS}/month AI credit allowance, ${STORAGE_DISPLAY[PLAN_IDS.PRO]} of storage, live screen viewing from your phone, and email support.`,
  },
  {
    q: 'How does AI usage work?',
    a: `AI chat runs on our servers, so it is metered against a monthly cloud-credit allowance included with your plan — ${FREE_CREDITS}/month on Free, ${PRO_CREDITS}/month on Pro. When the allowance runs out, AI requests pause until the next monthly cycle. There is no bring-your-own-key option.`,
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancelling schedules your subscription to end at the end of your current billing period — you keep Pro features until then and are not charged again.',
  },
  {
    q: 'Are there hidden fees?',
    a: 'No. The price shown is what you pay. Payments are processed securely by Stripe.',
  },
];

const SIMPLE_FEATURES = [
  {
    img: perceiveImg,
    title: 'Observe',
    body: "Simple sees the window you're in, what you click, and what you type, so it understands the context of a task instead of guessing.",
  },
  {
    img: actImg,
    title: 'Execute',
    body: 'It drives the keyboard and mouse to do the work: open apps, click, type, and run the steps you showed it.',
  },
  {
    img: repeatImg,
    title: 'The loop',
    body: 'Record a task once and it becomes a reusable skill. Later, ask for it in plain English — “do the invoices” — and it repeats.',
  },
];

const SIMPLE_STEPS = [
  {
    n: '01',
    title: 'Download & run',
    body: 'Get the Simple addon, a portable app for Windows. No installer required — run it and it lives in your tray.',
  },
  {
    n: '02',
    title: 'Show it once',
    body: 'Record a short task — rename and file an invoice, save a note, or organize a folder.',
  },
  {
    n: '03',
    title: 'Say it in English',
    body: 'Ask for the task in plain language in the chat, and Simple repeats the steps for you.',
  },
];

// The engine, as a text rail. Deliberately NOT a row of icon cards — see
// FRONTEND_UI_STANDARD §5 ("Imagery over emoji"): a stage tile gets a real media
// block or nothing, never an emoji glyph standing in for one.
const LOOP = [
  { n: '01', title: 'Observe', body: "Reads your screen, active window, and files to see what's happening right now." },
  { n: '02', title: 'Orient', body: 'Builds a quick situation summary — what it just did, what changed, and what matters.' },
  { n: '03', title: 'Goal', body: "Re-checks the goal on a slower cadence and flags itself blocked when it's stuck." },
  { n: '04', title: 'Plan', body: "Picks the next concrete step — a tool call, or a deliberate wait when nothing's worth doing." },
  { n: '05', title: 'Execute', body: 'Drives the keyboard and mouse to do the work, then learns from the outcome.' },
];

/**
 * One full-bleed band. Flat colour blocks — not bordered cards — are what give
 * the page its rhythm, the same device Home uses. Only the hero and the closing
 * CTA carry the animated gradient, so it reads as a bookend rather than as
 * page-wide wallpaper (which is what made this page feel muddy).
 */
function Band({ variant = 'surface', className = '', children }) {
  const [ref, visible] = useScrollReveal();
  return (
    <section
      ref={ref}
      className={`pricing-band pricing-band--${variant} pricing-reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
    >
      <div className="pricing-wrap">{children}</div>
    </section>
  );
}

function SectionHead({ eyebrow, title, lead }) {
  return (
    <header className="pricing-head">
      {eyebrow && <p className="pricing-eyebrow">{eyebrow}</p>}
      <h2 className="pricing-h2">{title}</h2>
      {lead && <p className="pricing-lead">{lead}</p>}
    </header>
  );
}

function Pricing() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user, membershipPricing, dataIsLoading, userStorage } = useSelector((state) => state.data);
  const { purchasesEnabled, message: gateMessage } = usePurchaseGate();
  const [billingInterval, setBillingInterval] = useState('month');

  useEffect(() => {
    dispatch(getMembershipPricing());
  }, [dispatch]);

  // Show the visitor their own real usage, if logged in — plain information,
  // not a nudge, so a storage upgrade decision is based on actual numbers.
  useEffect(() => {
    if (user?.token) {
      dispatch(getUserStorage());
    }
  }, [dispatch, user?.token]);

  // Build plans from dynamic pricing or fall back to static defaults. Honors
  // the monthly/annual cadence when the backend exposes both prices.
  const getPlans = () => {
    if (membershipPricing?.success && membershipPricing?.data?.length > 0) {
      return membershipPricing.data.map((product) => {
        const intervals = Array.isArray(product.intervals) ? product.intervals : [];
        const selected = intervals.find((i) => i.interval === billingInterval) || intervals[0];
        return {
          id: product.id,
          name: product.name,
          price: intervals.length ? formatPrice(selected ? selected.price : product.price) : formatPrice(product.price),
          period: intervals.length && selected ? selected.interval : product.interval || 'month',
          tagline: product.description || '',
          features: product.features || [],
          showAnnual: intervals.some((i) => i.interval === 'year'),
        };
      });
    }

    // Static fallback while API loads — values come from the pricing
    // constants so the fallback matches the live response.
    return [
      {
        id: PLAN_IDS.FREE,
        name: PLAN_NAMES[PLAN_IDS.FREE],
        price: formatUsdCompact(MONTHLY_PRICES[PLAN_IDS.FREE]),
        period: 'month',
        tagline: DESCRIPTIONS[PLAN_IDS.FREE],
        features: FEATURES[PLAN_IDS.FREE],
        showAnnual: false,
      },
      {
        id: PLAN_IDS.PRO,
        name: PLAN_NAMES[PLAN_IDS.PRO],
        price: formatUsdCompact(billingInterval === 'year' ? ANNUAL_PRICES[PLAN_IDS.PRO] : MONTHLY_PRICES[PLAN_IDS.PRO]),
        period: billingInterval === 'year' ? 'year' : 'month',
        tagline: DESCRIPTIONS[PLAN_IDS.PRO],
        features: FEATURES[PLAN_IDS.PRO],
        showAnnual: true,
      },
    ];
  };

  const plans = getPlans();
  const hasAnnual = plans.some((p) => p.showAnnual);

  const handleSelectPlan = (planId) => {
    if (planId !== 'free' && !purchasesEnabled) return; // gated — button is disabled, but guard anyway
    if (!user) {
      // Redirect to login, then they'll be sent to /pay after login
      navigate('/login', { state: { redirectTo: `/pay?plan=${planId}` } });
    } else {
      navigate(`/pay?plan=${planId}`);
    }
  };

  return (
    <>
      <SEO
        title="Pricing"
        description="Simple, transparent pricing for the Simple AI agent — upgrade or downgrade anytime."
        path="/pricing"
      />
      <Header />
      <div className="pricing">
        {/* ── Hero: the signature animated gradient (bookended by the CTA band) ── */}
        <section className="pricing-band pricing-hero">
          <div className="pricing-floating" aria-hidden="true">
            <div className="pricing-circle pricing-circle-1"></div>
            <div className="pricing-circle pricing-circle-2"></div>
            <div className="pricing-circle pricing-circle-3"></div>
          </div>

          <div className="pricing-wrap pricing-hero-inner">
            <p className="pricing-eyebrow">Pricing</p>
            <h1 className="pricing-title">Simple, transparent pricing</h1>
            <p className="pricing-subtitle">
              Simple is an AI agent that runs on your PC — show it a task once, and it does it again
              forever. Start free, and upgrade only when you want more.
            </p>
            <ul className="pricing-trust" aria-label="Pricing assurances">
              <li>🔒 Secured by Stripe</li>
              <li>🛡️ No hidden fees</li>
              <li>↩️ Cancel anytime</li>
            </ul>
          </div>
        </section>

        <main id="main" className="pricing-main">
          {/* ── Plans: the page's one job, so it sits directly under the hero ── */}
          <Band variant="surface" className="pricing-band--plans">
            {!purchasesEnabled && (
              <div className="pricing-gate-notice" role="status">
                {gateMessage || 'Upgrading is temporarily paused. Please check back soon.'}
              </div>
            )}

            {user?.token && userStorage && typeof userStorage === 'object' && userStorage.totalStorageFormatted && (
              <div className="pricing-usage-notice" role="status">
                Your current storage use: <strong>{userStorage.totalStorageFormatted}</strong> of{' '}
                <strong>{userStorage.storageLimitFormatted}</strong> on your plan.
              </div>
            )}

            {hasAnnual && (
              <div className="pricing-toggle" role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={billingInterval === 'month' ? 'active' : ''}
                  onClick={() => setBillingInterval('month')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={billingInterval === 'year' ? 'active' : ''}
                  onClick={() => setBillingInterval('year')}
                >
                  Yearly <span className="pricing-toggle-save">save {ANNUAL_SAVINGS_PERCENT}%</span>
                </button>
              </div>
            )}

            {dataIsLoading && !membershipPricing ? (
              <div className="pricing-loading">
                <div className="pricing-spinner" aria-hidden="true"></div>
                <p>Loading plans…</p>
              </div>
            ) : (
              <div className="pricing-plans">
                {plans.map((plan) => {
                  const gated = plan.id !== 'free' && !purchasesEnabled;
                  return (
                    <article
                      key={plan.id}
                      className={`pricing-plan-card ${plan.id === 'pro' ? 'featured' : ''}`}
                    >
                      {plan.id === 'pro' && (
                        <span className="pricing-plan-badge">Most popular</span>
                      )}
                      <h2 className="pricing-plan-name">{plan.name}</h2>
                      <div className="pricing-plan-price">
                        <span className="pricing-plan-amount">{plan.price}</span>
                        <span className="pricing-plan-period">/{plan.period}</span>
                      </div>
                      <p className="pricing-plan-tagline">{plan.tagline}</p>
                      <ul className="pricing-plan-features">
                        {plan.features.map((feature, i) => (
                          <li key={i}>{feature}</li>
                        ))}
                      </ul>
                      <button
                        className={`pricing-plan-cta ${plan.id === 'pro' ? 'primary' : 'secondary'}`}
                        onClick={() => handleSelectPlan(plan.id)}
                        disabled={gated}
                        title={gated ? (gateMessage || 'Upgrading is temporarily paused') : undefined}
                      >
                        {gated
                          ? 'Not available yet'
                          : plan.id === 'free'
                            ? (user ? 'Current Plan' : 'Get Started Free')
                            : `Choose ${plan.name}`}
                      </button>
                      {plan.id === 'pro' && (
                        <p className="pricing-plan-note">
                          Billed {billingInterval === 'year' ? 'annually' : 'monthly'}. Cancel anytime.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </Band>

          {/* ── Comparison ── */}
          <Band variant="tint">
            <SectionHead
              eyebrow="Compare"
              title="What's included"
              lead="Both plans include the full desktop addon. The difference is cloud AI credits, storage, and support."
            />
            <div className="pricing-compare-table">
              <div className="pricing-compare-row pricing-compare-head">
                <span>Feature</span>
                <span>Free</span>
                <span>Pro</span>
              </div>
              {COMPARISON.map((row) => (
                <div className="pricing-compare-row" key={row.feature}>
                  <span className="pricing-compare-feature">{row.feature}</span>
                  <span>{row.free}</span>
                  <span className="pricing-compare-pro">{row.pro}</span>
                </div>
              ))}
            </div>
            <p className="pricing-note">
              AI chat runs on our servers and is metered against a monthly cloud-credit allowance —
              when it runs out, AI requests pause until the next monthly cycle. Local automation runs
              on your PC and is unlimited on every plan.
            </p>
          </Band>

          {/* ── What Simple does ── */}
          <Band variant="surface">
            <SectionHead
              eyebrow="The agent"
              title="What Simple does"
              lead="Simple is an AI agent that runs on your PC. Show it a task once — like renaming and filing invoices — and afterward saying “do the invoices” repeats it, and learns from every run."
            />
            <div className="pricing-whats">
              {SIMPLE_FEATURES.map((f) => (
                <article className="pricing-whats-tile" key={f.title}>
                  <img className="pricing-whats-media" src={f.img} alt="" loading="lazy" />
                  <h3 className="pricing-whats-title">{f.title}</h3>
                  <p className="pricing-whats-body">{f.body}</p>
                </article>
              ))}
            </div>
          </Band>

          {/* ── The engine ── */}
          <Band variant="tint">
            <SectionHead
              eyebrow="Under the hood"
              title="One loop, five stages"
              lead="Every tick, Simple runs the same closed loop. Goal re-evaluates on a slower cadence; after each Execute, a critic scores the result and writes a lesson the next Plan learns from."
            />
            <ol className="pricing-loop" aria-label="The agent loop">
              {LOOP.map((stage) => (
                <li className="pricing-loop-stage" key={stage.n}>
                  <span className="pricing-loop-n">{stage.n}</span>
                  <h3 className="pricing-loop-title">{stage.title}</h3>
                  <p className="pricing-loop-body">{stage.body}</p>
                </li>
              ))}
            </ol>
          </Band>

          {/* ── How it works ── */}
          <Band variant="surface">
            <SectionHead eyebrow="Getting started" title="How it works" />
            <ol className="pricing-steps">
              {SIMPLE_STEPS.map((s) => (
                <li className="pricing-step" key={s.n}>
                  <span className="pricing-step-n" aria-hidden="true">{s.n}</span>
                  <h3 className="pricing-step-title">{s.title}</h3>
                  <p className="pricing-step-body">{s.body}</p>
                </li>
              ))}
            </ol>
          </Band>

          {/* ── FAQ ── */}
          <Band variant="tint">
            <SectionHead eyebrow="Questions" title="Common questions" />
            <div className="pricing-faq-list">
              {FAQ_ITEMS.map((item) => (
                <details className="pricing-faq-item" key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
            <p className="pricing-note">
              Still unsure? Ask on <Link to="/net">the chat</Link> or visit{' '}
              <Link to="/support">support</Link>.
            </p>
          </Band>
        </main>

        {/* ── Closing CTA: the vibrant band that bookends the hero ── */}
        <section className="pricing-band pricing-cta">
          <div className="pricing-wrap pricing-cta-inner">
            <p className="pricing-eyebrow pricing-eyebrow--inv">Get started</p>
            <h2 className="pricing-cta-title">Ready to try it?</h2>
            <p className="pricing-cta-sub">
              Download the addon, show it one task, and ask for it back in plain English. It&apos;s
              free to start — upgrade when you need more.
            </p>
            <div className="pricing-cta-actions">
              <button
                type="button"
                className="pricing-btn pricing-btn--inv"
                onClick={() => handleSelectPlan('free')}
              >
                Get started free <span aria-hidden="true">→</span>
              </button>
              <a
                className="pricing-btn pricing-btn--ghost"
                href={ADDON_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download the addon
              </a>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Pricing;
