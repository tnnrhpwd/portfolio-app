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
    const users = await Data.find({ 'data.text': { $regex: `Email:${email}`, $options: 'i' } });
    if (!(users.length === 1)) {
      res.status(400);
      throw new Error("Could nto find that user. users.length: "+users.length+",json: "+JSON.stringify(users));
    }
    let user, userPassword, userNickname;
    try {
      user = users[0];

      // Extract password and nickname from the stored data
      userPassword = user.data.text.substring(user.data.text.indexOf('|Password:') + 10);
      userNickname = user.data.text.substring(user.data.text.indexOf('Nickname:') + 9, user.data.text.indexOf('|Email:'));
    } catch (error) {
      res.status(500);
      throw new Error('Error extracting user data.');
    }
    // Check if the password matches
    if (await bcrypt.compare(password, userPassword)) {
      res.json({
        _id: user._id,
        email: email,
        nickname: userNickname,
        token: generateToken(user._id),
      });
    } else {
      res.status(400);
      throw new Error('Invalid password.');
    }
});
module.exports = { loginUser };
