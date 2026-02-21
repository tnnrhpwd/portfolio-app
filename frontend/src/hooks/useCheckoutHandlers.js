import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { 
  postPaymentMethod, 
  subscribeCustomer,
  getPaymentMethods 
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
        const parsed1 = parseErrorMessage(submitError.message);
        setError(typeof parsed1 === 'object' ? (parsed1.message || String(parsed1)) : parsed1);
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
        const parsed2 = parseErrorMessage(confirmError.message);
        setError(typeof parsed2 === 'object' ? (parsed2.message || String(parsed2)) : parsed2);
        setLoading(false);
        return;
      }

      if (setupIntent && setupIntent.payment_method) {
        const paymentMethodId = setupIntent.payment_method;
        await dispatch(postPaymentMethod({ paymentMethodId })).unwrap();
        
        // Refetch payment methods so the list is up to date
        await dispatch(getPaymentMethods()).unwrap();
        
        // Auto-select the newly added payment method
        setSelectedPaymentMethod(paymentMethodId);
        
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
      const parsed3 = parseErrorMessage(err?.message || 'An unexpected error occurred');
      setError(typeof parsed3 === 'object' ? (parsed3.message || String(parsed3)) : parsed3);
    } finally {
      setLoading(false);
    }
  }, [stripe, elements, dispatch, setError, setLoading, setMessage, setShowPaymentForm, setSelectedPaymentMethod, checkoutContainerRef]);

  // Handle subscription completion
  const handleSubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage('');

    try {
      const subscriptionData = {
        planId: selectedPlan,
        paymentMethodId: selectedPaymentMethod,
      };

      await dispatch(subscribeCustomer(subscriptionData)).unwrap();
      setMessage('Subscription updated successfully! Redirecting...');

      setTimeout(() => {
        navigate('/profile');
      }, 2000);
    } catch (err) {
      console.error('Subscription error:', err);
      const parsed = parseErrorMessage(err?.message || 'Failed to subscribe. Please try again.');
      setError(typeof parsed === 'object' ? (parsed.message || String(parsed)) : parsed);
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigate, selectedPlan, selectedPaymentMethod, setError, setLoading, setMessage]);

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
          const parsedFree = parseErrorMessage(err?.message || 'Failed to subscribe. Please try again.');
          setError(typeof parsedFree === 'object' ? (parsedFree.message || String(parsedFree)) : parsedFree);
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

  // Handle custom price change - no longer needed with fixed pricing
  const handleCustomPriceChange = useCallback(() => {}, []);

  // Handle plan selection
  const handlePlanSelection = useCallback((planId) => {
    setSelectedPaymentMethod(null);
  }, [setSelectedPaymentMethod]);

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
