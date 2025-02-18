// deleteData.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel.js');
const mongoose = require('mongoose');
const { checkIP } = require('../utils/accessData.js');

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteHashData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
        const id = req.params.id;
        console.log("delete id=" + id);

        // Check if the id is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            res.status(400);
            throw new Error('Invalid ID format');
        }

        const dataHolder = await Data.findById(id);
        console.log("delete dataHolder=" + dataHolder);

        if (!dataHolder) {
            res.status(400);
            throw new Error('Data not found.');
        }

        const dataCreator = dataHolder.data.text.substring(dataHolder.data.text.indexOf("Creator:") + 8, dataHolder.data.text.indexOf("Creator:") + 8 + 24);

        // Check for owner
        if (!dataCreator) {
            res.status(401);
            throw new Error('Data creator not found.');
        }

        // Check for user
        if (!req.user) {
            res.status(401);
            throw new Error('User not found.');
        }
        console.log("delete dataCreator=" + dataCreator + ", req.user.id=" + req.user.id);

        // Make sure the logged in user matches the comment user
        if (dataCreator !== req.user.id) {
            res.status(401);
            throw new Error('User not authorized.');
        }

        await Data.deleteOne({ _id: id });

        res.status(200).json({ id });
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = { deleteHashData };