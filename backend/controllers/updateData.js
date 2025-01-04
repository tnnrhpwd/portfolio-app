// updateData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const Data = require('../models/dataModel');
const { checkIP } = require('./accessData.js');

// @desc    Update Data
// @route   PUT /api/data/:id
// @access  Private
const updateData = asyncHandler(async (req, res) => {
    await checkIP(req);
    // Check for user
    if (!req.user) {
        res.status(401)
        throw new Error('User not found')
    }
    const dataHolder = await Data.findById(req.params.id)
    if (!dataHolder) {
        res.status(400)
        throw new Error('Data input not found')
    }
    
    // Make sure the logged in user matches the comment user
    if (dataHolder.user.toString() !== req.user.id) {
        res.status(401)
        throw new Error('User not authorized')
    }
    res.status(200).json("{ data: datas.map((data) => data.data) }");
    const updatedData = await Data.findByIdAndUpdate(req.params.id,  { $push: req.body}, {
        new: true,
    })
    res.status(200).json(updatedData)   // return json of updated comment
})

module.exports = { updateData };