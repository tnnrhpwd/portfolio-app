// This file exports protect -- async function that confirms that the request user is the same as the response user. DOES NOT CHECK PASSWORD or ANYTHING WITH UI -- only confirms that reponse is sent to the requester
const jwt = require('jsonwebtoken');                   // import web token library to get user's token
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const Data = require('../models/dataModel');           // import data schema

// This middleware async function is called anytime a user requests user information
const protect = asyncHandler(async (req, res, next) => {
  let token;
  console.log('protect middleware called')

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')  // if HTTP request header exists and startes with Bearer -- IF USER HAS JWT ( LOGGED IN )
  ) {
    try {

      // Get token from header
      token = req.headers.authorization.split(' ')[1]     // set token as just the token, ignore the "Bearer "

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET)

      // Get user from the token -- the JWT payload is holding the id, so we get the ID, find the associated user, and prevent the hashed password from being delivered.
      // req.user = await Data.findOne({ data: { $regex: `${decoded.id}` } }).select('-password')
      req.user = await Data.findById(decoded.id).select('-password')

      next()    // goes to next middleware function
    } catch (error) {     
      console.log('Protect Middleware Error:', error)
      res.status(401)
      if (error.name === 'TokenExpiredError') {
        res.json({ dataMessage: 'Not authorized, token expired' });
      } else {
        res.json({ dataMessage: 'Not authorized' });
      }
      return;
    }
  }

  // if NOT LOGGED IN -- throw error
  if (!token) { 
    res.status(401)
    res.json({ dataMessage: 'Not authorized, no token' });
  }
  console.log('protect middleware passed')
})

module.exports = { protect }  // exported to userRoutes