import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { getMembershipPricing } from '../../features/data/dataSlice';
import { formatPrice } from '../../utils/checkoutUtils';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Pricing.css';

function Pricing() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user, membershipPricing, dataIsLoading } = useSelector((state) => state.data);

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
          '$0.00/mo AI credits',
          '100 MB storage',
          '50 commands per day',
          'Basic AI chat access',
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$12',
        period: 'month',
        tagline: 'For power users who need more',
        features: [
          '$0.50/mo AI credits',
          '5 GB storage',
          '500 commands per day',
          'Priority support',
        ],
      },
      {
        id: 'simple',
        name: 'Simple',
        price: '$39',
        period: 'month',
        tagline: 'Unlimited productivity',
        features: [
          '$10/mo AI credits (customizable)',
          '50 GB storage',
          '5,000 commands per day',
          'Custom credit limits',
          'Priority support',
        ],
      },
    ];
  };

  const plans = getPlans();

  const handleSelectPlan = (planId) => {
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

          {dataIsLoading && !membershipPricing ? (
            <div className="pricing-loading">
              <div className="spinner"></div>
              <p>Loading plans...</p>
            </div>
          ) : (
            <div className="pricing-plans">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`pricing-plan-card ${plan.id === 'simple' ? 'featured' : ''}`}
                >
                  {plan.id === 'simple' && (
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
                    className={`pricing-plan-cta ${plan.id === 'simple' ? 'primary' : 'secondary'}`}
                    onClick={() => handleSelectPlan(plan.id)}
                  >
                    {plan.id === 'free'
                      ? (user ? 'Current Plan' : 'Get Started Free')
                      : `Choose ${plan.name}`}
                  </button>
                </div>
              ))}
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
