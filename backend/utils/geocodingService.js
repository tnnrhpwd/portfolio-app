const axios = require('axios');
require('dotenv').config();

/**
 * Geocodes a location using Google Maps Geocoding API
 * @param {string} location - Location to geocode (city, country)
 * @returns {Promise<{lat: number, lng: number}>} - Coordinates
 */
const geocodeLocation = async (location) => {
  try {
    const formattedLocation = encodeURIComponent(location);
    const apiKey = process.env.GOOGLE_KEY;
    
    // Check if API key is available
    if (!apiKey) {
      console.error('Google Maps API key is missing. Please check your environment variables.');
      return null;
    }
    
    // Log the API key length for debugging (don't log the actual key for security)
    console.log(`Using Google API key (${apiKey.length} chars)`);
    
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${formattedLocation}&key=${apiKey}`;
    console.log(`Making geocoding request for: ${location}`);
    
    const response = await axios.get(url);

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const { lat, lng } = response.data.results[0].geometry.location;
      console.log(`Successfully geocoded ${location}: lat=${lat}, lng=${lng}`);
      return { lat, lng };
    }
    
    // More detailed error handling
    if (response.data.status === 'REQUEST_DENIED') {
      console.error(`Geocoding API request denied for location "${location}". Error message: ${response.data.error_message || 'No error message provided'}`);
      
      // Additional debugging info
      if (response.data.error_message && response.data.error_message.includes('API key')) {
        console.error('Error suggests API key issues. Please check:');
        console.error('1. The API key is valid');
        console.error('2. Geocoding API is enabled in Google Cloud Console');
        console.error('3. Billing is enabled for the Google Cloud project');
        console.error('4. There are no restrictions preventing server-side usage');
      }
    } else {
      console.error(`Geocoding failed for location: ${location}. Status: ${response.data.status}`);
    }
    
    return null;
  } catch (error) {
    console.error(`Geocoding error for location: ${location}:`, error.message);
    // If we got a response error, try to extract more details
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
    return null;
  }
};

/**
 * Batch geocodes multiple locations
 * @param {Array<{city: string, country: string, ip: string}>} locations 
 * @returns {Promise<Array>} - Array of locations with coordinates added
 */
const batchGeocodeLocations = async (locations) => {
  // Check if we have access to the Google Maps API key
  if (!process.env.GOOGLE_KEY) {
    console.error('Google Maps API key is missing. Returning locations without geocoding.');
    return locations;
  }
  
  const results = [];
  const cache = new Map(); // Simple in-memory cache

  for (const location of locations) {
    try {
      if (!location.city || !location.country) {
        console.log('Skipping location with missing city or country');
        results.push(location);
        continue;
      }
      
      const locationString = `${location.city}, ${location.country}`;
      let coordinates;
      
      // Check cache first
      if (cache.has(locationString)) {
        coordinates = cache.get(locationString);
        console.log(`Using cached coordinates for ${locationString}`);
      } else {
        // Call Google Maps API with delay to prevent rate limiting
        coordinates = await geocodeLocation(locationString);
        
        // Cache the result
        if (coordinates) {
          cache.set(locationString, coordinates);
        }
        
        // Add small delay to prevent hitting API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      if (coordinates) {
        results.push({
          ...location,
          coordinates
        });
      } else {
        // If geocoding failed, add mock coordinates based on country code for visualization
        // This is just a fallback to show something on the map
        const mockCoordinates = getMockCoordinatesForCountry(location.country);
        if (mockCoordinates) {
          console.log(`Using mock coordinates for ${location.city}, ${location.country}`);
          results.push({
            ...location,
            coordinates: mockCoordinates,
            isMockLocation: true
          });
        } else {
          results.push(location); // Keep original location without coordinates
        }
      }
    } catch (error) {
      console.error(`Error processing location: ${location.city}, ${location.country}`, error);
      results.push(location); // Keep original location without coordinates
    }
  }
  
  return results;
};

/**
 * Returns approximate coordinates for a country when actual geocoding fails
 * These are just rough centers of countries for fallback visualization
 */
const getMockCoordinatesForCountry = (countryCode) => {
  const countryCoordinates = {
    'US': { lat: 37.0902, lng: -95.7129 },
    'CN': { lat: 35.8617, lng: 104.1954 },
    'CA': { lat: 56.1304, lng: -106.3468 },
    'UK': { lat: 55.3781, lng: -3.4360 },
    'GB': { lat: 55.3781, lng: -3.4360 },
    'AU': { lat: -25.2744, lng: 133.7751 },
    'DE': { lat: 51.1657, lng: 10.4515 },
    'FR': { lat: 46.2276, lng: 2.2137 },
    'IN': { lat: 20.5937, lng: 78.9629 },
    'JP': { lat: 36.2048, lng: 138.2529 },
  };
  
  // Check if we have coordinates for this country code
  if (countryCode && countryCoordinates[countryCode.toUpperCase()]) {
    return countryCoordinates[countryCode.toUpperCase()];
  }
  
  // Return null if we don't have mock coordinates for this country
  return null;
};

module.exports = { geocodeLocation, batchGeocodeLocations };
