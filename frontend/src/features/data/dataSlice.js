// The slice represents data in the store -- unique name, inital state, and contains reducers( takes old state + actions => define logic to change the state)
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import dataService from './dataService';                          // import the async functional objects from dataService

// Get user from localStorage
const user = JSON.parse(localStorage.getItem('user'))

const initialState = {  // default values for each state change
  user: user ? user : null,
  data: [],
  dataIsError: false,
  dataIsSuccess: false,
  dataIsLoading: false,
  dataMessage: '',
  operation: null,
}

// Create new data  -- Async functional object -- called from pages using dispatch --CREATE
export const createData = createAsyncThunk(
  'data/create',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token         // get the user token   
      return await dataService.createData(dataData, token)      // pass user token into create data method to assure that each data has a user creator
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString()
      return thunkAPI.rejectWithValue(dataMessage)  // check for any errors associated with async createdata function object imported from dataSlice
    }
  }
)

// Get user datas -- READ
export const getData = createAsyncThunk(
  'data/get',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token
      return await dataService.getData(dataData, token)
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString()
      return thunkAPI.rejectWithValue(dataMessage)
    }
  }
)
// Get public datas -- READ
export const getPublicData = createAsyncThunk(
  'data/getPublic',
  async (dataData, thunkAPI) => {
    try {
      return await dataService.getPublicData(dataData);
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

// Compress data
export const compressData = createAsyncThunk(
  'data/compress',
  async (data, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.compressData(data, token);
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

// Get all data
export const getAllData = createAsyncThunk(
  'data/getAllData',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token
      return await dataService.getAllData(token)
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

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

// New action to get user subscription
export const getUserSubscription = createAsyncThunk(
  'data/getUserSubscription',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getUserSubscription(token);
    } catch (error) {
      const message = (error.response && error.response.data && error.response.data.message) || 
                     error.message || error.toString();
      return thunkAPI.rejectWithValue(message);
    }
  }
);

// Update user data -- UPDATE
export const updateData = createAsyncThunk(
  'data/update',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token
      return await dataService.updateData(dataData, token)
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString()
      return thunkAPI.rejectWithValue(dataMessage)
    }
  }
)

// Delete user data -- DELETE
export const deleteData = createAsyncThunk(
  'data/delete',
  async (id, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token
      return await dataService.deleteData(id, token)
    } catch (error) {
      const dataMessage =
        (error.response &&
          error.response.data &&
          error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString()
      return thunkAPI.rejectWithValue(dataMessage)
    }
  }
)

// Register user  -- Async functional object -- called from pages using dispatch
export const register = createAsyncThunk(
  'data/register',
  async (user, thunkAPI) => {
    try {
      return await dataService.register(user)
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString()
      return thunkAPI.rejectWithValue(dataMessage) // check for any errors associated with async register function object imported from authSlice
    }
  }
)

// Login user
export const login = createAsyncThunk(
  'data/login', 
  async (user, thunkAPI) => {
  try {
    return await dataService.login(user)
  } catch (error) {
    const dataMessage =
      (error.response && error.response.data && error.response.data.dataMessage) ||
      error.dataMessage ||
      error.toString()
    return thunkAPI.rejectWithValue(dataMessage) // check for any errors associated with async login function object imported from authSlice
  }
})

// log out user  --- Async function that calls the authService logout function( removes user item from local storage)
export const logout = createAsyncThunk(
  'data/logout', 
  async () => {
  await dataService.logout()   
})

// slice exported inside an object
export const dataSlice = createSlice({
  name: 'data',
  initialState,
  reducers: { // not async  --  async functions go inside thunkfunctions   --- Without Reducers, we'd need to reload the whole page on changes.
    resetDataSlice: (state) => initialState,  // function sets all data values back to default.
    resetDataSuccess: (state) => {
      state.dataIsSuccess = false;
      state.dataIsError = false;
      state.dataMessage = '';
    },
  },
  extraReducers: (builder) => {// all possible states associated with asyncthunk get,create,delete datas functional objects. 
    builder
      .addCase(createData.pending, (state) => {             // create
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(createData.fulfilled, (state, action) => {   // create
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.dataMessage = 'Data was successfully saved.'
        state.data.data.push(action.payload)
        state.operation = 'create';
      })
      .addCase(createData.rejected, (state, action) => {    // create
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(getData.pending, (state) => {               // get
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(getData.fulfilled, (state, action) => {     // get
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.data = action.payload
        state.operation = 'get';
      })
      .addCase(getData.rejected, (state, action) => {      // get
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(getPublicData.pending, (state) => {               // get
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(getPublicData.fulfilled, (state, action) => {     // get
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.data = action.payload
        state.operation = 'get';
      })
      .addCase(getPublicData.rejected, (state, action) => {      // get
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
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
      .addCase(getAllData.pending, (state) => {
        state.dataIsLoading = true
        state.operation = null
      })
      .addCase(getAllData.fulfilled, (state, action) => {
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.data = action.payload
        state.operation = 'getAllData'
      })
      .addCase(getAllData.rejected, (state, action) => {
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
        state.operation = null
      })
      .addCase(getPaymentMethods.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(getPaymentMethods.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.paymentMethods = action.payload;
      })
      .addCase(getPaymentMethods.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
      })
      .addCase(deletePaymentMethod.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(deletePaymentMethod.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.paymentMethods = state.paymentMethods.filter(method => method.id !== action.payload.id);
      })
      .addCase(deletePaymentMethod.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
      })
      .addCase(postPaymentMethod.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(postPaymentMethod.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        // state.paymentMethods.push(action.payload);
      })
      .addCase(postPaymentMethod.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
      })
      .addCase(subscribeCustomer.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(subscribeCustomer.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        state.subscription = action.payload;
      })
      .addCase(subscribeCustomer.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload;
      })
      .addCase(getUserSubscription.pending, (state) => {
        state.dataIsLoading = true;
      })
      .addCase(getUserSubscription.fulfilled, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsSuccess = true;
        // Update user with subscription info
        if (state.user) {
          state.user.subscriptionPlan = action.payload.subscriptionPlan;
          state.user.subscriptionDetails = action.payload.subscriptionDetails;
        }
      })
      .addCase(getUserSubscription.rejected, (state, action) => {
        state.dataIsLoading = false;
        state.dataIsError = true;
        state.dataMessage = action.payload || 'Failed to fetch subscription';
      })
      .addCase(updateData.pending, (state) => {             // update
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(updateData.fulfilled, (state, action) => {   // update
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.data = action.payload        
        state.dataMessage = action.payload.text
        state.operation = 'update';
      })
      .addCase(updateData.rejected, (state, action) => {    // update
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(deleteData.pending, (state) => {             // delete
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(deleteData.fulfilled, (state, action) => {   // delete
        state.dataIsLoading = false
        state.dataIsSuccess = true
        if (Array.isArray(state.data.data)) {
          state.data.data = state.data.data.filter(               // hides the deleted data from UI when you click delete. Otherwise, It wouldnt disapear until refresh
            (data) => data._id !== action.payload.id
          );
        } else {
          // state.data = [];
        }
        state.operation = 'update';
      })
      .addCase(deleteData.rejected, (state, action) => {    // delete
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
        if (action.payload === 'Not authorized, token expired') {
          state.user = null;
        }
        state.operation = null;
      })
      .addCase(register.pending, (state) => {
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(register.fulfilled, (state, action) => {
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.user = action.payload
        state.operation = 'register';
      })
      .addCase(register.rejected, (state, action) => {
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload        // deals with thunkAPI.rejectWithValue(dataMessage)
        state.user = null
        state.operation = null;
      })
      .addCase(login.pending, (state) => {
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.user = action.payload
        state.operation = 'login';
      })
      .addCase(login.rejected, (state, action) => {
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload          // deals with thunkAPI.rejectWithValue(dataMessage)
        state.user = null
        state.operation = null;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null
        state.operation = 'logout';
      })
  },
})

export const { resetDataSlice, resetDataSuccess } = dataSlice.actions
export default dataSlice.reducer
