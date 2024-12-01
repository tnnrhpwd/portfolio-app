// deleteData.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');
const mongoose = require('mongoose');

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteData = asyncHandler(async (req, res) => {
    const id = req.params.id;

    // Check if the id is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400);
        throw new Error('Invalid ID format');
    }

    const dataHolder = await Data.findById(id);

    if (!dataHolder) {
        res.status(400);
        throw new Error('Data not found');
    }

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    // Make sure the logged in user matches the comment user
    if (dataHolder.user.toString() !== req.user.id) {
        res.status(401);
        throw new Error('User not authorized');
    }

    await dataHolder.remove();

    res.status(200).json({ id });
});

module.exports = { deleteData };