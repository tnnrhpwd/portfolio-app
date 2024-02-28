// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const { setData, getData, updateData, deleteData, registerUser, loginUser } = require('../controllers/index.js');

// Routes
router.route('/')
  .get(protect, getData) // GET request for fetching data
  .post(protect, setData); // POST request for setting data

router.route('/:id')
  .delete(protect, deleteData) // DELETE request for deleting data
  .put(protect, updateData); // PUT request for updating data

router.post('/register', registerUser); // Route to handle user registration
router.post('/login', loginUser); // Route to handle user login

module.exports = router; // Export the router