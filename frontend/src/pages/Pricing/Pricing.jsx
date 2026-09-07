import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing, getUserStorage } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import usePurchaseGate from '../../hooks/usePurchaseGate';
import './Pricing.css';

const FAQ_ITEMS = [
  {
    q: 'What does Free include?',
    a: 'AI chat with included monthly cloud credits, the full Simple desktop addon with unlimited local automation, and 100 MB of cloud storage.',
  },
  {
    q: 'What do I get with Pro?',
    a: 'Everything in Free, plus 50 GB of storage, live screen viewing from your phone, and email support.',
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
        tagline: 'AI chat, full local automation, and 100 MB storage',
        features: [
          'AI chat (included monthly cloud credits)',
          'Simple desktop addon — full local automation, no daily cap',
          '100 MB cloud storage',
        ],
        showAnnual: false,
      },
      {
        id: 'pro',
        name: 'Pro',
        price: billingInterval === 'year' ? '$144' : '$15',
        period: billingInterval === 'year' ? 'year' : 'month',
        tagline: 'More storage, live phone viewing, and email support',
        features: [
          'Everything in Free',
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
        </main>
      </div>
      <Footer />
    </>
  );
}

export default Pricing;
