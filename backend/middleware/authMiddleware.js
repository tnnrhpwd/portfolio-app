// This file exports protect -- async function that confirms that the request user is the same as the response user. DOES NOT CHECK PASSWORD or ANYTHING WITH UI -- only confirms that reponse is sent to the requester
const jwt = require('jsonwebtoken');                   // import web token library to get user's token
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const AWS = require('aws-sdk'); // Import AWS SDK

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient(); // Create DynamoDB DocumentClient

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

      console.log("Decoded ID from JWT:", decoded.id);

      // Instead of a direct get operation, use a scan with a filter expression
      // This is less efficient but more flexible for finding the user
      const params = {
        TableName: 'Simple',
        FilterExpression: "id = :userId",
        ExpressionAttributeValues: {
          ":userId": String(decoded.id)
        }
      };

      // console.log("DynamoDB scan params:", params);
      const result = await dynamodb.scan(params).promise();
      // console.log("DynamoDB scan result:", result);

      if (!result.Items || result.Items.length === 0) {
        res.status(401);
        throw new Error('User not found');
      }

      req.user = result.Items[0]; // Attach user to the request
      // console.log("User attached to request:", req.user);

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

// ...existing code...

module.exports = { protect }  // exported to userRoutes
