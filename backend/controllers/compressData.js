// compressData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const openai = require('openai');
const Data = require('../models/dataModel');
const openaikey = process.env.OPENAI_KEY;
const client = new openai({ apiKey: openaikey });
const { checkIP } = require('./accessData.js');

// @desc    Compress Data
// @route   POST /api/compress
// @access  Private
const compressData = asyncHandler(async (req, res) => {
    await checkIP(req);
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    // Check for user
    if (req.user.data && req.user.data.text && typeof req.user.data.text === 'string' && !req.user.data.text.includes("tnnrhpwd@gmail.com")) {
        res.status(401)
        throw new Error('Only admin are authorized to utilize the API at this time.' + req.user.data.text)
    }


    if (!req.body || !req.body.data || typeof req.body.data !== 'string' || !req.body.data.includes("Net:")) {
        res.status(401)
        throw new Error('Net: not included. ')
    }

    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON); // Log the request body

    const itemID = parsedJSON._id; // Get the ID from the query string.

    const contextInput = parsedJSON.data.text; // Get context input from the query string.
    console.log('Context input:', contextInput); // Log the context input

    if (typeof contextInput !== 'string') { 
        throw new Error('Data input invalid')
    }

    const netIndex = contextInput.indexOf('Net:'); 
    const userInput = contextInput.substring(netIndex + 4); // Get user's input from the query string. ex. Steven:Wassaup, Baby! 

    console.log('User input:', userInput); // Log the user input

    try {
        // const response = await client.completions.create({
        //   model: 'gpt-3.5-turbo-instruct', // Choose the appropriate engine
        //   prompt: userInput,
        //   max_tokens: 30, // Adjust as needed
        // });

    const response = { data: { choices: [ {text: "This is a simulated response for debugging purposes."} ] } };

    if (response.data.choices[0].text && response.data.choices[0].text.length > 0) {
        const compressedData = response.data.choices[0].text; // Extract the compressed data from the OpenAI response.
        const newData = "Creator:"+req.user._id+"|Net:"+userInput+"\n"+compressedData;

        // Check if the ID is a valid ObjectID
        if (!itemID || !itemID.match(/^[0-9a-fA-F]{24}$/)) {
        throw new Error('Data input invalid')
        }
        
        // Check if the ID exists in the database
        const existingData = await Data.findById(itemID);
        const updatedData = await Data.findByIdAndUpdate(itemID, { data: {text: newData} }, { new: true });
        res.status(200).json({ data: [compressedData] });

        } else {
        res.status(500).json({ error: 'No compressed data found in the OpenAI response' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred during compression' });
    }
});

module.exports = { compressData };