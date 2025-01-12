const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');
const { checkIP } = require('./accessData.js');

// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Set up multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

// @desc    Set data
// @route   POST /api/data
// @access  Private
const setData = asyncHandler(async (req, res) => {
    await checkIP(req);
    if (!req.user) {  // Check for user
      res.status(401)
      throw new Error('User not found')
    }
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
    }

    const datas = await Data.create({
        data: {
            ActionGroupObject: req.body.data.ActionGroupObject,
            files: files
        }
    });
    
    res.status(200).json(datas)
})

module.exports = { setData, upload };