import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import CheckoutForm from './CheckoutForm.jsx';
import './Pay.css';

// Load Stripe outside of a component’s render to avoid recreating the Stripe object on every render.
const stripePromise = loadStripe('your-publishable-key-here');

function Pay() {
  const [paymentType, setPaymentType] = useState('Flex');

  return (
    <>
      <Header />
      <div className="pay-container">
        <h2 className='pay-container-header'>Pay Page</h2>
        <div className="pay-plan-container">
          <h3>Select Payment Type</h3>
          <div className="pay-plan-descriptions">
              <p className="pay-plan-description">
                The Flex payment plan charges based on usage with a monthly max of $10.
              </p>
              <p className="pay-plan-description">
                The Premium payment plan charges a lower usage rate with a customizable max {'>'} $10.
              </p>
          </div>
          <div className="pay-plan-options">
            <button
              className={`pay-plan-option ${paymentType === 'Flex' ? 'selected' : ''}`}
              onClick={() => setPaymentType('Flex')}
            >
              Flex
            </button>
            <button
              className={`pay-plan-option ${paymentType === 'Premium' ? 'selected' : ''}`}
              onClick={() => setPaymentType('Premium')}
            >
              Premium
            </button>
          </div>
        </div>
        <div className="pay-details-container">
          <h3>Payment Details</h3>
          <Elements stripe={stripePromise}>
            <CheckoutForm paymentType={paymentType} />
          </Elements>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Pay;