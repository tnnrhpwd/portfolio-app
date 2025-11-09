import { createAsyncThunk } from '@reduxjs/toolkit';
import dataService from '../dataService';

/**
 * Payment & Subscription Thunks
 * Handles Stripe payment methods, customer creation, and subscriptions
 */

// Fetch payment methods
export const getPaymentMethods = createAsyncThunk(
  'data/getPaymentMethods',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getPaymentMethods(token);
    } catch (error) {
      const message =
        (error.response && error.response.data && error.response.data.error) ||
        error.message ||
        error.toString();
      return thunkAPI.rejectWithValue(message);
    }
  }
);

// Delete payment method
export const deletePaymentMethod = createAsyncThunk(
  'data/deletePaymentMethod',
  async (id, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.deletePaymentMethod(id, token);
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Post payment method
export const postPaymentMethod = createAsyncThunk(
  'data/postPaymentMethod',
  async (paymentData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.postPaymentMethod(paymentData, token);
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          (error.response.data.message || error.response.data.dataMessage)) ||
        error.message ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue({
        message: dataMessage,
        status: error.response?.status,
        data: error.response?.data
      });
    }
  }
);

// Create customer
export const createCustomer = createAsyncThunk(
  'data/createCustomer',
  async (customerData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.createCustomer(customerData, token);
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Subscribe customer to a membership plan
export const subscribeCustomer = createAsyncThunk(
  'data/subscribeCustomer',
  async (subscriptionData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.subscribeCustomer(subscriptionData, token);
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);
