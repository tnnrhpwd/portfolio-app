import React, { useState } from 'react';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import './Pay.css';

function Pay() {
  const [paymentType, setPaymentType] = useState('one-time');

  return (
    <>
      <Header />
      <div className="pay-container">
        <h2 className='pay-container-header'>Pay Page</h2>
        <div className="pay-plan-container">
          <h3>Select Payment Type</h3>
          <div className="pay-plan-options">
            <button
              className={`pay-plan-option ${paymentType === 'one-time' ? 'selected' : ''}`}
              onClick={() => setPaymentType('one-time')}
            >
              One-Time
            </button>
            <button
              className={`pay-plan-option ${paymentType === 'recurring' ? 'selected' : ''}`}
              onClick={() => setPaymentType('recurring')}
            >
              Recurring
            </button>
          </div>
        </div>
        <div className="pay-details-container">
          <h3>Payment Details</h3>
          <form>
            <div className="form-group">
              <label htmlFor="cardNumber">Card Number</label>
              <input type="text" id="cardNumber" name="cardNumber" required />
            </div>
            <div className="form-group">
              <label htmlFor="expiryDate">Expiry Date</label>
              <input type="text" id="expiryDate" name="expiryDate" required />
            </div>
            <div className="form-group">
              <label htmlFor="cvv">CVV</label>
              <input type="text" id="cvv" name="cvv" required />
            </div>
            <div className="form-group">
              <label htmlFor="amount">Amount</label>
              <input type="text" id="amount" name="amount" required />
            </div>
            <button type="submit" className="pay-button">Pay Now</button>
          </form>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Pay;