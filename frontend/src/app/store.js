// global store object - registers all reducers defined elsewhere
// reducer - takes in old state + action => returns new state
import { configureStore } from '@reduxjs/toolkit';
import dataReducer from '../features/data/dataSlice'

export const store = configureStore({
  reducer: {
    data: dataReducer,
  },
});
