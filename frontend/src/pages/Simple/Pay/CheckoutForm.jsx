import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { postPaymentMethod } from '../../../features/data/dataSlice';
import './CheckoutForm.css';

function CheckoutForm({ paymentType }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState('');
  const [cvv, setCVV] = useState('');
  const [expiry, setExpiry] = useState('');
  const dispatch = useDispatch();

  const handleCardInput = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 16);
    const formattedValue = value.replace(/(.{4})/g, '$1 ').trim();
    setCard(formattedValue);
  };

  const handleExpiryInput = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
    const formattedValue = value.replace(/(\d{2})(\d{2})/, '$1/$2');
    setExpiry(formattedValue);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      // Handle missing / invalid card details
      if (card.length !== 19 || expiry.length !== 5 || cvv.length !== 3) {
        throw new Error('Invalid card details');
      }
      // Handle payment processing based on paymentType
      if (paymentType === 'Flex' || paymentType === 'Premium') {
        // Process credit card payment
        const paymentData = { card, cvv, expiry };
        await dispatch(postPaymentMethod(paymentData)).unwrap();
      } else {
        throw new Error('Unsupported payment type');
      }
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <input
          type="text"
          id="form-group-card"
          value={card}
          placeholder='Card Number'
          onChange={handleCardInput}
          required
          pattern="\d{4} \d{4} \d{4} \d{4}" // Updated pattern to match the requested format
          maxLength="19" // 16 digits + 3 spaces
        />
        <input
          type="text"
          id="form-group-expiry"
          placeholder='MM/YY'
          value={expiry}
          onChange={handleExpiryInput}
          required
          pattern="\d{2}/\d{2}"
          maxLength="5"
        />
        <input
          type="text"
          id="form-group-cvv"
          placeholder='CVV'
          value={cvv}
          onChange={(e) => setCVV(e.target.value)}
          required
          pattern="\d*"
          maxLength="3"
        />
      </div>
      {error && <div className="pay-error">{error}</div>}
      <button type="submit" id="add-card-button" disabled={loading}>
        {loading ? 'Processing...' : 'Add Card'}
      </button>
    </form>
  );
}

export default CheckoutForm;
