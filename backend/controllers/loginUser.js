// loginUser.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');
const { generateToken } = require('./generateToken');
const bcrypt = require('bcryptjs');  // used to hash passwords

// @desc    Authenticate a user
// @route   POST /api/data/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
  
    // Check for user email
    const user = await Data.findOne({ data: { $regex: `${email}` } });
    if (user === null) {
      res.status(400);
      throw new Error('Invalid email.');  // Changed to a more generic error message
    }

    // Extract password and nickname from the stored data
    const userPassword = user.data.substring(user.data.indexOf('|Password:') + 10);
    const userNickname = user.data.substring(user.data.indexOf('Nickname:') + 9, user.data.indexOf('|Email:'));
    
    // Check if the password matches
    if (await bcrypt.compare(password, userPassword)) {
      res.json({
        _id: user.id,
        email: email,  // Include email in the response
        nickname: userNickname,
        token: generateToken(user._id),
      });
    } else {
      res.status(400);
      throw new Error('Invalid password.');  // Changed to a more generic error message
    }
});

module.exports = { loginUser };
