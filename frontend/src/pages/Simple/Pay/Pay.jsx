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
            <div className="pay-details"></div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Pay;