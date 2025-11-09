import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { getData, getPublicData, resetDataSlice } from '../features/data/dataSlice';

/**
 * Custom hook to fetch data based on ID and user authentication
 * @param {string} id - The data ID to fetch
 * @param {Object} user - The current user object
 * @param {Object} dataState - Redux data state object
 * @param {Function} setChosenData - Function to set the chosen data
 * @returns {Object} Loading state
 */
export const useInfoDataFetch = (id, user, dataState, setChosenData) => {
  const dispatch = useDispatch();
  const loadingStartTime = useRef(null);
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

  const { data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = dataState;

  // Debug logging on component mount and ID changes
  useEffect(() => {
    console.log('=== DEBUG: InfoData Component Mounted/Updated ===');
    console.log('ID from params:', id);
    console.log('ID type:', typeof id);
    console.log('ID length:', id ? id.length : 'N/A');
    console.log('User:', user ? 'logged in' : 'not logged in');
    console.log('Data state:', { data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage });
  }, [id, user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage]);

  // Handle state changes
  useEffect(() => {
    if (dataIsSuccess) {
      // toast.success('Successfully received data.', { autoClose: toastDuration });
    }
    if (dataIsError) {
      toast.error(dataMessage, { autoClose: 8000 });
      console.error(dataMessage);
    }
  }, [dataIsError, dataIsSuccess, dataMessage, toastDuration]);

  // Loading timeout warning
  useEffect(() => {
    if (dataIsLoading) {
      loadingStartTime.current = Date.now();
    } else if (loadingStartTime.current && Date.now() - loadingStartTime.current > 5000) {
      toast.info('The server service takes about a minute to spin up. Please try again in a moment.', {
        autoClose: 3000,
      });
    }
  }, [dataIsLoading]);

  // Fetch data from API
  useEffect(() => {  
    let isCancelled = false;
    
    const fetchData = async () => {
      console.log('=== DEBUG: Starting data fetch ===');
      console.log(`Attempting to fetch data for ID: ${id.length > 50 ? id.substring(0, 50) + "..." : id}`);
      console.log(`User status: ${user ? 'logged in' : 'not logged in'}`);
      console.log('Full ID:', id);
      
      try {
        let result;
        if (!user) {
          console.log('Fetching public data...');
          result = await dispatch(getPublicData({ data: { text: id } })).unwrap();
        } else {
          console.log('Fetching private data...');
          try {
            // First try private data access
            result = await dispatch(getData({ data: { text: id } })).unwrap();
          } catch (privateError) {
            console.log('Private data access failed, trying public data as fallback...');
            // If private access fails, try public data as fallback
            try {
              result = await dispatch(getPublicData({ data: { text: id } })).unwrap();
              console.log('✅ Public fallback successful');
            } catch (publicError) {
              // Both failed, rethrow the original private error
              throw privateError;
            }
          }
        }
        console.log('✅ Fetch completed successfully');
        console.log('Result type:', typeof result);
        console.log('Result:', result);
      } catch (error) {
        if (!isCancelled) {
          const errorMsg = error.message || 'Unknown error';
          const truncatedError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + "..." : errorMsg;
          console.error('❌ Error fetching data:', truncatedError);
          console.error('Full error object:', error);
          toast.error(`Failed to fetch data: ${truncatedError}`);
        }
      }
    };

    if (id) {
      fetchData();
    }

    return () => {
      isCancelled = true;
      dispatch(resetDataSlice());
    };
  }, [dispatch, id, user]);

  return {
    dataIsLoading,
    dataIsSuccess,
    dataIsError,
    dataMessage,
  };
};
