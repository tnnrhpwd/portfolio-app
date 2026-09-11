import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  getPaymentMethods, 
  getMembershipPricing 
} from '../features/data/dataSlice';

/**
 * Custom hook to fetch payment methods and membership pricing
 */
export const useCheckoutData = (setStripeBlocked) => {
  const dispatch = useDispatch();
  const { paymentMethods, membershipPricing } = useSelector(state => state.data);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await dispatch(getPaymentMethods()).unwrap();
      } catch (error) {
        console.error('Failed to fetch payment methods:', error);
        // The thunk rejects with a STRING (rejectWithValue(message)), so
        // `error.message` is undefined and this never fired — the
        // "Stripe blocked" UI was unreachable. Normalize both shapes.
        const message = typeof error === 'string' ? error : (error?.message || '');
        if (message.includes('blocked') ||
            message.includes('Stripe') ||
            error?.status === 0) {
          setStripeBlocked(true);
        }
      }

      try {
        await dispatch(getMembershipPricing()).unwrap();
      } catch (error) {
        console.error('Failed to fetch membership pricing:', error);
      }
    };

    fetchData();
  }, [dispatch, setStripeBlocked]);

  return {
    paymentMethods,
    membershipPricing
  };
};
