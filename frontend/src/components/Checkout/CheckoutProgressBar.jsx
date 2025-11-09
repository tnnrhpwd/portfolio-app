import React from 'react';

/**
 * CheckoutProgressBar Component
 * Shows the current step in the checkout process
 */
const CheckoutProgressBar = ({ currentStep }) => {
  const steps = [
    { id: 'plan-selection', label: 'Select Plan' },
    { id: 'payment-selection', label: 'Payment Method' },
    { id: 'confirmation', label: 'Confirm' }
  ];

  return (
    <div className="checkout-progress-container">
      <div className="checkout-progress-bar">
        {steps.map((step, index) => {
          // Determine if the step is active, completed, or upcoming
          const isActive = step.id === currentStep;
          const isCompleted = steps.findIndex(s => s.id === currentStep) > index;
          const stepClass = isActive ? 'active' : isCompleted ? 'completed' : 'upcoming';
          
          return (
            <React.Fragment key={step.id}>
              {/* Add connector lines between steps except for the first step */}
              {index > 0 && (
                <div className={`progress-connector ${isCompleted ? 'completed' : ''}`} />
              )}
              
              {/* The step circle */}
              <div className={`progress-step ${stepClass}`}>
                <div className="progress-step-circle">
                  {isCompleted ? '✓' : index + 1}
                </div>
                <div className="progress-step-label">{step.label}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default CheckoutProgressBar;
