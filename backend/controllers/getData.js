// getData.js
import asyncHandler from 'express-async-handler'; // Assuming you're using express-async-handler
import Data from '../models/dataModel.js'; // Replace './Data' with the actual path to your Data model

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
    try {
      const dataSearchString = req.query.data.toLowerCase(); // Convert to lowercase
      const userSearchString = req.user.id.toLowerCase(); // Convert to lowercase
      
      const datas = await Data.find({
        $and: [
          { data: { $regex: dataSearchString, $options: 'i' } },
          { user: userSearchString }, // Assuming 'user' is the field that stores user IDs
        ],
      });
      
      if (dataSearchString==="net:") {
        res.status(200).json({ 
          data: datas.map((data) => `${data._id} ${data.data}`) 
        });
        return;
      }
      res.status(200).json({ data: datas.map((data) => data.data) });
  
    } catch (error) {
      res.status(500).json({ error: req.query.data });
    }
});

export default getData;