import { createAsyncThunk } from '@reduxjs/toolkit';
import dataService from '../dataService';

/**
 * Authentication Thunks
 * Handles user registration, login, and logout operations
 */

// Register user  -- Async functional object -- called from pages using dispatch
export const register = createAsyncThunk(
  'data/register',
  async (user, thunkAPI) => {
    try {
      return await dataService.register(user);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Login user
export const login = createAsyncThunk(
  'data/login', 
  async (user, thunkAPI) => {
    try {
      return await dataService.login(user);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Log out user  --- Async function that calls the authService logout function
export const logout = createAsyncThunk(
  'data/logout', 
  async () => {
    await dataService.logout();   
  }
);
