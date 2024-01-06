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
        state.operation = null;
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
        state.operation = null;
      })
      .addCase(deleteData.pending, (state) => {             // delete
        state.dataIsLoading = true
        state.operation = null;
      })
      .addCase(deleteData.fulfilled, (state, action) => {   // delete
        state.dataIsLoading = false
        state.dataIsSuccess = true
        state.data = state.data.filter(               // hides the deleted data from UI when you click delete. Otherwise, It wouldnt disapear until refresh
          (data) => data._id !== action.payload.id
        )
        state.operation = 'update';
      })
      .addCase(deleteData.rejected, (state, action) => {    // delete
        state.dataIsLoading = false
        state.dataIsError = true
        state.dataMessage = action.payload
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

export const { resetDataSlice } = dataSlice.actions
export default dataSlice.reducer
