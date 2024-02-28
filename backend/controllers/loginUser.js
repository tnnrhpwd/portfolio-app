// loginUser.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');
const { generateToken } = require('./generateToken')
const bcrypt = require('bcryptjs')  // used to hash passwords

// @desc    Authenticate a user
// @route   POST /api/data/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body
  
    // Check for user email
    const user = await Data.findOne({ data: { $regex: `${email}` } })
    if (user === null){
      res.status(400)
      throw new Error(email)  // showed in frontend 
    }
    const userPassword = user.data.substring(user.data.indexOf('|Password:') + 10);
    const userNickname = user.data.substring(user.data.indexOf('Nickname:') + 9,user.data.indexOf('|Email:'))
    if (user && (await bcrypt.compare(password, userPassword))) {  // if decrypted password equals user password input, send token back to user.
      res.json({
        _id: user.id,
        nickname: userNickname,            // only need to send token back
        token: generateToken(user._id),
      })
    } else {
      res.status(400)
      throw new Error(userPassword)  // showed in frontend 
    }
  })

  module.exports = { loginUser };