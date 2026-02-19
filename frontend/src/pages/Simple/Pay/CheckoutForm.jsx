import React, { useRef } from 'react';
import { useDispatch } from 'react-redux';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { createCustomer } from '../../../features/data/dataSlice';
import { formatPrice } from '../../../utils/checkoutUtils';
import { getPaymentElementOptions, getPlanDisplayName, formatPaymentMethodDisplay } from '../../../utils/stripeHelpers';
import { useCheckoutState } from '../../../hooks/useCheckoutState';
import { useCheckoutHandlers } from '../../../hooks/useCheckoutHandlers';
import { useCheckoutData } from '../../../hooks/useCheckoutData';
import { useStripeSetup } from '../../../hooks/useStripeSetup';
import MembershipPlans from '../../../components/Checkout/MembershipPlans';
import PaymentMethodsList from '../../../components/Checkout/PaymentMethodsList';
import CheckoutProgressBar from '../../../components/Checkout/CheckoutProgressBar';
import { LinkBenefits } from '../../../components/Checkout/LinkBenefits';
import './CheckoutForm.css';

const stripePromise = process.env.REACT_APP_STRIPE_PUBLIC_KEY
  ? loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY).catch(err => {
      console.error('Failed to load Stripe:', err);
      return null;
    })
  : Promise.resolve(null);

const CheckoutContent = ({ paymentType, initialPlan }) => {
  const stripe = useStripe();
  const elements = useElements();
  const checkoutContainerRef = useRef(null);
  
  // Custom hooks for state management, data fetching, and event handlers
  const state = useCheckoutState(initialPlan);
  const { paymentMethods, membershipPricing } = useCheckoutData(state.setStripeBlocked);
  const { userEmail } = useStripeSetup();
  
  const handlers = useCheckoutHandlers({
    stripe,
    elements,
    userEmail,
    selectedPlan: state.selectedPlan,
    customPrice: state.customPrice,
    selectedPaymentMethod: state.selectedPaymentMethod,
    subscriptionStep: state.subscriptionStep,
    setMessage: state.setMessage,
    setError: state.setError,
    setLoading: state.setLoading,
    setSubscriptionStep: state.setSubscriptionStep,
    setSelectedPaymentMethod: state.setSelectedPaymentMethod,
    setCustomPrice: state.setCustomPrice,
    setCustomPriceError: state.setCustomPriceError,
    setShowPaymentForm: state.setShowPaymentForm,
    checkoutContainerRef
  });

  const paymentElementOptions = getPaymentElementOptions(userEmail);

  return (
    <div className="payment-container" ref={checkoutContainerRef}>
      {state.stripeBlocked ? (
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
          <CheckoutProgressBar currentStep={state.subscriptionStep} />
          
          {state.showPaymentForm ? (
            <form onSubmit={handlers.handleSubmit} className="payment-form">
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
              
              <LinkBenefits />
              
              <div className="form-section">
                <h3>Payment Method</h3>
                <p className="section-desc">All transactions are secure and encrypted</p>
                <PaymentElement id="payment-element" options={paymentElementOptions} />
              </div>
              
              {state.message && (
                <div className="payment-success">
                  <span className="success-checkmark">✓</span> {state.message}
                  {state.selectedPaymentMethod && (
                    <p className="payment-method-selected">
                      Using: {state.selectedPaymentMethod.replace('_', ' ')}
                    </p>
                  )}
                </div>
              )}
              
              {state.error && <div className="pay-error">{state.error}</div>}
              
              <div className="form-buttons">
                <button 
                  type="button" 
                  className="cancel-button"
                  onClick={() => state.setShowPaymentForm(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  id="add-payment-button" 
                  disabled={state.loading || !stripe}
                  className={state.loading ? 'button-loading' : ''}
                >
                  {state.loading ? (
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
              {state.subscriptionStep === 'plan-selection' && (
                <div className="step-container">
                  <MembershipPlans 
                    selectedPlan={state.selectedPlan}
                    onSelectPlan={(planId) => {
                      handlers.handlePlanSelection(planId);
                      state.setSelectedPlan(planId);
                    }}
                    currentSubscription={state.currentSubscription}
                    membershipPricing={membershipPricing}
                    customPrice={state.customPrice}
                    onCustomPriceChange={handlers.handleCustomPriceChange}
                    customPriceError={state.customPriceError}
                  />
                  <div className="step-navigation">
                    <button 
                      className="cancel-button" 
                      onClick={handlers.handleCancel}
                    >
                      Cancel
                    </button>
                    <button 
                      className="next-step-button" 
                      onClick={handlers.handleNextStep}
                      disabled={!state.selectedPlan || state.loading || 
                               (state.selectedPlan === state.currentSubscription && state.selectedPlan !== 'free')}
                    >
                      {state.selectedPlan === 'free' ? 
                        (state.loading ? <><span className="spinner"></span> Saving...</> : 'Save') : 
                        'Next: Select Payment'}
                    </button>
                  </div>
                  {state.selectedPlan === 'free' && state.message && (
                    <div className="payment-success">
                      <span className="success-checkmark">✓</span> {state.message}
                      <p className="redirect-notice">Redirecting to your profile page...</p>
                    </div>
                  )}
                  {state.selectedPlan === 'free' && state.error && (
                    <div className="pay-error">{state.error}</div>
                  )}
                  {state.selectedPlan === state.currentSubscription && state.selectedPlan !== 'free' && (
                    <div className="pay-error">
                      You are already subscribed to this plan. Please select a different plan or cancel.
                    </div>
                  )}
                </div>
              )}
              
              {state.subscriptionStep === 'payment-selection' && (
                <div className="step-container">
                  <PaymentMethodsList 
                    paymentMethods={paymentMethods}
                    selectedMethod={state.selectedPaymentMethod}
                    onSelectMethod={state.setSelectedPaymentMethod}
                    onAddNew={handlers.handleAddPaymentMethod}
                  />
                  <div className="step-navigation">
                    <button 
                      className="cancel-button" 
                      onClick={handlers.handleCancel}
                    >
                      Cancel
                    </button>
                    <button 
                      className="back-button" 
                      onClick={handlers.handleBackStep}
                    >
                      Back
                    </button>
                    <button 
                      className="next-step-button" 
                      onClick={handlers.handleNextStep}
                      disabled={!state.selectedPaymentMethod}
                    >
                      Next: Confirm Subscription
                    </button>
                  </div>
                </div>
              )}
              
              {state.subscriptionStep === 'confirmation' && (
                <div className="step-container confirmation-step">
                  <h3>Confirm Your Subscription</h3>
                  <div className="confirmation-details">
                    <div className="confirmation-item">
                      <span className="label">Membership:</span>
                      <span className="value">
                        {getPlanDisplayName(state.selectedPlan, membershipPricing, state.customPrice, formatPrice)}
                      </span>
                    </div>
                    {state.selectedPlan !== 'free' && (
                      <div className="confirmation-item">
                        <span className="label">Payment Method:</span>
                        <span className="value payment-method-value">
                          {(() => {
                            const display = formatPaymentMethodDisplay(paymentMethods, state.selectedPaymentMethod);
                            return (
                              <>
                                <span className="payment-confirm-icon">{display.icon}</span>
                                {display.text}
                              </>
                            );
                          })()}
                        </span>
                      </div>
                    )}
                    {state.selectedPlan === 'premium' && (
                      <div className="confirmation-item">
                        <span className="label">Custom Price:</span>
                        <span className="value custom-price-display">
                          ${parseFloat(state.customPrice).toLocaleString()}/month
                        </span>
                      </div>
                    )}
                    <div className="confirmation-item">
                      <span className="label">Billing Email:</span>
                      <span className="value">{userEmail}</span>
                    </div>
                  </div>
                  
                  {state.message && (
                    <div className="payment-success">
                      <span className="success-checkmark">✓</span> {state.message}
                      <p className="redirect-notice">Redirecting to your profile page...</p>
                    </div>
                  )}
                  
                  {state.error && (
                    <div className="pay-error">
                      <p className="error-message">{state.error}</p>
                      <p className="error-suggestion">
                        Please check your payment details and try again, or contact support if the issue persists.
                      </p>
                    </div>
                  )}
                  
                  <div className="step-navigation">
                    <button 
                      className="cancel-button" 
                      onClick={handlers.handleCancel}
                    >
                      Cancel
                    </button>
                    <button 
                      className="back-button" 
                      onClick={handlers.handleBackStep}
                      disabled={state.loading}
                    >
                      Back
                    </button>
                    <button 
                      className="subscribe-button" 
                      onClick={handlers.handleSubscribe}
                      disabled={state.loading || state.message}
                    >
                      {state.loading ? (
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
  const dispatch = useDispatch();
  const { clientSecret, error, isStripeError, setIsStripeError, userEmail, user } = useStripeSetup();

  const testCustomerCreation = async () => {
    try {
      const customerData = {
        email: userEmail,
        name: user?.nickname || userEmail.split('@')[0]
      };
      await dispatch(createCustomer(customerData)).unwrap();
      window.location.reload();
    } catch (error) {
      console.error('Customer creation test failed:', error);
    }
  };

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
        <button onClick={testCustomerCreation} style={{marginTop: '10px', padding: '10px', backgroundColor: '#007cba', color: 'white', border: 'none', borderRadius: '4px'}}>
          Test Customer Creation
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pay-error">
        <h3>Payment Setup Error</h3>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Try Again</button>
      </div>
    );
  }

  if (!clientSecret || !clientSecret.includes('_secret_')) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Preparing payment options...</p>
        <button onClick={testCustomerCreation} style={{marginTop: '10px', padding: '10px', backgroundColor: '#007cba', color: 'white', border: 'none', borderRadius: '4px'}}>
          Test Customer Creation
        </button>
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
    loader: 'auto',
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
