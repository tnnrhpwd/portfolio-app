import React from 'react';

/**
 * PaymentMethodsList Component
 * Displays saved payment methods with selection
 */
const PaymentMethodsList = ({ paymentMethods, selectedMethod, onSelectMethod, onAddNew }) => {
  if (!paymentMethods || paymentMethods.length === 0) {
    return (
      <div className="no-payment-methods">
        <p>No payment methods found. Please add a payment method to continue.</p>
        <button className="add-method-button" onClick={onAddNew}>
          Add Payment Method
        </button>
      </div>
    );
  }

  return (
    <div className="payment-methods-container">
      <div className="payment-methods-header">
        <h3>Your Payment Methods</h3>
        <button className="add-method-link" onClick={onAddNew}>
          + Add New
        </button>
      </div>
      <div className="payment-methods-list">
        {paymentMethods.map((method) => (
          <div 
            key={method.id} 
            className={`payment-method-item ${selectedMethod === method.id ? 'selected' : ''}`}
            onClick={() => onSelectMethod(method.id)}
          >
            <div className="payment-method-icon">
              {method.type === 'card' ? '💳' : 
               method.type === 'link' ? '🔗' : 
               method.type === 'cashapp' ? '💵' : '💰'}
            </div>
            <div className="payment-method-details">
              <p className="payment-method-type">
                {method.type === 'card' ? `${method.card.brand.toUpperCase()} •••• ${method.card.last4}` : 
                 method.type === 'link' ? 'Link' :
                 method.type.replace('_', ' ')}
              </p>
              <p className="payment-method-expires">
                {method.type === 'card' ? `Expires ${method.card.exp_month}/${method.card.exp_year}` : ''}
              </p>
            </div>
            {method.default_for_currency && (
              <div className="default-badge">Default</div>
            )}
            {selectedMethod === method.id && (
              <div className="method-selected-indicator">✓</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PaymentMethodsList;
