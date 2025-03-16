import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { postPaymentMethod } from '../../../features/data/dataSlice';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
  LinkAuthenticationElement
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

const PaymentMethodIcons = () => (
  <div className="payment-method-icons">
    {/* <img src="/images/payment-icons/visa.svg" alt="Visa" className="payment-method-icon" />
    <img src="/images/payment-icons/mastercard.svg" alt="Mastercard" className="payment-method-icon" />
    <img src="/images/payment-icons/amex.svg" alt="American Express" className="payment-method-icon" />
    <img src="/images/payment-icons/paypal.svg" alt="PayPal" className="payment-method-icon" />
    <img src="/images/payment-icons/apple-pay.svg" alt="Apple Pay" className="payment-method-icon" />
    <img src="/images/payment-icons/google-pay.svg" alt="Google Pay" className="payment-method-icon" /> */}
  </div>
);

const CheckoutContent = ({ paymentType }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stripeBlocked, setStripeBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const dispatch = useDispatch();
  const stripe = useStripe();
  const elements = useElements();
  
  // Get user email from Redux store
  const { user } = useSelector(state => state.data);
  const userEmail = user?.email || '';

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
          receipt_email: userEmail, // Use the email from Redux
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
        } else {
          // For non-redirect cases we may need to create a payment method separately
          const { paymentMethod } = await stripe.createPaymentMethod({
            elements
          });
          
          if (paymentMethod) {
            await dispatch(postPaymentMethod({ paymentMethodId: paymentMethod.id })).unwrap();
            setSelectedPaymentMethod(paymentMethod.type);
            setMessage("Payment method saved successfully!");
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

  return (
    <form onSubmit={handleSubmit} className="payment-form">
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
          <div className="form-header">
            <h2>Add Payment Method</h2>
            <p className="form-subtitle">Select your preferred payment method</p>
            <PaymentMethodIcons />
          </div>
          
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
          
          <div className="payment-security">
            <div className="security-icon">🔒</div>
            <p>Your payment information is secure and encrypted with bank-level security</p>
          </div>
          
          <div className="terms-agreement">
            By adding a payment method, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
          </div>
        </>
      )}
    </form>
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
      <Elements stripe={stripePromise} options={options}>
        <CheckoutContent paymentType={paymentType} />
      </Elements>
    </div>
  );
}

export default CheckoutForm;
