import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { logout } from '../../../features/data/dataSlice';
import CheckoutForm from './CheckoutForm';
import Header from '../../../components/Header/Header';
import './Pay.css';
import Footer from '../../../components/Footer/Footer';

function Pay() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { dataIsError, dataMessage } = useSelector((state) => state.data);
  const queryParams = new URLSearchParams(location.search);
  const selectedPlan = queryParams.get('plan');

  // Handle JWT expiration
  useEffect(() => {
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login');
    }
  }, [dataIsError, dataMessage, dispatch, navigate]);

  return (
    <>
      <Header />
      <div className="planit-pay-bg">
        {/* Floating background elements for visual appeal */}
        <div className="floating-shapes">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>
        
        <div className="planit-pay-card">
          <section className="planit-pay-heading">
            <div className="planit-pay-heading-title">💳 Start Your Membership</div>
            <div className="planit-pay-heading-description">Choose a plan that works perfectly for you</div>
          </section>
          
          <section className="planit-pay-content">
            <CheckoutForm paymentType="subscription" initialPlan={selectedPlan} />
          </section>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Pay;