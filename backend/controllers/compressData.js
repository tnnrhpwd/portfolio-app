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


    // if (!req.body || !req.body.data || typeof req.body.data !== 'string' || !req.body.data.includes("Net:")) {
    //     res.status(401)
    //     throw new Error('Net: not included. ')
    // }

    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON); // Log the request body

    const itemID = parsedJSON._id; // Get the ID from the query string.

    const contextInput = parsedJSON.data.text; // Get context input from the query string.
    console.log('Context input:', contextInput); // Log the context input

    if (typeof contextInput !== 'string') { 
        throw new Error('Data input invalid')
    }

    const netIndex = contextInput.includes('Net:') ? contextInput.indexOf('Net:'): 0; 
    const userInput = netIndex>0 ? contextInput.substring(netIndex + 4): contextInput;

    console.log('User input:', userInput); // Log the user input

    try {
        const response = await client.completions.create({
          model: 'gpt-3.5-turbo-instruct', // Choose the appropriate engine
          prompt: userInput,
          max_tokens: 30, // Adjust as needed
        });
        console.log('OpenAI response:', response); // Log the OpenAI response
        // const response = { data: { choices: [ {text: "This is a simulated response for debugging purposes."} ] } };

        if (response.choices[0].text && response.choices[0].text.length > 0) {
            const compressedData = response.choices[0].text; // Extract the compressed data from the OpenAI response.
            const newData = "Creator:"+req.user._id+"|Net:"+userInput+"\n"+compressedData;

            // Check if the ID is a valid ObjectID
            if (itemID && itemID.match(/^[0-9a-fA-F]{24}$/)) {
                // Check if the ID exists in the database
                const existingData = await Data.findById(itemID);
                if (existingData) {
                    const updatedData = await Data.findByIdAndUpdate(itemID, { data: { text: newData } }, { new: true });
                    res.status(200).json({ data: [compressedData] });
                } else {
                    res.status(404).json({ error: 'Data not found' });
                }
            } else {
                // Create a new item if no valid itemID is provided
                const newItem = new Data({ data: { text: newData }, user: req.user._id });
                console.log('New item:', newItem);
                await newItem.save();
                res.status(201).json({ data: [compressedData] });
            }
        } else {
            res.status(500).json({ error: 'No compressed data found in the OpenAI response' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred during compression' });
    }
});

module.exports = { compressData };