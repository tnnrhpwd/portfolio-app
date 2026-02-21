import React from 'react';
import { formatPrice } from '../../utils/checkoutUtils';

/**
 * MembershipPlans Component
 * Displays membership plan options: Free, Pro, Simple
 */
const MembershipPlans = ({ 
  selectedPlan, 
  onSelectPlan, 
  currentSubscription, 
  membershipPricing
}) => {
  // Create plans array with dynamic pricing if available
  const getPlans = () => {
    if (membershipPricing && membershipPricing.success && membershipPricing.data && membershipPricing.data.length > 0) {
      const dynamicPlans = membershipPricing.data.map(product => {
        return {
          id: product.id,
          name: product.name,
          price: product.price ? formatPrice(product.price) : 'Free',
          period: `per ${product.interval || 'month'}`,
          tagline: product.description || '',
          features: product.features || [],
          quota: product.quota || {},
        };
      });
      
      return dynamicPlans;
    }
    return [];
  };

  const plans = getPlans();

  return (
    <div className="membership-plans">
      <h3>Choose Your Membership</h3>
      <div className="plans-container">
        {plans.map(plan => {
          const isCurrentPlan = plan.id === currentSubscription;
          
          return (
            <div 
              key={plan.id}
              className={`plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${isCurrentPlan ? 'current-plan' : ''} ${plan.id === 'simple' ? 'featured' : ''}`}
              onClick={() => onSelectPlan(plan.id)}
            >
              {isCurrentPlan && <div className="current-plan-badge">Current Plan</div>}
              {plan.id === 'simple' && !isCurrentPlan && <div className="popular-badge">Best Value</div>}
              <div className="plan-header">
                <h4>{plan.name}</h4>
                <p className="plan-tagline">{plan.tagline}</p>
                <div className="plan-price">
                  <span className="price">{plan.price}</span>
                  <span className="period">{plan.period}</span>
                </div>
              </div>
              <ul className="plan-features">
                {plan.features.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>
              <div className={`plan-selector ${selectedPlan === plan.id ? 'selected' : ''}`}>
                {selectedPlan === plan.id && <span className="checkmark">\u2713</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MembershipPlans;
