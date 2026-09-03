import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing, getUserStorage } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import usePurchaseGate from '../../hooks/usePurchaseGate';
import './Pricing.css';

function Pricing() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user, membershipPricing, dataIsLoading, userStorage } = useSelector((state) => state.data);
  const { purchasesEnabled, message: gateMessage } = usePurchaseGate();

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

  // Build plans from dynamic pricing or fall back to static defaults
  const getPlans = () => {
    if (membershipPricing?.success && membershipPricing?.data?.length > 0) {
      return membershipPricing.data.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price ? formatPrice(product.price) : '$0',
        period: product.interval || 'month',
        tagline: product.description || '',
        features: product.features || [],
      }));
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
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$15',
        period: 'month',
        tagline: 'More storage, live phone viewing, and email support',
        features: [
          'Everything in Free',
          'Live screen viewing from your phone',
          '50 GB cloud storage',
          'Email support',
        ],
      },
    ];
  };

  const plans = getPlans();

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
          <div className="pricing-title-wrap">
            <p className="pricing-eyebrow">Membership</p>
            <h1 className="pricing-title">Simple, Transparent Pricing</h1>
            <p className="pricing-subtitle">Choose the plan that fits your workflow. Upgrade or downgrade anytime.</p>
            <p className="pricing-lead">
              Simple is an AI agent for your Windows PC: show it once how you rename and file
              invoices, and afterward saying “do the invoices” repeats those steps.
            </p>
          </div>
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

          {dataIsLoading && !membershipPricing ? (
            <div className="pricing-loading">
              <div className="pricing-spinner" aria-hidden="true"></div>
              <p>Loading plans...</p>
            </div>
          ) : (
            <div className="pricing-plans">
              {plans.map((plan) => {
                const gated = plan.id !== 'free' && !purchasesEnabled;
                return (
                  <div
                    key={plan.id}
                    className={`pricing-plan-card ${plan.id === 'pro' ? 'featured' : ''}`}
                  >
                    {plan.id === 'pro' && (
                      <div className="pricing-plan-badge">Best Value</div>
                    )}
                    <div className="pricing-plan-name">{plan.name}</div>
                    <div className="pricing-plan-price">
                      {plan.price}
                      <span className="period">/{plan.period}</span>
                    </div>
                    <div className="pricing-plan-tagline">{plan.tagline}</div>
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
                  </div>
                );
              })}
            </div>
          )}

          <div className="pricing-bottom">
            <p>
              All plans include access to the AI chat on <Link to="/net">/net</Link>.
              Questions? Visit <Link to="/support">/support</Link>.
            </p>
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}

export default Pricing;
