// setData.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');

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
      throw new Error('Please add a data field')
    }
  
    const datas = await Data.create({
      data: req.body.data,
    })
    
    res.status(200).json(datas)
})

module.exports = { setData };