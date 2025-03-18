import React, { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { postPaymentMethod, getPaymentMethods, subscribeCustomer, getUserSubscription } from '../../../features/data/dataSlice';
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
const MembershipPlans = ({ selectedPlan, onSelectPlan, currentSubscription }) => {
  const plans = [
    {
      id: 'free',
      name: 'Free Tier',
      price: '$0',
      period: 'per month',
      tagline: 'Experience the basics with zero commitment',
      features: [
        'Limited API calls – perfect for exploring our services',
        'Simple, real-time dashboard',
        'Community support forum',
      ],
      quota: { calls: '1,000 calls/month' },
    },
    {
      id: 'flex',
      name: 'Flex Membership',
      price: '$10',
      period: 'per month',
      tagline: 'Pay only for what you use',
      features: [
        'Usage-based pricing – enjoy a baseline quota then pay per call',
        'Strategic planning tools for scaling efficiently',
        'Enhanced analytics dashboard for smarter decision-making',
      ],
      quota: {
        baseCalls: '10,000 calls/month',
        overageRate: '$0.001 per additional call',
      },
    },
    { 
      id: 'premium',
      name: 'Premium Membership',
      price: 'Custom Pricing',
      period: 'per month',
      tagline: 'Power users and enterprises: maximize efficiency and savings',
      features: [
        'Significantly reduced per-usage rates – save up to 30% on volume',
        'Set your monthly maximum with predictability in billing',
        'Priority AI processing for rapid execution',
        'Advanced analytics with detailed data insights',
        'Dedicated support channel with direct expert access',
        'Exclusive early access to innovative, cutting-edge features',
      ],
    }
  ];

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

// New Progress Bar component
const CheckoutProgressBar = ({ currentStep }) => {
  const steps = [
    { id: 'plan-selection', label: 'Select Plan' },
    { id: 'payment-selection', label: 'Payment Method' },
    { id: 'confirmation', label: 'Confirm' }
  ];

  return (
    <div className="checkout-progress-container">
      <div className="checkout-progress-bar">
        {steps.map((step, index) => {
          // Determine if the step is active, completed, or upcoming
          const isActive = step.id === currentStep;
          const isCompleted = steps.findIndex(s => s.id === currentStep) > index;
          const stepClass = isActive ? 'active' : isCompleted ? 'completed' : 'upcoming';
          
          return (
            <React.Fragment key={step.id}>
              {/* Add connector lines between steps except for the first step */}
              {index > 0 && (
                <div className={`progress-connector ${isCompleted ? 'completed' : ''}`} />
              )}
              
              {/* The step circle */}
              <div className={`progress-step ${stepClass}`}>
                <div className="progress-step-circle">
                  {isCompleted ? '✓' : index + 1}
                </div>
                <div className="progress-step-label">{step.label}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const CheckoutContent = ({ paymentType, initialPlan }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stripeBlocked, setStripeBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(initialPlan || null);
  const [subscriptionStep, setSubscriptionStep] = useState('plan-selection'); // 'plan-selection', 'payment-selection', 'confirmation'
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();
  
  // Create a ref for the container to scroll to
  const checkoutContainerRef = useRef(null);
  
  // Get user email and payment methods from Redux store
  const { user, paymentMethods } = useSelector(state => state.data);
  const userEmail = user?.email || '';

  // Fetch payment methods when the component mounts
  useEffect(() => {
    dispatch(getPaymentMethods());
    
    // Fetch current subscription
    dispatch(getUserSubscription())
      .unwrap()
      .then((subscriptionData) => {
        setCurrentSubscription(subscriptionData?.subscriptionPlan?.toLowerCase() || 'free');
        console.log('Current subscription:', subscriptionData?.subscriptionPlan);
        
        // If initialPlan is the same as current subscription, show message
        if (initialPlan && initialPlan.toLowerCase() === (subscriptionData?.subscriptionPlan?.toLowerCase() || 'free')) {
          setError(`You are already subscribed to the ${subscriptionData?.subscriptionPlan || 'Free'} plan`);
        }
      })
      .catch(error => {
        console.error('Error fetching subscription:', error);
      });
  }, [dispatch, initialPlan]);

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
      
      // Show success message briefly before redirecting
      setTimeout(() => {
        navigate('/profile');
      }, 1500); // 1.5 second delay to show success message
      
    } catch (err) {
      console.error('Subscription failed:', err);
      
      // Create detailed error message
      const errorMessage = err.message || 'Failed to subscribe. Please try again.';
      setError(errorMessage);
      
      // Display error details in UI and console
      console.log('Error details:', { 
        plan: selectedPlan,
        paymentMethod: selectedPaymentMethod,
        errorMessage
      });
      
      // Stay on confirmation step so user can retry
      setSubscriptionStep('confirmation');
    } finally {
      setLoading(false);
    }
  };

  // New function to handle saving free subscription
  const handleFreePlanSubscription = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Call the subscribeCustomer action with free plan to cancel all subscriptions
      await dispatch(subscribeCustomer({ 
        membershipType: 'free',
        cancelAllSubscriptions: true // Explicit flag to cancel all subscriptions
      })).unwrap();
      
      // Update local state to reflect the change
      setCurrentSubscription('free');
      setMessage('Successfully switched to Free tier!');
      
      // Update the subscription in Redux store
      dispatch(getUserSubscription());
      
      // Show success message briefly before redirecting
      setTimeout(() => {
        navigate('/profile');
      }, 1500); // 1.5 second delay to show success message
    } catch (err) {
      console.error('Free subscription setup failed:', err);
      setError(err.message || 'Failed to set up free subscription. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Update the handleNextStep function
  const handleNextStep = () => {
    if (subscriptionStep === 'plan-selection' && selectedPlan) {
      // If free plan is selected, set up the free subscription instead of just redirecting
      if (selectedPlan === 'free') {
        handleFreePlanSubscription();
        return;
      } else {
        setSubscriptionStep('payment-selection');
      }
      
      // Scroll to top after state update
      setTimeout(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
        console.log('Scrolled to top');
      }, 100);
    } else if (subscriptionStep === 'payment-selection' && selectedPaymentMethod) {
      setSubscriptionStep('confirmation');
      
      // Scroll to top after state update
      setTimeout(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
        console.log('Scrolled to top');
      }, 100);
    }
  };

  const handleBackStep = () => {
    if (subscriptionStep === 'payment-selection') {
      setSubscriptionStep('plan-selection');
      
      // Scroll to top after state update
      setTimeout(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 100);
    } else if (subscriptionStep === 'confirmation') {
      setSubscriptionStep('payment-selection');
      
      // Scroll to top after state update
      setTimeout(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 100);
    }
  };

  // Handle cancel button - redirect to profile page
  const handleCancel = () => {
    navigate('/profile');
  };

  // Update the subscription confirmation display
  const getPlanDisplayName = () => {
    if (selectedPlan === 'premium') {
      return 'Premium (Usage-based with customizable max)';
    } else if (selectedPlan === 'flex') {
      return 'Flex (Usage-based with $10 monthly max)';
    } else {
      return 'Free';
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
    
    // Scroll to top when showing payment form
    setTimeout(() => {
      window.scrollTo({
        top: checkoutContainerRef.current?.offsetTop || 0,
        behavior: 'smooth'
      });
    }, 100);
  };

  // Modify MembershipPlans component to receive and use currentSubscription
  const renderMembershipPlans = () => (
    <MembershipPlans 
      selectedPlan={selectedPlan}
      onSelectPlan={setSelectedPlan}
      currentSubscription={currentSubscription}
    />
  );

  return (
    <div className="payment-container" ref={checkoutContainerRef}>
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
          {/* Add progress bar at the top of the form */}
          <CheckoutProgressBar currentStep={subscriptionStep} />
          
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
                  {renderMembershipPlans()}
                  <div className="step-navigation">
                    <button 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                    <button 
                      className="next-step-button" 
                      onClick={handleNextStep}
                      disabled={!selectedPlan || loading || selectedPlan === currentSubscription}
                    >
                      {selectedPlan === 'free' ? 
                        (loading ? <><span className="spinner"></span> Saving...</> : 'Save') : 
                        'Next: Select Payment'}
                    </button>
                  </div>
                  {/* Add message display for free plan selection */}
                  {selectedPlan === 'free' && message && (
                    <div className="payment-success">
                      <span className="success-checkmark">✓</span> {message}
                      <p className="redirect-notice">Redirecting to your profile page...</p>
                    </div>
                  )}
                  {selectedPlan === 'free' && error && (
                    <div className="pay-error">{error}</div>
                  )}
                  {/* Display error if user tries to select their current plan */}
                  {selectedPlan === currentSubscription && (
                    <div className="pay-error">
                      You are already subscribed to this plan. Please select a different plan or cancel.
                    </div>
                  )}
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
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
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
                      <span className="value">{getPlanDisplayName()}</span>
                    </div>
                    {selectedPlan !== 'free' && (
                      <div className="confirmation-item">
                        <span className="label">Payment Method:</span>
                        <span className="value payment-method-value">
                          {paymentMethods && selectedPaymentMethod && (() => {
                            const method = paymentMethods.find(m => m.id === selectedPaymentMethod);
                            if (!method) return 'Selected payment method';
                            
                            // Create the icon based on payment method type
                            const getPaymentIcon = (type) => {
                              switch (type) {
                                case 'card': return '💳';
                                case 'link': return '🔗';
                                case 'cashapp': return '💵';
                                default: return '💰';
                              }
                            };
                            
                            // Display method details based on type
                            if (method.type === 'card') {
                              return (
                                <>
                                  <span className="payment-confirm-icon">{getPaymentIcon(method.type)}</span>
                                  {`${method.card.brand.toUpperCase()} •••• ${method.card.last4}`}
                                </>
                              );
                            } else {
                              // For Link, CashApp, or other payment methods
                              return (
                                <>
                                  <span className="payment-confirm-icon">{getPaymentIcon(method.type)}</span>
                                  {method.type.charAt(0).toUpperCase() + method.type.slice(1).replace('_', ' ')}
                                </>
                              );
                            }
                          })()}
                        </span>
                      </div>
                    )}
                    <div className="confirmation-item">
                      <span className="label">Billing Email:</span>
                      <span className="value">{userEmail}</span>
                    </div>
                  </div>
                  
                  <div className="pricing-note">
                    {selectedPlan === 'free' ? (
                      <p>You've selected our Free tier. You can upgrade anytime in your profile settings.</p>
                    ) : (
                      <p>With {selectedPlan === 'premium' ? 'Premium' : 'Flex'}, you'll only pay for what you use. 
                      {selectedPlan === 'premium' ? 
                        ' Your custom monthly maximum ensures you stay in control while enjoying lower per-usage rates.' : 
                        ' Never worry about exceeding $10 per month, guaranteed.'}
                      </p>
                    )}
                  </div>
                  
                  {message && (
                    <div className="payment-success">
                      <span className="success-checkmark">✓</span> {message}
                      <p className="redirect-notice">Redirecting to your profile page...</p>
                    </div>
                  )}
                  
                  {error && (
                    <div className="pay-error">
                      <p className="error-message">{error}</p>
                      <p className="error-suggestion">
                        Please check your payment details and try again, or contact support if the issue persists.
                      </p>
                    </div>
                  )}
                  
                  <div className="step-navigation">
                    <button 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
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
                      disabled={loading || message} // Disable if already subscribed successfully
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

function CheckoutForm({ paymentType, initialPlan }) {
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
          <CheckoutContent paymentType={paymentType} initialPlan={initialPlan} />
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
