// This file imports the data object schema + functions | Routers listen for requests then execute callback functions 
const express = require('express')
const router = express.Router()
const {
  getData,
  setData,
  updateData,
  deleteData,
  registerUser,
  loginUser,
} = require('../controllers/controllerData')

// Declare authentication variable
const { protect } = require('../middleware/authMiddleware')

// listens for HTTP requests on /api/data/
router.route('/').get(protect, getData).post(protect, setData) // GET + POST -- The lack of middleware here allows anyone to get or post data without being authorized. this must be resolved prior to launch.
router.route('/:id').delete(protect, deleteData).put(protect, updateData) // DELETE + UPDATE -- The protect middleware here prevents access from users without JWT
router.post('/register', registerUser)
router.post('/login', loginUser)

module.exports = router
