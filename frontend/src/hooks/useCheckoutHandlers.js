import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { 
  postPaymentMethod, 
  subscribeCustomer 
} from '../features/data/dataSlice';
import { parseErrorMessage } from '../utils/checkoutUtils';

/**
 * Custom hook to manage checkout form handlers
 */
export const useCheckoutHandlers = ({
  stripe,
  elements,
  userEmail,
  selectedPlan,
  customPrice,
  selectedPaymentMethod,
  subscriptionStep,
  setMessage,
  setError,
  setLoading,
  setSubscriptionStep,
  setSelectedPaymentMethod,
  setCustomPrice,
  setCustomPriceError,
  setShowPaymentForm,
  checkoutContainerRef
}) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Handle payment method submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setError('Stripe has not loaded yet. Please try again.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage('');

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(parseErrorMessage(submitError.message));
        setLoading(false);
        return;
      }

      const { setupIntent, error: confirmError } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}/profile`,
        },
      });

      if (confirmError) {
        setError(parseErrorMessage(confirmError.message));
        setLoading(false);
        return;
      }

      if (setupIntent && setupIntent.payment_method) {
        const paymentMethodId = setupIntent.payment_method;
        await dispatch(postPaymentMethod({ paymentMethodId })).unwrap();
        setMessage('Payment method added successfully!');
        setShowPaymentForm(false);
        
        setTimeout(() => {
          window.scrollTo({
            top: checkoutContainerRef.current?.offsetTop || 0,
            behavior: 'smooth'
          });
        }, 100);
      }
    } catch (err) {
      console.error('Error:', err);
      setError(parseErrorMessage(err?.message || 'An unexpected error occurred'));
    } finally {
      setLoading(false);
    }
  }, [stripe, elements, dispatch, setError, setLoading, setMessage, setShowPaymentForm, checkoutContainerRef]);

  // Handle subscription completion
  const handleSubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage('');

    try {
      const priceInCents = selectedPlan === 'premium' || selectedPlan === 'flex'
        ? Math.round(parseFloat(customPrice) * 100)
        : 0;

      const subscriptionData = {
        planId: selectedPlan,
        paymentMethodId: selectedPaymentMethod,
        priceInCents
      };

      await dispatch(subscribeCustomer(subscriptionData)).unwrap();
      setMessage('Subscription updated successfully! Redirecting...');

      setTimeout(() => {
        navigate('/profile');
      }, 2000);
    } catch (err) {
      console.error('Subscription error:', err);
      setError(parseErrorMessage(err?.message || 'Failed to subscribe. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigate, selectedPlan, customPrice, selectedPaymentMethod, setError, setLoading, setMessage]);

  // Handle next step in subscription flow
  const handleNextStep = useCallback(async () => {
    if (subscriptionStep === 'plan-selection') {
      if (selectedPlan === 'free') {
        setLoading(true);
        setError(null);
        setMessage('');

        try {
          await dispatch(subscribeCustomer({ planId: 'free' })).unwrap();
          setMessage('Subscription updated successfully! Redirecting...');

          setTimeout(() => {
            navigate('/profile');
          }, 2000);
        } catch (err) {
          console.error('Subscription error:', err);
          setError(parseErrorMessage(err?.message || 'Failed to subscribe. Please try again.'));
        } finally {
          setLoading(false);
        }
      } else {
        setSubscriptionStep('payment-selection');
        setTimeout(() => {
          window.scrollTo({
            top: checkoutContainerRef.current?.offsetTop || 0,
            behavior: 'smooth'
          });
        }, 100);
      }
    } else if (subscriptionStep === 'payment-selection') {
      setSubscriptionStep('confirmation');
      setTimeout(() => {
        window.scrollTo({
          top: checkoutContainerRef.current?.offsetTop || 0,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [subscriptionStep, selectedPlan, dispatch, navigate, setLoading, setError, setMessage, setSubscriptionStep, checkoutContainerRef]);

  // Handle back step
  const handleBackStep = useCallback(() => {
    if (subscriptionStep === 'payment-selection') {
      setSubscriptionStep('plan-selection');
    } else if (subscriptionStep === 'confirmation') {
      setSubscriptionStep('payment-selection');
    }

    setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }, 100);
  }, [subscriptionStep, setSubscriptionStep]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  // Handle add payment method
  const handleAddPaymentMethod = useCallback(() => {
    setShowPaymentForm(true);
    setMessage('');
    setError(null);

    setTimeout(() => {
      window.scrollTo({
        top: checkoutContainerRef.current?.offsetTop || 0,
        behavior: 'smooth'
      });
    }, 100);
  }, [setShowPaymentForm, setMessage, setError, checkoutContainerRef]);

  // Handle custom price change
  const handleCustomPriceChange = useCallback((value) => {
    const numValue = parseFloat(value);
    setCustomPrice(value);

    const getMinimumPrice = () => {
      if (selectedPlan === 'premium') return 9999;
      if (selectedPlan === 'flex') return 10;
      return 10;
    };

    const minimumPrice = getMinimumPrice();

    if (!value || value === '') {
      setCustomPriceError('Please enter a price');
    } else if (isNaN(numValue)) {
      setCustomPriceError('Please enter a valid number');
    } else if (numValue < minimumPrice) {
      if (selectedPlan === 'premium') {
        setCustomPriceError('Choose a price >$850/month for CSimple');
      } else if (selectedPlan === 'flex') {
        setCustomPriceError('Choose a price >$10/month for Simple');
      } else {
        setCustomPriceError(`Minimum price is $${minimumPrice}/month`);
      }
    } else {
      setCustomPriceError('');
    }
  }, [selectedPlan, setCustomPrice, setCustomPriceError]);

  // Handle plan selection
  const handlePlanSelection = useCallback((planId) => {
    setSelectedPaymentMethod(null);
    if (planId === 'premium') {
      setCustomPrice(9999);
    } else if (planId === 'flex') {
      setCustomPrice(10);
    }
    setCustomPriceError('');
  }, [setSelectedPaymentMethod, setCustomPrice, setCustomPriceError]);

  return {
    handleSubmit,
    handleSubscribe,
    handleNextStep,
    handleBackStep,
    handleCancel,
    handleAddPaymentMethod,
    handleCustomPriceChange,
    handlePlanSelection
  };
};
