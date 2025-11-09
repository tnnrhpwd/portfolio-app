import React from 'react';
import { formatPrice } from '../../utils/checkoutUtils';

/**
 * MembershipPlans Component
 * Displays membership plan options with custom pricing for premium/flex plans
 */
const MembershipPlans = ({ 
  selectedPlan, 
  onSelectPlan, 
  currentSubscription, 
  membershipPricing, 
  customPrice, 
  onCustomPriceChange, 
  customPriceError 
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
              className={`plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${isCurrentPlan ? 'current-plan' : ''}`}
              onClick={() => onSelectPlan(plan.id)}
            >
              {isCurrentPlan && <div className="current-plan-badge">Current Plan</div>}
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
                {selectedPlan === plan.id && <span className="checkmark">✓</span>}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Custom Price Input for Premium and Flex Plans */}
      {(selectedPlan === 'premium' || selectedPlan === 'flex') && (
        <div className={`custom-price-section ${selectedPlan === 'flex' ? 'flex-plan' : 'premium-plan'}`}>
          <div className="custom-price-header">
            <h4>Set Your Custom Price</h4>
            <p className="custom-price-description">
              {selectedPlan === 'premium' 
                ? 'As a premium member, you set your annual investment with monthly usage tracking. This provides predictable annual costs while scaling usage according to your business needs.'
                : 'With Simple membership, set your own monthly budget while enjoying usage-based pricing. Pay only for what you use within your custom limit.'
              }
            </p>
          </div>
          
          <div className="custom-price-input-group">
            <label htmlFor="custom-price">
              {selectedPlan === 'premium' ? 'Annual Investment (USD)' : 'Monthly Budget (USD)'}
            </label>
            <div className="price-input-container">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                id="custom-price"
                min={selectedPlan === 'premium' ? '9999' : '10'}
                step="1"
                value={customPrice}
                onChange={(e) => onCustomPriceChange(e.target.value)}
                className={`custom-price-input ${customPriceError ? 'error' : ''}`}
                placeholder={selectedPlan === 'premium' ? '9999' : '10'}
              />
              <span className="price-period">{selectedPlan === 'premium' ? '/year' : '/month'}</span>
            </div>
            {customPriceError && (
              <div className="price-error-message">{customPriceError}</div>
            )}
            <div className="price-benefits">
              <p className="minimum-note">
                ⚡ Minimum {selectedPlan === 'premium' ? 'annual investment' : 'monthly budget'}: 
                ${selectedPlan === 'premium' ? '9,999/year (~$833/month)' : '10/month'}
              </p>
              <div className="price-tier-benefits">
                <p><strong>Your {selectedPlan === 'premium' ? 'investment' : 'budget'} unlocks:</strong></p>
                <ul>
                  {selectedPlan === 'premium' ? (
                    <>
                      <li>🚀 Higher usage limits based on your investment level</li>
                      <li>⏱️ Priority processing and faster response times</li>
                      <li>👨‍💼 Dedicated account management and support</li>
                      <li>🔧 Custom integrations and enterprise features</li>
                      <li>📊 Advanced analytics and reporting capabilities</li>
                      <li>🖥️ Simple.NET desktop app installation and license</li>
                    </>
                  ) : (
                    <>
                      <li>💰 Usage-based billing up to your custom limit</li>
                      <li>📊 Enhanced analytics dashboard access</li>
                      <li>🛠️ Strategic planning tools for scaling</li>
                      <li>📧 Email support and community access</li>
                      <li>🌐 Full web-based platform access</li>
                      <li>📈 Baseline quota with overage protection</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembershipPlans;
