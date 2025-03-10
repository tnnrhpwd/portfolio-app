import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { postPaymentMethod } from '../../../features/data/dataSlice';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import './CheckoutForm.css';

// Initialize Stripe.js with your publishable key (this is safe to use client-side)
const stripePromise = loadStripe('pk_live_51Qi5RQDe3PzRS0w2C6RELysPJGooJ2QrdAOfGJdOWS6SGAuR2TH74ZKvq4Pte6sjm9ESZdftoFHZNGdIM7aV5Fu500Y8DkVnnM');

const CheckoutContent = ({ paymentType }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const dispatch = useDispatch();
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!stripe || !elements) {
      setError("Stripe hasn't loaded yet. Please try again.");
      setLoading(false);
      return;
    }

    try {
      // Create a payment method using the card element
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card: elements.getElement(CardElement)
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Send only the payment method ID to your server
      const paymentMethodId = result.paymentMethod.id;
      await dispatch(postPaymentMethod({ paymentMethodId })).unwrap();
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    }

    setLoading(false);
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
      },
      invalid: {
        color: '#9e2146',
      },
    },
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <CardElement options={cardElementOptions} />
      </div>
      {error && <div className="pay-error">{error}</div>}
      <button type="submit" id="add-card-button" disabled={loading || !stripe}>
        {loading ? 'Processing...' : 'Add Card'}
      </button>
    </form>
  );
};

function CheckoutForm({ paymentType }) {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutContent paymentType={paymentType} />
    </Elements>
  );
}

export default CheckoutForm;
