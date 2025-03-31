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
    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${formattedLocation}&key=${process.env.GOOGLE_KEY}`
    );

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const { lat, lng } = response.data.results[0].geometry.location;
      return { lat, lng };
    }
    
    console.error(`Geocoding failed for location: ${location}. Status: ${response.data.status}`);
    return null;
  } catch (error) {
    console.error(`Geocoding error for location: ${location}`, error.message);
    return null;
  }
};

/**
 * Batch geocodes multiple locations
 * @param {Array<{city: string, country: string, ip: string}>} locations 
 * @returns {Promise<Array>} - Array of locations with coordinates added
 */
const batchGeocodeLocations = async (locations) => {
  const results = [];
  const cache = new Map(); // Simple in-memory cache

  for (const location of locations) {
    try {
      const locationString = `${location.city}, ${location.country}`;
      let coordinates;
      
      // Check cache first
      if (cache.has(locationString)) {
        coordinates = cache.get(locationString);
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
        results.push(location); // Keep original location without coordinates
      }
    } catch (error) {
      console.error(`Error geocoding location: ${location.city}, ${location.country}`, error);
      results.push(location); // Keep original location without coordinates
    }
  }
  
  return results;
};

module.exports = { geocodeLocation, batchGeocodeLocations };
