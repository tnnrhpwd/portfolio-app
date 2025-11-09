import { createAsyncThunk } from '@reduxjs/toolkit';
import dataService from '../dataService';

/**
 * Data CRUD Thunks
 * Handles create, read, update, delete operations for generic data
 */

// Create new data  -- Async functional object -- called from pages using dispatch --CREATE
export const createData = createAsyncThunk(
  'data/create',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.createData(dataData, token);
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

// Get user datas -- READ
export const getData = createAsyncThunk(
  'data/get',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getData(dataData, token);
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

// Get all data
export const getAllData = createAsyncThunk(
  'data/getAllData',
  async (_, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.getAllData(token);
    } catch (error) {
      const dataMessage =
        (error.response && error.response.data && error.response.data.dataMessage) ||
        error.dataMessage ||
        error.toString();
      return thunkAPI.rejectWithValue(dataMessage);
    }
  }
);

// Update data -- UPDATE
export const updateData = createAsyncThunk(
  'data/update',
  async (dataData, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.updateData(dataData, token);
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

// Delete user data -- DELETE
export const deleteData = createAsyncThunk(
  'data/delete',
  async (id, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.deleteData(id, token);
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
  async ({ data, options }, thunkAPI) => {
    try {
      const token = thunkAPI.getState().data.user.token;
      return await dataService.compressData(data, token, options);
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
