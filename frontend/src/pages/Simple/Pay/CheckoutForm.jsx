import React, { useState } from 'react';
import './CheckoutForm.css';

function CheckoutForm({ paymentType }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState('');
  const [cvv, setCVV] = useState('');
  const [expiry, setExpiry] = useState('');

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

    // Handle payment processing based on paymentType
    // You can send payment details to your backend for further processing

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
          pattern="\d*"
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
      <button type="submit" className="pay-button" disabled={loading}>
        {loading ? 'Processing...' : 'Pay'}
      </button>
    </form>
  );
}

export default CheckoutForm;
