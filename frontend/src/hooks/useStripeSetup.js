import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { 
  postPaymentMethod, 
  createCustomer, 
  logout 
} from '../features/data/dataSlice';
import { needsCustomerCreation } from '../utils/checkoutUtils';

/**
 * Custom hook to manage Stripe setup and customer creation
 */
export const useStripeSetup = () => {
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState(null);
  const [isStripeError, setIsStripeError] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const { user, dataIsError, dataMessage } = useSelector(state => state.data);
  const userEmail = user?.email || '';

  // Handle JWT expiration
  useEffect(() => {
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login');
    }
  }, [dataIsError, dataMessage, dispatch, navigate]);

  // Initialize Stripe setup intent (with sessionStorage cache to avoid rate limits)
  useEffect(() => {
    if (!user) return; // Don't attempt Stripe setup without a logged-in user

    const CACHE_KEY = 'stripe_setup_intent';
    const CACHE_TTL = 25 * 60 * 1000; // 25 minutes (setup intents last ~30 min)

    const getCachedSecret = () => {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const { secret, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL && secret?.includes('_secret_')) {
            return secret;
          }
          sessionStorage.removeItem(CACHE_KEY);
        }
      } catch { /* ignore */ }
      return null;
    };

    const cacheSecret = (secret) => {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ secret, timestamp: Date.now() }));
      } catch { /* ignore */ }
    };

    const cachedSecret = getCachedSecret();
    if (cachedSecret) {
      console.log('Using cached setup intent');
      setClientSecret(cachedSecret);
      return;
    }

    const getSetupIntent = async () => {
      try {
        const setupIntent = await dispatch(postPaymentMethod({})).unwrap();
        
        if (setupIntent && setupIntent.client_secret) {
          console.log('Setup intent created successfully');
          setClientSecret(setupIntent.client_secret);
          cacheSecret(setupIntent.client_secret);
        } else {
          console.error('Invalid setup intent response:', setupIntent);
          setError('Failed to initialize payment setup. Please try again.');
        }
      } catch (error) {
        console.error('Failed to get setup intent:', error);
        
        let errorMessage = '';
        let errorStatus = null;
        
        if (error?.message) {
          errorMessage = error.message;
          errorStatus = error.status;
        } else if (error?.response?.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          } else if (error.response.data.message) {
            errorMessage = error.response.data.message;
          } else if (error.response.data.error) {
            errorMessage = error.response.data.error;
          } else {
            errorMessage = JSON.stringify(error.response.data);
          }
          errorStatus = error.response.status;
        } else {
          errorMessage = error?.toString() || '';
        }

        // Rate limited — show a friendly wait message instead of retrying
        if (errorStatus === 429 || errorMessage.includes('429') || errorMessage.toLowerCase().includes('too many')) {
          setError('You\'ve made too many requests. Please wait a few minutes and refresh the page.');
          return;
        }
        
        if (needsCustomerCreation(errorMessage, errorStatus)) {
          try {
            console.log('Creating customer first...');
            const customerData = {
              email: userEmail,
              name: user?.nickname || userEmail.split('@')[0]
            };
            await dispatch(createCustomer(customerData)).unwrap();
            console.log('Customer created successfully, retrying setup intent...');
            
            const retrySetupIntent = await dispatch(postPaymentMethod({})).unwrap();
            if (retrySetupIntent && retrySetupIntent.client_secret) {
              setClientSecret(retrySetupIntent.client_secret);
            } else {
              setError('Failed to initialize payment after customer creation.');
            }
          } catch (createError) {
            console.error('Failed to create customer:', createError);
            setError('Failed to set up payment system. Please contact support.');
          }
        } else {
          setError(error?.message || 'Failed to initialize payment setup. Please try again.');
        }
      }
    };
    
    getSetupIntent();
  }, [dispatch, user, userEmail]);

  return {
    clientSecret,
    error,
    isStripeError,
    setIsStripeError,
    userEmail,
    user
  };
};
