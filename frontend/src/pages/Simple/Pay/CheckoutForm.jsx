import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import './CheckoutForm.css';

function CheckoutForm({ paymentType }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);

    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // Send paymentMethod.id to your server (not implemented here)
      // const response = await fetch('/pay', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({ paymentMethodId: paymentMethod.id, paymentType }),
      // });

      // Handle server response (not implemented here)
      // const serverResponse = await response.json();

      setLoading(false);
      setError(null);
      alert('Payment successful!');
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="card-element">Credit or Debit Card</label>
        <CardElement id="card-element" className="card-element" />
      </div>
      {error && <div className="pay-error">{error}</div>}
      <button type="submit" className="pay-button" disabled={!stripe || loading}>
        {loading ? 'Processing...' : 'Pay'}
      </button>
    </form>
  );
}

export default CheckoutForm;
