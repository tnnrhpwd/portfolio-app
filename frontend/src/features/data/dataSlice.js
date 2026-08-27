/**
 * Data Slice - Main Redux slice orchestrator
 * 
 * This file serves as the central orchestrator for all data operations.
 * It imports thunks from categorized files and defines the Redux slice with:
 * - Initial state
 * - Synchronous reducers
 * - Extra reducers for async thunk states
 */

import { createSlice } from '@reduxjs/toolkit';

// Import thunks from categorized files
import { register, login, logout } from './thunks/authThunks';
import { createData, createPublicData, getData, getPublicData, getAllData, updateData, deleteData, compressData } from './thunks/dataThunks';
import { getUserUsage, getUserStorage, getUserSubscription, getUserBugReports, closeBugReport, getEmailPreferences, updateEmailPreferences } from './thunks/userThunks';
import { getPaymentMethods, deletePaymentMethod, postPaymentMethod, createCustomer, subscribeCustomer } from './thunks/paymentThunks';
import { getMembershipPricing, getLLMProviders } from './thunks/publicThunks';

// Get user from localStorage with validation
let user = null;
try {
  const storedUser = localStorage.getItem('user');
  if (storedUser) {
    const parsedUser = JSON.parse(storedUser);
    // Only use stored user if it has valid user data (not error data)
    if (parsedUser && parsedUser._id && parsedUser.token && !parsedUser.dataMessage) {
      user = parsedUser;
      console.log('🔧 Valid user loaded from localStorage:', { id: user._id, nickname: user.nickname });
    } else {
      console.log('🔧 Invalid user data in localStorage, clearing:', parsedUser);
      localStorage.removeItem('user');
    }
  }
} catch (error) {
  console.error('🔧 Error parsing user from localStorage:', error);
  localStorage.removeItem('user');
}

console.log('🔧 Final initial user:', user ? { id: user._id, nickname: user.nickname } : null);

const initialState = {
  user: user ? user : null,
  data: { data: [] },
  userBugReports: [],
  dataIsError: false,
  dataIsSuccess: false,
  dataIsLoading: false,
  dataMessage: '',
  operation: null,
  membershipPricing: [],
  membershipPricingIsLoading: false,
  membershipPricingIsError: false,
  membershipPricingMessage: '',
  llmProviders: {},
  llmProvidersIsLoading: false,
  llmProvidersIsError: false,
  llmProvidersMessage: '',
  userUsage: null,
  userUsageIsLoading: false,
  userUsageIsError: false,
  userUsageMessage: '',
  userStorage: null,
  userStorageIsLoading: false,
  userStorageIsError: false,
  userStorageMessage: '',
  paymentMethods: [],
  paymentMethodsIsLoading: false,
  paymentMethodsIsError: false,
  paymentMethodsMessage: '',
  currentSubscription: null,
  emailPrefs: null,
  emailPrefsIsLoading: false,
  emailPrefsIsError: false,
  emailPrefsMessage: '',
};

// Create slice
export const dataSlice = createSlice({
  name: 'data',
  initialState,
  reducers: {
    resetDataSlice: (state) => initialState,
    resetDataSuccess: (state) => {
      state.dataIsSuccess = false;
      state.dataIsError = false;
      state.dataMessage = '';
      state.userUsageIsError = false;
      state.userUsageMessage = '';
      state.userStorageIsError = false;
      state.userStorageMessage = '';
    },
  },
  extraReducers: (builder) => {
    builder
      // Data CRUD operations
      .addCase(createData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(createData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.dataMessage = 'Data was successfully saved.';
        state.data.data.push(action.payload);
        state.operation = 'create';
      })
      .addCase(createData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(createPublicData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(createPublicData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.dataMessage = 'Data was successfully saved.';
        state.data.data.push(action.payload);
        state.operation = 'create';
      })
      .addCase(createPublicData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.operation = null;
      })
      .addCase(getData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(getData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data = action.payload;
        state.operation = 'get';
      })
      .addCase(getData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(getPublicData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(getPublicData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data = action.payload;
        state.operation = 'get';
      })
      .addCase(getPublicData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(getAllData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(getAllData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data = action.payload;
        state.operation = 'getAllData';
      })
      .addCase(getAllData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.operation = null;
      })
      .addCase(updateData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(updateData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data.data = state.data.data.map((dataItem) =>
          dataItem._id === action.payload._id ? action.payload : dataItem
        );
        state.operation = 'update';
      })
      .addCase(updateData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(deleteData.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(deleteData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data.data = state.data.data.filter((dataItem) => dataItem._id !== action.payload.id);
        state.operation = 'delete';
      })
      .addCase(deleteData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(compressData.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(compressData.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.data = action.payload;
        state.operation = 'compress';
      })
      .addCase(compressData.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.operation = null;
      })
      // Public data operations
      .addCase(getMembershipPricing.pending, (state) => {
        state.membershipPricingIsLoading = true;
        state.membershipPricingIsError = false;
        state.membershipPricingMessage = '';
      })
      .addCase(getMembershipPricing.fulfilled, (state, action) => {
        state.membershipPricingIsLoading = false;
        state.membershipPricing = action.payload;
      })
      .addCase(getMembershipPricing.rejected, (state, action) => {
        state.membershipPricingIsLoading = false;
        state.membershipPricingIsError = true;
        state.membershipPricingMessage = action.payload;
      })
      .addCase(getLLMProviders.pending, (state) => {
        state.llmProvidersIsLoading = true;
        state.llmProvidersIsError = false;
        state.llmProvidersMessage = '';
      })
      .addCase(getLLMProviders.fulfilled, (state, action) => {
        state.llmProvidersIsLoading = false;
        state.llmProviders = action.payload.providers || {};
      })
      .addCase(getLLMProviders.rejected, (state, action) => {
        state.llmProvidersIsLoading = false;
        state.llmProvidersIsError = true;
        state.llmProvidersMessage = action.payload;
      })
      // User operations
      .addCase(getUserBugReports.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(getUserBugReports.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.userBugReports = action.payload;
        state.operation = 'getUserBugReports';
      })
      .addCase(getUserBugReports.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.operation = null;
      })
      .addCase(getUserUsage.pending, (state) => {
        state.userUsageIsLoading = true;
        state.userUsageIsError = false;
        state.userUsageMessage = '';
      })
      .addCase(getUserUsage.fulfilled, (state, action) => {
        console.log('🔧 Redux getUserUsage.fulfilled - action.payload:', action.payload);
        console.log('🔧 Redux getUserUsage.fulfilled - payload type:', typeof action.payload);
        state.userUsageIsLoading = false;
        state.userUsageIsSuccess = true;
        state.userUsage = action.payload;
        console.log('🔧 Redux state.userUsage after update:', state.userUsage);
      })
      .addCase(getUserUsage.rejected, (state, action) => {
        state.userUsageIsLoading = false;
        state.userUsageIsError = true;
        state.userUsageMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
      })
      .addCase(getUserStorage.pending, (state) => {
        state.userStorageIsLoading = true;
        state.userStorageIsError = false;
        console.log('getUserStorage.pending');
      })
      .addCase(getUserStorage.fulfilled, (state, action) => {
        console.log('🔧 Redux getUserStorage.fulfilled - action.payload:', action.payload);
        console.log('🔧 Redux getUserStorage.fulfilled - payload type:', typeof action.payload);
        state.userStorageIsLoading = false;
        state.userStorageIsError = false;
        state.userStorageIsSuccess = true;
        state.userStorage = action.payload;
        console.log('🔧 Redux state.userStorage after update:', state.userStorage);
      })
      .addCase(getUserStorage.rejected, (state, action) => {
        state.userStorageIsLoading = false;
        state.userStorageIsError = true;
        state.userStorageMessage = action.payload;
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
      })
      // Email notification preferences
      .addCase(getEmailPreferences.pending, (state) => {
        state.emailPrefsIsLoading = true;
        state.emailPrefsIsError = false;
        state.emailPrefsMessage = '';
      })
      .addCase(getEmailPreferences.fulfilled, (state, action) => {
        state.emailPrefsIsLoading = false;
        state.emailPrefs = action.payload?.preferences || null;
      })
      .addCase(getEmailPreferences.rejected, (state, action) => {
        state.emailPrefsIsLoading = false;
        state.emailPrefsIsError = true;
        state.emailPrefsMessage = action.payload;
      })
      .addCase(updateEmailPreferences.fulfilled, (state, action) => {
        state.emailPrefs = action.payload?.preferences || state.emailPrefs;
      })
      // Auth operations
      .addCase(register.pending, (state) => {
        state.dataIsLoading = true;
        state.operation = null;
      })
      .addCase(register.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.user = action.payload;
        state.operation = 'register';
      })
      .addCase(register.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.user = null;
        state.operation = null;
      })
      .addCase(login.pending, (state) => {
        state.dataIsLoading = true;
        state.dataIsError = false;
        state.dataMessage = '';
        state.operation = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        console.log('🔧 Login successful for user:', action.payload?.nickname);
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.dataIsError = false;
        state.dataMessage = '';
        state.user = action.payload;
        state.operation = 'login';
      })
      .addCase(login.rejected, (state, action) => {
        console.log('🔧 Login failed:', action.payload);
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
        state.user = null;
        state.operation = null;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.operation = 'logout';
      })
      // Payment methods
      .addCase(getPaymentMethods.pending, (state) => {
        state.paymentMethodsIsLoading = true;
        state.paymentMethodsIsError = false;
        state.paymentMethodsMessage = '';
      })
      .addCase(getPaymentMethods.fulfilled, (state, action) => {
        state.paymentMethodsIsLoading = false;
        state.paymentMethods = action.payload?.paymentMethods || action.payload || [];
      })
      .addCase(getPaymentMethods.rejected, (state, action) => {
        state.paymentMethodsIsLoading = false;
        state.paymentMethodsIsError = true;
        state.paymentMethodsMessage = action.payload;
      })
      // Post payment method (attach)
      .addCase(postPaymentMethod.fulfilled, (state, action) => {
        // If the response contains a payment method, we'll refetch the list
        // The response may be a setup intent (no paymentMethodId) or an attach confirmation
      })
      // Delete payment method
      .addCase(deletePaymentMethod.fulfilled, (state, action) => {
        const deletedId = action.meta?.arg;
        if (deletedId) {
          state.paymentMethods = state.paymentMethods.filter(m => m.id !== deletedId);
        }
      })
      // Subscribe customer
      .addCase(subscribeCustomer.fulfilled, (state, action) => {
        state.currentSubscription = action.payload?.subscription || action.payload;
      });
  },
});

export const { resetDataSlice, resetDataSuccess } = dataSlice.actions;
export default dataSlice.reducer;

// Re-export all thunks for convenience
export {
  // Auth
  getEmailPreferences,
  updateEmailPreferences,
  register,
  login,
  logout,
  // Data CRUD
  createData,
  createPublicData,
  getData,
  getPublicData,
  getAllData,
  updateData,
  deleteData,
  compressData,
  // User operations
  getUserUsage,
  getUserStorage,
  getUserSubscription,
  getUserBugReports,
  closeBugReport,
  // Payment operations
  getPaymentMethods,
  deletePaymentMethod,
  postPaymentMethod,
  createCustomer,
  subscribeCustomer,
  // Public operations
  getMembershipPricing,
  getLLMProviders,
};
