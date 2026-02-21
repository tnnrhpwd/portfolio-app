import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { resetDataSlice } from '../../../features/data/dataSlice';
import './PaymentSuccess.css';

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  useEffect(() => {
    // Clean up any payment state if needed
    const timer = setTimeout(() => {
      // Reset relevant payment state
      dispatch(resetDataSlice());
      // Redirect after a delay
      navigate('/profile');
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [dispatch, navigate]);
  
  return (
    <div className="payment-success-page">
      <div className="success-icon">✓</div>
      <h1>Payment Method Added Successfully!</h1>
      <p>Your payment details have been securely saved.</p>
      <p>You'll be redirected to your profile in a few seconds...</p>
      <button 
        className="continue-button"
        onClick={() => navigate('/profile')}
      >
        Continue to Profile
      </button>
    </div>
  );
};

export default PaymentSuccess;
