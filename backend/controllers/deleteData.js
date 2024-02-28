// deleteData.js

const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel');

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

module.exports = { deleteData };