// updateData.js

const asyncHandler = require('express-async-handler');
const openai = require('openai')
require('dotenv').config();
const Data = require('../models/dataModel');
const { setData } = require('../controllers/setData.js');
const openaikey = process.env.OPENAI_KEY
const client = new openai({ apiKey: openaikey })
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
    
    const updateType = (req.params.id === "compress") ? "compress" : "update";
  
    if (updateType === "compress") {
      // Check for user
      if (!req.user.data.includes("tnnrhpwd@gmail.com")) {
        res.status(401)
        throw new Error('Only admin are authorized to utilize the API at this time.')
      }
      
      if (!req.body.data.includes("Net:")) {
        res.status(401)
        throw new Error('Net: not included.')
      }
      const contextInput = req.body.data // Get context input from the query string. ex. 659887fa192e6e8a77e5d9c5 Creator:65673ec1fcacdd019a167520|Net:Steven:Wassaup, Baby! 

      const netIndex = contextInput.indexOf('Net:'); 
      const userInput = contextInput.substring(netIndex + 4); // Get user's input from the query string. ex. Steven:Wassaup, Baby! 

      try {
        // const response = await client.completions.create({
        //   model: 'gpt-3.5-turbo-instruct', // Choose the appropriate engine
        //   prompt: userInput,
        //   max_tokens: 30, // Adjust as needed
        // });

        const response = {
          data: {
              choices: [
                  {
                      text: "This is a simulated response for debugging purposes."
                  }
              ]
          }
        };

        if (response.data.choices[0].text && response.data.choices[0].text.length > 0) {
          const compressedData = response.data.choices[0].text; // Extract the compressed data from the OpenAI response.
          const newData = "Creator:"+req.user._id+"|Net:"+userInput+compressedData;

          // Check if the item is in the database
          if (contextInput.includes("Creator")) {
            // Extract the ID from the contextInput string.
            const id = contextInput.split(' ')[0]; // Assuming the ID is the first part of the string, separated by a space.

            // Check if the ID is a valid ObjectID
            if (typeof id !== 'string') {
              throw new Error('Data input invalid')
            }
            // Check if the ID exists in the database
            const existingData = await Data.findById(id);
            const updatedData = await Data.findByIdAndUpdate(id, { data: newData }, { new: true });
  
            res.status(200).json({ data: [compressedData] });
          } else {
            // If the ID doesn't exist, create a new entry using setData
            // Call setData to update the new data
            const modifiedReq = {
              ...req, // Spread the existing req object
              body: { data: newData }, // Modify the body to pass the new data
            };
            setData(modifiedReq, res);
  
            // res.status(200).json({ data: [compressedData] });
          }
        } else {
          res.status(500).json({ error: 'No compressed data found in the OpenAI response' });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred during compression' });
      }
    }
  
    if(updateType === "update") {
      const dataHolder = await Data.findById(req.params.id)
  
      if (!dataHolder) {
        res.status(400)
        throw new Error('Data input not found')
      }
      
      // Make sure the logged in user matches the comment user
      // if (dataHolder.user.toString() !== req.user.id) {
      //   res.status(401)
      //   throw new Error('User not authorized')
      // }
  
      // res.status(200).json("{ data: datas.map((data) => data.data) }");
  
      // const updatedComment = await Data.findByIdAndUpdate(req.params.id,  { $push: req.body}, {
      //   new: true,
      // })
  
      // Update the `Data` object in the database with the compressed data.
      // const updatedData = await Data.findByIdAndUpdate(req.params.id, { data: compressedData }, {
      //   new: true,
      // });
  
      // res.status(200).json(updatedComment)   // return json of updated comment
    }
})

module.exports = { updateData };