// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const { setData, upload, getData, getPublicData, updateData, compressData, deleteData, registerUser, loginUser } = require('../controllers/index.js');

// Routes
router.route('/')
  .get(protect, getData) // GET request for fetching protected data
  .post(protect, upload.array('files'), setData); // POST request for setting data with file upload

router.route('/:id')
  .delete(protect, deleteData) // DELETE request for deleting data
  .put(protect, updateData); // PUT request for updating data

router.post('/compress', protect, compressData); // Route to handle data compression

router.post('/register', registerUser); // Route to handle user registration
router.post('/login', loginUser); // Route to handle user login

// New route for fetching public data
router.get('/public', getPublicData); // GET request for fetching public data

module.exports = router; // Export the router