// registerUser.js

// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
const bcrypt = require('bcryptjs')  // used to hash passwords
require('dotenv').config();
const asyncHandler = require('express-async-handler') // sends the errors to the errorhandler
const { generateToken } = require('./generateToken')
const Data = require('../models/dataModel')

// @desc    Register new user
// @route   POST /api/data/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
    const { nickname, email, password } = req.body
  
    if (!nickname || !email || !password) {
      res.status(400)
      throw new Error('Please add all fields')
    }
  
    // Check if email exists
    const emailExists = await Data.findOne({ data: { $regex: `${"Email:"+email}\\s\\|` } })
    // Check if email exists
    const nicknameExists = await Data.findOne({ data: { $regex: `${"Nickname:"+nickname}\\s\\|` } })
  
    if (emailExists) {
      res.status(400)
      throw new Error("This email is already registered.")
    }if (nicknameExists) {
      res.status(400)
      throw new Error("This nickname is already taken.")
    }
  
    // Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
  
    // Create user
    const data = await Data.create({
      data:"Nickname:"+nickname+"|Email:"+email+"|Password:"+hashedPassword,
    })
  
    if (data) { // if user data successfully created, send JSON web token back to user
      res.status(201).json({
        _id: data.id,
        nickname,
        token: generateToken(data._id),   //uses JWT secret 
      })
    } else {
      res.status(400)
      throw new Error('Invalid user data')
    }
})

module.exports = { registerUser };