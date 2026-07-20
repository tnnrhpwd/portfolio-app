/**
 * DeepStorage API Service
 *
 * Talks to the backend's cached Minecraft Bedrock stackable item catalog.
 * The catalog is only (re)generated when an admin explicitly presses the
 * "Regenerate" button — everyday page loads just read the cached result.
 */

import axios from 'axios';
import { getApiBase } from '../config/api';

const API_URL = getApiBase();

/** Fetch the cached item catalog. Public — no auth required. */
const getItems = async () => {
  const response = await axios.get(`${API_URL}deepstorage/items`);
  return response.data;
};

/** Regenerate the item catalog from source. Admin only. */
const regenerate = async (token) => {
  const response = await axios.post(
    `${API_URL}deepstorage/regenerate`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data;
};

const deepStorageApi = { getItems, regenerate };
export default deepStorageApi;
