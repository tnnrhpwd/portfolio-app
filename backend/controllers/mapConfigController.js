const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');

/**
 * @desc    Get secure Maps API initialization data
 * @route   GET /api/data/map-config
 * @access  Private (admin only)
 */
const getMapConfig = asyncHandler(async (req, res) => {
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
    
    // Return the API key and any other configuration needed
    res.status(200).json({
      apiKey: process.env.GOOGLE_KEY,
      mapOptions: {
        fullscreenControl: false,
        streetViewControl: false,
        mapTypeControl: false,
        styles: [
          {
            featureType: 'all',
            elementType: 'labels.text.fill',
            stylers: [{ color: '#6c757d' }]
          },
          {
            featureType: 'all',
            elementType: 'labels.text.stroke',
            stylers: [{ visibility: 'off' }]
          },
          {
            featureType: 'administrative',
            elementType: 'geometry.stroke',
            stylers: [{ color: '#cfd8dc' }]
          },
          {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#e8eaf6' }]
          },
          {
            featureType: 'water',
            elementType: 'geometry.fill',
            stylers: [{ color: '#bbdefb' }]
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error providing map configuration:', error);
    res.status(500);
    throw new Error(error.message || 'Server error');
  }
});

module.exports = { getMapConfig };
