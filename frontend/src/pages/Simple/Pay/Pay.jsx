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
  const { user, dataIsError, dataMessage } = useSelector((state) => state.data);
  const queryParams = new URLSearchParams(location.search);
  const selectedPlan = queryParams.get('plan');

  // Redirect to login if not authenticated, preserving the intended destination
  useEffect(() => {
    if (!user) {
      navigate('/login', { state: { redirectTo: `/pay${location.search}` } });
    }
  }, [user, navigate, location.search]);

  // Handle JWT expiration
  useEffect(() => {
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login', { state: { redirectTo: `/pay${location.search}`, sessionExpired: true } });
    }
  }, [dataIsError, dataMessage, dispatch, navigate]);

  if (!user) return null;

  return (
    <>
      <Header />
      <div className="planit-pay-bg">
        <div className="planit-pay-floating" aria-hidden="true">
          <div className="planit-pay-circle planit-pay-circle-1"></div>
          <div className="planit-pay-circle planit-pay-circle-2"></div>
          <div className="planit-pay-circle planit-pay-circle-3"></div>
        </div>
        <div className="planit-pay-card">
          <section className="planit-pay-heading">
            <p className="planit-pay-eyebrow">Membership</p>
            <h1 className="planit-pay-heading-title">Choose your plan</h1>
            <p className="planit-pay-heading-description">
              Pick a plan, add a payment method, and confirm — it takes under a minute.
              You can upgrade or cancel anytime.
            </p>
            <ul className="planit-pay-trust" aria-label="Checkout assurances">
              <li>🔒 Secured by Stripe</li>
              <li>🛡️ No hidden fees</li>
              <li>↩️ Cancel anytime</li>
              <li>💳 Cards &amp; wallets accepted</li>
            </ul>
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