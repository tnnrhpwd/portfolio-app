const asyncHandler = require('express-async-handler');
const { batchGeocodeLocations } = require('../utils/geocodingService');
const { checkIP } = require('../utils/accessData.js');

/**
 * @desc    Geocode visitor locations
 * @route   POST /api/data/geocode
 * @access  Private (admin only)
 */
const geocodeVisitorLocations = asyncHandler(async (req, res) => {
  try {
    await checkIP(req);
    
    // Check for user and admin authorization
    if (!req.user) {
      res.status(401);
      throw new Error('User not found');
    }
    
    // Admin check (same ID as in Admin.jsx)
    if (req.user._id.toString() !== "6770a067c725cbceab958619") {
      res.status(403);
      throw new Error('Only admin are allowed to use this endpoint');
    }
    
    const { locations } = req.body;
    
    if (!locations || !Array.isArray(locations)) {
      res.status(400);
      throw new Error('Invalid locations data');
    }
    
    // Geocode the locations
    const geocodedLocations = await batchGeocodeLocations(locations);
    
    res.status(200).json(geocodedLocations);
  } catch (error) {
    console.error('Error in geocoding controller:', error);
    res.status(500);
    throw new Error(error.message || 'Server error during geocoding');
  }
});

module.exports = { geocodeVisitorLocations };
