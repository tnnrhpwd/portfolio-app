import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing, getUserStorage } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import usePurchaseGate from '../../hooks/usePurchaseGate';
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection.js';
import perceiveImg from '../../assets/art/simple-perceive.png';
import actImg from '../../assets/art/simple-act.png';
import repeatImg from '../../assets/art/simple-repeat.png';
import './Pricing.css';

const FAQ_ITEMS = [
  {
    q: 'What does Free include?',
    a: 'AI chat with a $0.50/month cloud-credit allowance, the full Simple desktop addon with unlimited local automation, and 100 MB of cloud storage.',
  },
  {
    q: 'What do I get with Pro?',
    a: 'Everything in Free, plus a $10.00/month AI credit allowance, 50 GB of storage, live screen viewing from your phone, and email support.',
  },
  {
    q: 'How does AI usage work?',
    a: 'AI chat runs on our servers, so it is metered against a monthly cloud-credit allowance included with your plan — $0.50/month on Free, $10.00/month on Pro. When the allowance runs out, AI requests pause until the next monthly cycle. There is no bring-your-own-key option.',
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

const COMPARISON = [
  { feature: 'AI chat (cloud credits)', free: '$0.50/month', pro: '$10.00/month' },
  { feature: 'Local automation (Simple addon)', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Cloud storage', free: '100 MB', pro: '50 GB' },
  { feature: 'Live screen viewing from phone', free: '—', pro: 'Included' },
  { feature: 'Email support', free: 'Self-serve', pro: 'Included' },
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

const LOOP = [
  { n: '01', icon: '👁️', title: 'Observe', body: "Reads your screen, active window, and files to see what's happening right now." },
  { n: '02', icon: '🧭', title: 'Orient', body: 'Builds a quick situation summary — what it just did, what changed, and what matters.' },
  { n: '03', icon: '🎯', title: 'Goal', body: "Re-checks the goal on a slower cadence and flags itself blocked when it's stuck." },
  { n: '04', icon: '🧩', title: 'Plan', body: "Picks the next concrete step — a tool call, or a deliberate wait when nothing's worth doing." },
  { n: '05', icon: '⚡', title: 'Execute', body: 'Drives the keyboard and mouse to do the work, then learns from the outcome.' },
];

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

    // Static fallback while API loads
    return [
      {
        id: 'free',
        name: 'Free',
        price: '$0',
        period: 'month',
        tagline: 'AI chat with included credits, unlimited local automation, and 100 MB storage',
        features: [
          'AI chat — $0.50/month cloud credits',
          'Simple desktop addon — unlimited local automation',
          '100 MB cloud storage',
        ],
        showAnnual: false,
      },
      {
        id: 'pro',
        name: 'Pro',
        price: billingInterval === 'year' ? '$144' : '$15',
        period: billingInterval === 'year' ? 'year' : 'month',
        tagline: 'More AI credits, 50 GB storage, phone viewing, and email support',
        features: [
          'Everything in Free',
          'AI chat — $10.00/month cloud credits',
          'Live screen viewing from your phone',
          '50 GB cloud storage',
          'Email support',
        ],
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
        <div className="pricing-floating" aria-hidden="true">
          <div className="pricing-circle pricing-circle-1"></div>
          <div className="pricing-circle pricing-circle-2"></div>
          <div className="pricing-circle pricing-circle-3"></div>
        </div>

        <section className="pricing-hero">
          <p className="pricing-eyebrow">Pricing</p>
          <h1 className="pricing-title">Simple, transparent pricing</h1>
          <p className="pricing-subtitle">
            One free plan for the core experience, one paid plan for more. No hidden fees, cancel
            anytime.
          </p>
          <ul className="pricing-trust" aria-label="Pricing assurances">
            <li>🔒 Secured by Stripe</li>
            <li>🛡️ No hidden fees</li>
            <li>↩️ Cancel anytime</li>
          </ul>
        </section>

        <main id="main" className="pricing-section">
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
                Yearly <span className="pricing-toggle-save">save 20%</span>
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

          <section className="pricing-compare" aria-label="Plan comparison">
            <h2 className="pricing-compare-title">What&apos;s included</h2>
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
            <p className="pricing-compare-note">
              AI chat runs on our servers and is metered against a monthly cloud-credit allowance —
              when it runs out, AI requests pause until the next monthly cycle. Local automation runs
              on your PC and is unlimited on every plan.
            </p>
          </section>

          <div className="pricing-bottom">
            <p>
              All plans include access to the AI chat on <Link to="/net">/net</Link>. Questions?{' '}
              Visit <Link to="/support">/support</Link>.
            </p>
          </div>

          <section className="pricing-faq" aria-label="Frequently asked questions">
            <h2 className="pricing-faq-title">Common questions</h2>
            <div className="pricing-faq-list">
              {FAQ_ITEMS.map((item) => (
                <details className="pricing-faq-item" key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* What Simple does */}
          <section className="pricing-simple" aria-label="What Simple does">
            <div className="pricing-section-head">
              <h2 className="pricing-simple-title">What Simple does</h2>
              <p className="pricing-simple-lead">
                Simple is an AI agent that runs on your PC. Show it a task once — like renaming and
                filing invoices — and afterward saying &ldquo;do the invoices&rdquo; repeats it, and
                learns from every run.
              </p>
            </div>
            <div className="pricing-simple-grid">
              {SIMPLE_FEATURES.map((f) => (
                <article className="pricing-simple-tile" key={f.title}>
                  <img className="pricing-simple-media" src={f.img} alt="" loading="lazy" />
                  <h3 className="pricing-simple-tile-title">{f.title}</h3>
                  <p className="pricing-simple-tile-body">{f.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* The engine */}
          <section className="pricing-simple" aria-label="The agent loop">
            <div className="pricing-section-head">
              <h2 className="pricing-simple-title">One loop, five stages</h2>
              <p className="pricing-simple-lead">
                Every tick, Simple runs the same closed loop. Goal re-evaluates on a slower cadence;
                after each Execute, a critic scores the result and writes a lesson the next Plan
                learns from.
              </p>
            </div>

            <div className="pricing-loop" role="list" aria-label="The agent loop">
              {LOOP.map((s, i) => (
                <React.Fragment key={s.n}>
                  <article className="pricing-loop-stage" role="listitem">
                    <span className="pricing-loop-n">{s.n}</span>
                    <span className="pricing-loop-icon" aria-hidden="true">{s.icon}</span>
                    <h3 className="pricing-loop-title">{s.title}</h3>
                    <p className="pricing-loop-body">{s.body}</p>
                  </article>
                  {i < LOOP.length - 1 && <span className="pricing-loop-arrow" aria-hidden="true">→</span>}
                </React.Fragment>
              ))}
            </div>

            <p className="pricing-loop-status" aria-hidden="true">
              observe <span>·</span> orient <span>·</span> goal <span>·</span> plan <span>·</span> execute
            </p>
          </section>

          {/* How it works */}
          <section className="pricing-simple" aria-label="How it works">
            <div className="pricing-section-head">
              <h2 className="pricing-simple-title">How it works</h2>
            </div>
            <ol className="pricing-simple-steps">
              {SIMPLE_STEPS.map((s) => (
                <li className="pricing-simple-step" key={s.n}>
                  <span className="pricing-simple-step-n">{s.n}</span>
                  <div>
                    <h3 className="pricing-simple-step-title">{s.title}</h3>
                    <p className="pricing-simple-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Get started */}
          <section className="pricing-simple pricing-simple--cta">
            <h2 className="pricing-simple-title">Ready to try it?</h2>
            <p className="pricing-simple-lead">
              Download the addon, show it one task, and ask for it back in plain English. It&apos;s
              free to start — upgrade when you need more.
            </p>
            <a
              className="pricing-simple-btn"
              href={ADDON_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download the addon
            </a>
          </section>
        </main>
      </div>
      <Footer />
    </>
  );
}

export default Pricing;
