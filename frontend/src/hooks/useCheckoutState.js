import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';

/**
 * Custom hook to manage checkout form state
 */
export const useCheckoutState = (initialPlan) => {
  const currentSubscription = useSelector(state => state.data?.currentSubscription ?? null);
  const [selectedPlan, setSelectedPlan] = useState(initialPlan || 'free');
  const [customPrice, setCustomPrice] = useState(9999);
  const [customPriceError, setCustomPriceError] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [subscriptionStep, setSubscriptionStep] = useState('plan-selection');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [stripeBlocked, setStripeBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Initialize selected plan on mount
  useEffect(() => {
    if (initialPlan) {
      setSelectedPlan(initialPlan);
    }
  }, [initialPlan]);

  // Set default custom price based on selected plan - no longer needed with fixed pricing
  useEffect(() => {
    // No custom pricing needed - plans use fixed Stripe prices
  }, [selectedPlan]);

  return {
    selectedPlan,
    setSelectedPlan,
    customPrice,
    setCustomPrice,
    customPriceError,
    setCustomPriceError,
    selectedPaymentMethod,
    setSelectedPaymentMethod,
    subscriptionStep,
    setSubscriptionStep,
    showPaymentForm,
    setShowPaymentForm,
    stripeBlocked,
    setStripeBlocked,
    message,
    setMessage,
    error,
    setError,
    loading,
    setLoading,
    currentSubscription
  };
};
