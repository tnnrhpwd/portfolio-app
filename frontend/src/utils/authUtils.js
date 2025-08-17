// Authentication middleware for Redux async thunks

import { isTokenValid } from '../utils/tokenUtils.js';

/**
 * Enhanced async thunk wrapper that handles token validation and automatic logout
 */
export const createAuthAsyncThunk = (type, asyncFunction) => {
  return async (arg, thunkAPI) => {
    try {
      const state = thunkAPI.getState();
      const user = state.data?.user;
      const token = user?.token;
      
      // Check if user exists and has a valid token
      if (!user || !token) {
        console.error(`${type}: No user or token found`);
        // Clear invalid user from localStorage
        localStorage.removeItem('user');
        return thunkAPI.rejectWithValue('No authentication token found');
      }
      
      if (!isTokenValid(token)) {
        console.error(`${type}: Token expired or invalid`);
        // Clear expired user from localStorage
        localStorage.removeItem('user');
        return thunkAPI.rejectWithValue('Authentication token expired');
      }
      
      // Token is valid, proceed with the async function
      return await asyncFunction(arg, thunkAPI, token);
    } catch (error) {
      console.error(`${type} error:`, error);
      
      // Handle authentication errors
      if (error.response && error.response.status === 401) {
        console.log('401 error detected, clearing user from localStorage');
        localStorage.removeItem('user');
        const errorMessage = error.response.data?.dataMessage || 
                           error.response.data?.message || 
                           error.response.data?.error ||
                           'Authentication failed';
        return thunkAPI.rejectWithValue(errorMessage);
      }
      
      // Handle other errors
      const message = error.response?.data?.dataMessage || 
                     error.response?.data?.message || 
                     error.response?.data?.error ||
                     error.message || 
                     error.toString();
      return thunkAPI.rejectWithValue(message);
    }
  };
};

/**
 * Simple wrapper for non-authenticated async thunks
 */
export const createSimpleAsyncThunk = (type, asyncFunction) => {
  return async (arg, thunkAPI) => {
    try {
      return await asyncFunction(arg, thunkAPI);
    } catch (error) {
      console.error(`${type} error:`, error);
      const message = error.response?.data?.dataMessage || 
                     error.response?.data?.message || 
                     error.response?.data?.error ||
                     error.message || 
                     error.toString();
      return thunkAPI.rejectWithValue(message);
    }
  };
};
