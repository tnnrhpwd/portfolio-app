import { createAsyncThunk } from '@reduxjs/toolkit';
import dataService from '../dataService';

/**
 * User-specific Thunks
 * Handles user usage statistics, storage, subscriptions, and bug reports
 */

// Get user API usage statistics
export const getUserUsage = createAsyncThunk(
  'data/getUserUsage',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getUserUsage(token);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        (error.response && error.response.data && error.response.data.error) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Get user storage statistics
export const getUserStorage = createAsyncThunk(
  'data/getUserStorage',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getUserStorage(token);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        (error.response && error.response.data && error.response.data.error) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Get user subscription information
export const getUserSubscription = createAsyncThunk(
  'data/getUserSubscription',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getUserSubscription(token);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        (error.response && error.response.data && error.response.data.error) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Fetch user bug reports
export const getUserBugReports = createAsyncThunk(
  'data/getUserBugReports',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      const userId = thunkAPI.getState().data.user.id;
      return await dataService.getUserBugReports(token, userId);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        (error.response && error.response.data && error.response.data.error) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Close bug report with resolution
export const closeBugReport = createAsyncThunk(
  'data/closeBugReport',
  async ({ reportId, resolutionText }, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.closeBugReport(reportId, resolutionText, token);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        (error.response && error.response.data && error.response.data.error) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);
