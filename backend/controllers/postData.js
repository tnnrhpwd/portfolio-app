// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
const bcrypt = require('bcryptjs')  // used to hash passwords
require('dotenv').config();
const { generateToken } = require('../utils/generateToken')
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');
const { checkIP } = require('../utils/accessData.js');
const storage = multer.memoryStorage();// Set up multer for memory storage
const upload = multer({ storage: storage });


// @desc    post data
// @route   POST /api/data
// @access  Private
const postData = asyncHandler(async (req, res) => {
  await checkIP(req);
  if (!req.body) {
    res.status(400)
    throw new Error('Please add a data field. req: ' + JSON.stringify(req.body.data))
  }
  console.log('req.body.data: ', req.body.data)
  let files = [];
  if (req.files && req.files.length > 0) {
      files = req.files.map(file => ({
          filename: file.originalname,
          contentType: file.mimetype,
          data: file.buffer.toString('base64')
      }));
  } else if (req.body.data && req.body.data.Files) {
      // Read from JSON body
      files = req.body.data.Files;
  }

  const datas = await Data.create({
      data: {
          text: typeof req.body.data === 'string' ? req.body.data : req.body.data.Text,
          ActionGroupObject: req.body.data.ActionGroupObject,
          files: files
      }
  });
  
  res.status(200).json(datas)
})


// @desc    Register new user
// @route   POST /api/data/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
    await checkIP(req);
    const { nickname, email, password } = req.body
  
    if (!nickname || !email || !password) {
      res.status(400)
      throw new Error('Please add all fields')
    }
  
    const emailExists = await Data.find({
      'data.text': { $regex: `${"Email:" + email}`, $options: 'i' }
    });
    
    if (emailExists.length > 0) {
      res.status(400)
      throw new Error('Email already exists')
    }
    
    const nicknameExists = await Data.find({
      'data.text': { $regex: `${"Nickname:" + nickname}`, $options: 'i' } 
    });
    
    if (nicknameExists.length > 0) {
      res.status(400)
      throw new Error('Nickname already exists')
    }
  
    // Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
  
    // Create user
    const data = await Data.create({
      data:{text:"Nickname:"+nickname+"|Email:"+email+"|Password:"+hashedPassword},
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

// @desc    Authenticate a user
// @route   POST /api/data/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    await checkIP(req);
    const { email, password } = req.body;
  
    // Check for user email
    const users = await Data.find({ 'data.text': { $regex: `Email:${email}`, $options: 'i' } });
    if (!(users.length === 1)) {
      res.status(400);
      throw new Error("Could nto find that user. users.length: "+users.length+",json: "+JSON.stringify(users));
    }
    let user, userPassword, userNickname, userStripe;
    try {
      user = users[0];

      // Extract password and nickname from the stored data
      userStripe = user.data.text.substring(user.data.text.indexOf('|stripeid:')+10);
      userPassword = user.data.text.substring(user.data.text.indexOf('|Password:') + 10, user.data.text.indexOf('|stripeid:'));
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
        stripe: userStripe,
        token: generateToken(user._id),
      });
    } else {
      res.status(400);
      throw new Error('Invalid password.');
    }
});

module.exports = { postData, loginUser, registerUser };