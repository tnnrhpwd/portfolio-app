// setData.js

const asyncHandler = require('express-async-handler');
const multer = require('multer');
const path = require('path');
const Data = require('../models/dataModel');

// Set up multer for file storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

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
  
    const files = req.files.map(file => ({
        filename: file.filename,
        path: file.path
    }));

    const datas = await Data.create({
        data: req.body.data,
        files: files
    });
    
    res.status(200).json(datas)
})

module.exports = { setData, upload };