import React from 'react';
import './PreviousPaymentMethods.css';

function PreviousPaymentMethods({ methods = [], onDelete }) {
  return (
    <div className="previous-payment-methods">
      {Array.isArray(methods) && methods.length === 0 ? (
        <p>No previous payment methods found.</p>
      ) : (
        Array.isArray(methods) && methods.map((method) => (
          <div key={method.id} className="payment-method">
            <p>Card ending in {method.card.last4}</p>
            <p>Expires {method.card.exp_month}/{method.card.exp_year}</p>
            <button onClick={() => onDelete(method.id)} className="delete-button">Delete</button>
          </div>
        ))
      )}
    </div>
  );
}

export default PreviousPaymentMethods;
