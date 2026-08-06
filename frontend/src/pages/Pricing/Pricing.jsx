import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import usePurchaseGate from '../../hooks/usePurchaseGate';
import './Pricing.css';

function Pricing() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user, membershipPricing, dataIsLoading } = useSelector((state) => state.data);
  const { purchasesEnabled, message: gateMessage } = usePurchaseGate();

  useEffect(() => {
    dispatch(getMembershipPricing());
  }, [dispatch]);

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
        tagline: 'Get started with the basics',
        features: [
          'AI chat (bring your own API key)',
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
      <Header />
      <div className="pricing-page">
        <div className="floating-shapes">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>

        <div className="pricing-content">
          <div className="pricing-hero">
            <h1>Simple, Transparent Pricing</h1>
            <p>Choose the plan that fits your workflow. Upgrade or downgrade anytime.</p>
          </div>

          {!purchasesEnabled && (
            <div className="pricing-gate-notice" role="status">
              {gateMessage || 'Upgrading is temporarily paused. Please check back soon.'}
            </div>
          )}

          {dataIsLoading && !membershipPricing ? (
            <div className="pricing-loading">
              <div className="spinner"></div>
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
              All plans include access to the AI chat on <a href="/net">/net</a>.
              Questions? Visit <a href="/support">/support</a>.
            </p>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Pricing;
