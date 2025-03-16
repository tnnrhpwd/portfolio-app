import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { postPaymentMethod, getPaymentMethods, subscribeCustomer } from '../../../features/data/dataSlice';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import './CheckoutForm.css';

// Wrap Stripe initialization in a try-catch to prevent infinite loops if it fails
let stripePromise;
try {
  stripePromise = loadStripe('pk_live_51Qi5RQDe3PzRS0w2C6RELysPJGooJ2QrdAOfGJdOWS6SGAuR2TH74ZKvq4Pte6sjm9ESZdftoFHZNGdIM7aV5Fu500Y8DkVnnM');
} catch (error) {
  console.error('Failed to initialize Stripe:', error);
  // Set to null to indicate Stripe failed to load
  stripePromise = null;
}

// Component to display membership plans
const MembershipPlans = ({ selectedPlan, onSelectPlan }) => {
  const plans = [
    { 
      id: 'flex', 
      name: 'Flex Membership', 
      price: '$9.99', 
      period: 'per month',
      features: [
        'Unlimited AudioAI conversations',
        'Plan management console',
        'Strategic planning sequence',
        'Basic marketing & research tools',
        'Community support'
      ]
    },
    { 
      id: 'premium', 
      name: 'Premium Membership', 
      price: '$19.99', 
      period: 'per month',
      features: [
        'All Flex membership features',
        'Priority service & alerts',
        'Advanced AI models access',
        'Custom data analysis',
        'Priority email & phone support',
        'Early access to new features'
      ]
    }
  ];

  return (
    <div className="membership-plans">
      <h3>Choose Your Membership</h3>
      <div className="plans-container">
        {plans.map(plan => (
          <div 
            key={plan.id}
            className={`plan-card ${selectedPlan === plan.id ? 'selected' : ''}`}
            onClick={() => onSelectPlan(plan.id)}
          >
            <div className="plan-header">
              <h4>{plan.name}</h4>
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
        ))}
      </div>
    </div>
  );
};

// Component to display saved payment methods
const PaymentMethodsList = ({ paymentMethods, selectedMethod, onSelectMethod, onAddNew }) => {
  if (!paymentMethods || paymentMethods.length === 0) {
    return (
      <div className="no-payment-methods">
        <p>No payment methods found. Please add a payment method to continue.</p>
        <button className="add-method-button" onClick={onAddNew}>
          Add Payment Method
        </button>
      </div>
    );
  }

  return (
    <div className="payment-methods-container">
      <div className="payment-methods-header">
        <h3>Your Payment Methods</h3>
        <button className="add-method-link" onClick={onAddNew}>
          + Add New
        </button>
      </div>
      <div className="payment-methods-list">
        {paymentMethods.map((method) => (
          <div 
            key={method.id} 
            className={`payment-method-item ${selectedMethod === method.id ? 'selected' : ''}`}
            onClick={() => onSelectMethod(method.id)}
          >
            <div className="payment-method-icon">
              {method.type === 'card' ? '💳' : 
               method.type === 'link' ? '🔗' : 
               method.type === 'cashapp' ? '💵' : '💰'}
            </div>
            <div className="payment-method-details">
              <p className="payment-method-type">
                {method.type === 'card' ? `${method.card.brand.toUpperCase()} •••• ${method.card.last4}` : 
                 method.type === 'link' ? 'Link' :
                 method.type.replace('_', ' ')}
              </p>
              <p className="payment-method-expires">
                {method.type === 'card' ? `Expires ${method.card.exp_month}/${method.card.exp_year}` : ''}
              </p>
            </div>
            {method.default_for_currency && (
              <div className="default-badge">Default</div>
            )}
            {selectedMethod === method.id && (
              <div className="method-selected-indicator">✓</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const CheckoutContent = ({ paymentType }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stripeBlocked, setStripeBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [subscriptionStep, setSubscriptionStep] = useState('plan-selection'); // 'plan-selection', 'payment-selection', 'confirmation'
  const dispatch = useDispatch();
  const stripe = useStripe();
  const elements = useElements();
  
  // Get user email and payment methods from Redux store
  const { user, paymentMethods } = useSelector(state => state.data);
  const userEmail = user?.email || '';

  // Fetch payment methods when the component mounts
  useEffect(() => {
    dispatch(getPaymentMethods());
  }, [dispatch]);

  // Set default payment method as selected if available
  useEffect(() => {
    if (paymentMethods && paymentMethods.length > 0 && !selectedPaymentMethod) {
      const defaultMethod = paymentMethods.find(m => m.default_for_currency);
      setSelectedPaymentMethod(defaultMethod ? defaultMethod.id : paymentMethods[0].id);
    }
  }, [paymentMethods, selectedPaymentMethod]);

  // Check if Stripe is potentially blocked by an ad-blocker
  useEffect(() => {
    // Only run this check once when component mounts
    if (stripe === null && !stripeBlocked) {
      // If stripe is still null after a delay, it might be blocked
      const timer = setTimeout(() => {
        if (stripe === null) {
          setStripeBlocked(true);
          setError("Payment processing may be blocked by an ad-blocker or privacy extension. Please disable it for this site and refresh.");
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [stripe, stripeBlocked]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    
    if (!stripe || !elements) {
      setError("Stripe hasn't loaded yet. Please try disabling any ad-blockers and refresh the page.");
      return;
    }
    
    setLoading(true);
    setMessage("");
    setError(null);

    try {
      // Use confirmSetup instead of createPaymentMethod for setup intents
      // This allows saving payment methods for future use
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-success`,
        },
        redirect: 'if_required'
      });
      
      if (result.error) {
        throw new Error(result.error.message);
      } else {
        // Send the payment method ID to your server if setup was successful
        if (result.setupIntent && result.setupIntent.payment_method) {
          const paymentMethodId = result.setupIntent.payment_method;
          await dispatch(postPaymentMethod({ paymentMethodId })).unwrap();
          setMessage("Payment method saved successfully!");
          // Hide the form and refresh payment methods
          setShowPaymentForm(false);
          dispatch(getPaymentMethods());
        } else {
          // For non-redirect cases we may need to create a payment method separately
          const { paymentMethod } = await stripe.createPaymentMethod({
            elements
          });
          
          if (paymentMethod) {
            await dispatch(postPaymentMethod({ paymentMethodId: paymentMethod.id })).unwrap();
            setSelectedPaymentMethod(paymentMethod.type);
            setMessage("Payment method saved successfully!");
            // Hide the form and refresh payment methods
            setShowPaymentForm(false);
            dispatch(getPaymentMethods());
          } else {
            throw new Error("Couldn't retrieve payment method details.");
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!selectedPlan || !selectedPaymentMethod) {
      setError('Please select a plan and payment method');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await dispatch(subscribeCustomer({ 
        paymentMethodId: selectedPaymentMethod,
        membershipType: selectedPlan
      })).unwrap();
      
      setMessage(`Successfully subscribed to ${selectedPlan} membership!`);
      setSubscriptionStep('confirmation');
    } catch (err) {
      setError(err.message || 'Failed to subscribe. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Configure the PaymentElement to show multiple payment options
  const paymentElementOptions = {
    layout: {
      type: 'tabs',
      defaultCollapsed: false,
      radios: false,
      spacedAccordionItems: true
    },
    defaultValues: {
      billingDetails: {
        email: userEmail // Use the email from Redux
      }
    },
    // Enable all available payment methods with Link prominently displayed
    paymentMethodOrder: [
      'link',  // Position Link first for higher visibility
      'card', 
      'cashapp',
    ],
    // Link-specific configuration
    wallets: {
      applePay: 'auto',
      googlePay: 'auto'
    }
  };

  // Add Link-specific UI component to highlight the benefits
  const LinkBenefits = () => (
    <div className="link-benefits">
      <div className="link-benefits-header">
        <div className="link-icon">⚡</div>
        <h4>Use Link for faster checkout</h4>
      </div>
      <p className="link-description">Save your payment info once with Link and check out faster next time.</p>
      <ul className="link-features">
        <li>No more typing card details</li>
        <li>Secure one-time SMS code</li>
        <li>Works across thousands of sites</li>
      </ul>
    </div>
  );

  // Handler for the "Add Payment Method" button
  const handleAddPaymentMethod = () => {
    setShowPaymentForm(true);
    setMessage('');
    setError(null);
  };

  // Navigation between steps
  const handleNextStep = () => {
    if (subscriptionStep === 'plan-selection' && selectedPlan) {
      setSubscriptionStep('payment-selection');
    } else if (subscriptionStep === 'payment-selection' && selectedPaymentMethod) {
      setSubscriptionStep('confirmation');
    }
  };

  const handleBackStep = () => {
    if (subscriptionStep === 'payment-selection') {
      setSubscriptionStep('plan-selection');
    } else if (subscriptionStep === 'confirmation') {
      setSubscriptionStep('payment-selection');
    }
  };

  return (
    <div className="payment-container">
      {stripeBlocked ? (
        <div className="stripe-blocked-warning">
          <p>
            We've detected that Stripe payment processing may be blocked by an ad-blocker
            or privacy extension in your browser. To add a payment method, please:
          </p>
          <ol>
            <li>Disable your ad-blocker or privacy extension for this website</li>
            <li>Refresh the page</li>
            <li>Try adding your payment method again</li>
          </ol>
        </div>
      ) : (
        <>          
          {showPaymentForm ? (
            <form onSubmit={handleSubmit} className="payment-form">
              <div className="form-section">
                <h3>Your Account</h3>
                <div className="user-email-display">
                  <div className="email-icon">📧</div>
                  <div className="user-email-info">
                    <p className="user-email">{userEmail}</p>
                    <p className="email-note">Receipts and communications will be sent to this email</p>
                  </div>
                </div>
              </div>
              
              {/* Add the Link benefits section */}
              <LinkBenefits />
              
              <div className="form-section">
                <h3>Payment Method</h3>
                <p className="section-desc">All transactions are secure and encrypted</p>
                <PaymentElement id="payment-element" options={paymentElementOptions} />
              </div>
              
              {message && (
                <div className="payment-success">
                  <span className="success-checkmark">✓</span> {message}
                  {selectedPaymentMethod && (
                    <p className="payment-method-selected">
                      Using: {selectedPaymentMethod.replace('_', ' ')}
                    </p>
                  )}
                </div>
              )}
              
              {error && <div className="pay-error">{error}</div>}
              
              <div className="form-buttons">
                <button 
                  type="button" 
                  className="cancel-button"
                  onClick={() => setShowPaymentForm(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  id="add-payment-button" 
                  disabled={loading || !stripe}
                  className={loading ? 'button-loading' : ''}
                >
                  {loading ? (
                    <>
                      <span className="spinner"></span>
                      <span>Processing...</span>
                    </>
                  ) : (
                    'Save Payment Method'
                  )}
                </button>
              </div>
              
              <div className="payment-security">
                <div className="security-icon">🔒</div>
                <p>Your payment information is secure and encrypted with bank-level security</p>
              </div>
              
              <div className="terms-agreement">
                By adding a payment method, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
              </div>
            </form>
          ) : (
            <div className="subscription-flow">
              {subscriptionStep === 'plan-selection' && (
                <div className="step-container">
                  <MembershipPlans 
                    selectedPlan={selectedPlan}
                    onSelectPlan={setSelectedPlan}
                  />
                  <div className="step-navigation">
                    <button 
                      className="next-step-button" 
                      onClick={handleNextStep}
                      disabled={!selectedPlan}
                    >
                      Next: Select Payment
                    </button>
                  </div>
                </div>
              )}
              
              {subscriptionStep === 'payment-selection' && (
                <div className="step-container">
                  <PaymentMethodsList 
                    paymentMethods={paymentMethods}
                    selectedMethod={selectedPaymentMethod}
                    onSelectMethod={setSelectedPaymentMethod}
                    onAddNew={handleAddPaymentMethod}
                  />
                  <div className="step-navigation">
                    <button 
                      className="back-button" 
                      onClick={handleBackStep}
                    >
                      Back
                    </button>
                    <button 
                      className="next-step-button" 
                      onClick={handleNextStep}
                      disabled={!selectedPaymentMethod}
                    >
                      Next: Confirm Subscription
                    </button>
                  </div>
                </div>
              )}
              
              {subscriptionStep === 'confirmation' && (
                <div className="step-container confirmation-step">
                  <h3>Confirm Your Subscription</h3>
                  <div className="confirmation-details">
                    <div className="confirmation-item">
                      <span className="label">Membership:</span>
                      <span className="value">{selectedPlan === 'premium' ? 'Premium ($19.99/month)' : 'Flex ($9.99/month)'}</span>
                    </div>
                    <div className="confirmation-item">
                      <span className="label">Payment Method:</span>
                      <span className="value">
                        {paymentMethods && selectedPaymentMethod && 
                         paymentMethods.find(m => m.id === selectedPaymentMethod)?.type === 'card' ? 
                         `${paymentMethods.find(m => m.id === selectedPaymentMethod)?.card.brand.toUpperCase()} •••• ${paymentMethods.find(m => m.id === selectedPaymentMethod)?.card.last4}` :
                         'Selected payment method'}
                      </span>
                    </div>
                    <div className="confirmation-item">
                      <span className="label">Billing Email:</span>
                      <span className="value">{userEmail}</span>
                    </div>
                  </div>
                  
                  {message && (
                    <div className="payment-success">
                      <span className="success-checkmark">✓</span> {message}
                    </div>
                  )}
                  
                  {error && <div className="pay-error">{error}</div>}
                  
                  <div className="step-navigation">
                    <button 
                      className="back-button" 
                      onClick={handleBackStep}
                      disabled={loading}
                    >
                      Back
                    </button>
                    <button 
                      className="subscribe-button" 
                      onClick={handleSubscribe}
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <span className="spinner"></span>
                          <span>Processing...</span>
                        </>
                      ) : (
                        'Confirm & Subscribe'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

function CheckoutForm({ paymentType }) {
  const [isStripeError, setIsStripeError] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const dispatch = useDispatch();

  useEffect(() => {
    const getSetupIntent = async () => {
      try {
        // Use the existing postPaymentMethod action from Redux
        // When called without a paymentMethodId, it creates a setup intent
        const setupIntent = await dispatch(postPaymentMethod({})).unwrap();
        
        // Check if we received a valid client secret
        if (setupIntent && setupIntent.client_secret) {
          console.log('Setup intent created successfully');
          setClientSecret(setupIntent.client_secret);
        } else {
          console.error('Invalid setup intent response:', setupIntent);
        }
      } catch (error) {
        console.error('Failed to get setup intent:', error);
      }
    };
    
    getSetupIntent();
  }, [dispatch]);

  // If Stripe initialization failed, show an error instead of trying to load Elements
  if (stripePromise === null && !isStripeError) {
    setIsStripeError(true);
  }

  if (isStripeError) {
    return (
      <div className="stripe-error">
        <h3>Payment Processing Unavailable</h3>
        <p>We're having trouble initializing our payment processor. This may be caused by:</p>
        <ul>
          <li>An ad-blocker or privacy extension blocking Stripe</li>
          <li>Connection issues with our payment provider</li>
        </ul>
        <p>Please try disabling any ad-blockers or privacy extensions, then refresh the page.</p>
      </div>
    );
  }

  if (!clientSecret || !clientSecret.includes('_secret_')) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Preparing payment options...</p>
      </div>
    );
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#4f9cf9',
        colorBackground: '#ffffff',
        colorText: '#424770',
        colorDanger: '#e74c3c',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
      },
    },
    loader: 'auto', // Use 'auto' for optimal Link loading behavior
  };

  return (
    <div className="checkout-container">
      {clientSecret && (
        <Elements stripe={stripePromise} options={options}>
          <CheckoutContent paymentType={paymentType} />
        </Elements>
      )}
      {!clientSecret && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Preparing payment options...</p>
        </div>
      )}
    </div>
  );
}

export default CheckoutForm;
