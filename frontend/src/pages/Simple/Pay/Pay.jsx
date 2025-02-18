import React, { useState, useEffect } from 'react';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import CheckoutForm from './CheckoutForm.jsx';
import PreviousPaymentMethods from './PreviousPaymentMethods.jsx';
import { useDispatch, useSelector } from 'react-redux';
import { getPaymentMethods, deletePaymentMethod } from '../../../features/data/dataSlice';
import './Pay.css';

function Pay() {
  const dispatch = useDispatch();
  const { paymentMethods } = useSelector((state) => state.data);
  const [paymentType, setPaymentType] = useState('Flex');

  useEffect(() => {
    dispatch(getPaymentMethods());
  }, [dispatch]);

  const handleDeletePaymentMethod = (id) => {
    dispatch(deletePaymentMethod(id));
  };

  return (
    <>
      <Header />
      <div className="pay-container">
        <h2 className='pay-container-header'>Pay Page</h2>
        <div className="pay-plan-container">
          <h3>Select Payment Type</h3>
          <div className="pay-plan-descriptions">
              <p className="pay-plan-description">
                The Flex payment plan charges based on usage with a monthly max of $10.
              </p>
              <p className="pay-plan-description">
                The Premium payment plan charges a lower usage rate with a customizable max {'>'} $10.
              </p>
          </div>
          <div className="pay-plan-options">
            <button
              className={`pay-plan-option ${paymentType === 'Flex' ? 'selected' : ''}`}
              onClick={() => setPaymentType('Flex')}
            >
              Flex
            </button>
            <button
              className={`pay-plan-option ${paymentType === 'Premium' ? 'selected' : ''}`}
              onClick={() => setPaymentType('Premium')}
            >
              Premium
            </button>
          </div>
        </div>
        <div className="previous-payment-methods-container">
          <h3>Previous Payment Methods</h3>
          <PreviousPaymentMethods methods={paymentMethods} onDelete={handleDeletePaymentMethod} />
        </div>
        <div className="pay-details-container">
          <h3>Payment Details</h3>
          <CheckoutForm paymentType={paymentType} />
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Pay;