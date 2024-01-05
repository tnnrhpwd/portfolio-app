// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
const jwt = require('jsonwebtoken') //import json web tokens to send to user on login -- this token will be read when user request user details -- confirms same user
const bcrypt = require('bcryptjs')  // used to hash passwords
const openai = require('openai')
const asyncHandler = require('express-async-handler') // sends the errors to the errorhandler

const Data = require('../models/dataModel')
const openaikey = process.env.OPENAI_KEY
const client = new openai({ apiKey: openaikey })

// @desc    Get Data
// @route   GET /api/data
// @access  Private
const getData = asyncHandler(async (req, res) => {
  if (!req.user) {  // Check for user
    res.status(401)
    throw new Error('User not found')
  }

  if (!req.query) {
    res.status(400)
    throw new Error('Please add a text field')
  }
  const dataSearchString = req.query.data.toLowerCase(); // Convert to lowercase
  const userSearchString = req.user.id.toLowerCase(); // Convert to lowercase
  
  const datas = await Data.find({
    $and: [
      { data: { $regex: dataSearchString, $options: 'i' } },
      { user: userSearchString }, // Assuming 'user' is the field that stores user IDs
    ],
  });
  
  res.status(200).json({ data: datas.map((data) => data.data) });
  
});

// @desc    Set data
// @route   POST /api/data
// @access  Private
const setData = asyncHandler(async (req, res) => {
  if (!req.user) {  // Check for user
    res.status(401)
    throw new Error('User not found')
  }
  if (!req.body.data) {
    res.status(400)
    throw new Error('Please add a text field')
  }

  const datas = await Data.create({
    data: req.body.data,
  })
  
  res.status(200).json(datas)
})

// @desc    Update Data
// @route   PUT /api/data/:id
// @access  Private
const updateData = asyncHandler(async (req, res) => {
  if (req.params.id === "u") {}else{
    const dataHolder = await Data.findById(req.params.id)

    if (!dataHolder) {
      res.status(400)
      throw new Error('Data input not found')
    }
  }

  // Check for user
  if (!req.user) {
    res.status(401)
    throw new Error('User not found')
  }

  // Make sure the logged in user matches the comment user
  // if (dataHolder.user.toString() !== req.user.id) {
  //   res.status(401)
  //   throw new Error('User not authorized')
  // }

  var shouldCompress = true;
  // res.status(200).json("{ data: datas.map((data) => data.data) }");

  if (shouldCompress) {    // If compression is requested, send a request to OpenAI
    // Check for user
    if (!req.user.data.includes("tannerh@engineer.com")) {
      res.status(401)
      throw new Error('Only admin are authorized to utilize the API at this time.')
    }

    const userInput = req.body.data; // Get user's input from the query string

    try {
      const response = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct', // Choose the appropriate engine
        prompt: userInput,
        max_tokens: 50, // Adjust as needed
      });
    
      if (response.choices && response.choices.length > 0) {
        const compressedData = response.choices[0].text; // Extract the compressed data from the OpenAI response.
    
        // Update the `Data` object in the database with the compressed data.
        // const updatedData = await Data.findByIdAndUpdate(req.params.id, { data: compressedData }, {
        //   new: true,
        // });
    
        res.status(200).json(compressedData);
      } else {
        res.status(500).json({ error: 'No compressed data found in the OpenAI response' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'An error occurred during compression' });
    }
  }

  // const updatedComment = await Data.findByIdAndUpdate(req.params.id,  { $push: req.body}, {
  //   new: true,
  // })

  // res.status(200).json(updatedComment)   // return json of updated comment
})

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteData = asyncHandler(async (req, res) => {
  const dataHolder = await Data.findById(req.params.id)

  if (!dataHolder) {
    res.status(400)
    throw new Error('Comment not found')
  }

  // Check for user
  if (!req.user) {
    res.status(401)
    throw new Error('User not found')
  }

  // Make sure the logged in user matches the comment user
  if (dataHolder.user.toString() !== req.user.id) {
    res.status(401)
    throw new Error('User not authorized')
  }

  await Data.remove()

  res.status(200).json({ id: req.params.id })
})

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

// Generate JWT -- sent to user after register + sign in. User stores this token and send it back inside the header on following requests.
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  })
}

module.exports = {
  getData,
  setData,
  updateData,
  deleteData,
  registerUser,
  loginUser,
}