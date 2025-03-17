import React from 'react';
import { useLocation } from 'react-router-dom';
import CheckoutForm from './CheckoutForm';
import Header from '../../../components/Header/Header';
import './Pay.css';
import Footer from '../../../components/Footer/Footer';

function Pay() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const selectedPlan = queryParams.get('plan');

  return (<>
    <Header />
    <div className="pay-container">
      <div className="pay-header">
        <h1>Start Your Membership</h1>
        <p>Choose a plan that works for you</p>
      </div>
      <div className="pay-content">
        <CheckoutForm paymentType="subscription" initialPlan={selectedPlan} />
      </div>
    </div>
    <Footer />
  </>);
}

export default Pay;