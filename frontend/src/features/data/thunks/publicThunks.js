import { createAsyncThunk } from '@reduxjs/toolkit';
import dataService from '../dataService';

/**
 * Public Data Thunks
 * Handles public API endpoints that don't require authentication
 */

// Get membership pricing -- READ PUBLIC
export const getMembershipPricing = createAsyncThunk(
  'data/getMembershipPricing',
  async (_, thunkAPI) => {
    try {
      return await dataService.getMembershipPricing();
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

// Get LLM providers -- READ PUBLIC
export const getLLMProviders = createAsyncThunk(
  'data/getLLMProviders',
  async (_, thunkAPI) => {
    try {
      return await dataService.getLLMProviders();
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
