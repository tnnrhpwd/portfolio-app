require('dotenv').config();
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const fetch = require('node-fetch');
const Data = require('../models/dataModel.js');
const wordBaseUrl = 'https://random-word-api.p.rapidapi.com/L/';
const defBaseUrl = 'https://mashape-community-urban-dictionary.p.rapidapi.com/define?term=';
const { ObjectId } = require('mongoose').Types;
const rapidapiwordoptions = {
    method: 'GET',
    headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'random-word-api.p.rapidapi.com'
    }
};
const rapidapidefoptions = {
    method: 'GET',
    headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'mashape-community-urban-dictionary.p.rapidapi.com'
    }
};
const { checkIP } = require('../utils/accessData.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const { createCustomer } = require('./postHashData.js');


// @desc    Get Data
// @route   GET /api/data
// @access  Private
const getHashData = asyncHandler(async (req, res) => {
    await checkIP(req);
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    if (!req.query || !req.query.data) {
        res.status(400);
        throw new Error('Invalid request query parameter');
    }

    let data;
    try {
        data = JSON.parse(req.query.data);
    } catch (error) {
        res.status(400);
        throw new Error('Invalid request query parameter parsing');
    }

    if (!data.text) {
        res.status(400);
        throw new Error('Invalid request query parameter parsed data');
    }

    try {
        const dataSearchString = data.text.toLowerCase();
        const userSearchString = `Creator:${req.user.id.toLowerCase()}`;
        var randomWord = "";

        if (dataSearchString.startsWith("getword:")) { // Check if dataSearchString is "getword"
            const wordLength = dataSearchString.substring(8); // returns "5" before a user modifies it to other custom numbers
            const ranwordapiurl = `${wordBaseUrl}${wordLength}`;
            const response = await fetch(ranwordapiurl, rapidapiwordoptions);
            if (!response.ok) {
                throw new Error('Failed to fetch random word from rapidapi.');
            }
            const data = await response.json();
            randomWord = data.word.toLowerCase(); // Convert to lowercase
            res.status(200).json({ word: randomWord }); // Return the random word

        } else if (dataSearchString.startsWith("getdef:")) { // Handle "getdef:" request
            const word = dataSearchString.substring(7); // Extract the word from dataSearchString
            const defUrl = `${defBaseUrl}${word}`;

            const response = await fetch(defUrl, rapidapidefoptions);
            if (!response.ok) {
                throw new Error('Failed to fetch definition from rapidapi');
            }
            const data = await response.json();
            const definition = data.list[0].definition + data.list[1].definition + data.list[2].definition;
            res.status(200).json({ worddef: definition }); // Return the definition

        } else { // Handle database search requests
            try {
                // Separate the search conditions for public and private
                const publicSearchConditions = [
                    { 'data.text': { $regex: "\\|Public:true", $options: 'i' } },
                    {
                        $or: [
                            { 'data.text': { $regex: dataSearchString, $options: 'i' } },
                        ]
                    }
                ];

                const privateSearchConditions = [
                    { 'data.text': { $regex: userSearchString, $options: 'i' } },
                    {
                        $or: [
                            { 'data.text': { $regex: dataSearchString, $options: 'i' } },
                        ]
                    }
                ];

                // Check if dataSearchString is a valid ObjectId
                if (ObjectId.isValid(dataSearchString)) {
                    publicSearchConditions[1].$or.push({ _id: ObjectId(dataSearchString) });
                    privateSearchConditions[1].$or.push({ _id: ObjectId(dataSearchString) });
                }

                // Fetch data from the database
                const [dataPublic, dataPrivate] = await Promise.race([
                    Promise.all([
                        Data.find({ $and: publicSearchConditions }).sort({ updatedAt: -1 }).limit(5),
                        Data.find({ $and: privateSearchConditions }).sort({ updatedAt: -1 }).limit(5)
                    ]),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Database query timeout')), 5000)
                    )
                ]);

                const dataList = [...dataPublic, ...dataPrivate];

                // Return the data
                res.status(200).json({
                    data: dataList.map((data) => ({
                        data: data.data,
                        ActionGroup: data.ActionGroup,
                        files: data.files,
                        updatedAt: data.updatedAt,
                        createdAt: data.createdAt,
                        __v: data.__v,
                        _id: data._id,
                    }))
                });
            } catch (error) {
                console.error("Error fetching data:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({
            error: req.query.data,
            input: req.query.data,
            output: randomWord,
            errorMessage: error.message
        });
    }
});

// GET: Fetch previous payment methods
const getPaymentMethods = asyncHandler(async (req, res, next) => {
    try {
        console.log('getPaymentMethods called with fromPutHashData:', req.fromPutHashData);
        
        if (!req.user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (!req.user.data.text.includes("|stripeid:")) {
            try {
                // Create a new customer if the customer ID is not found
                const customer = await createCustomer({
                    body: {
                        email: req.user.data.text.substring(req.user.data.text.indexOf('Email:') + 6,
                            req.user.data.text.indexOf('.com|') + 4),
                        name: req.user.data.text.substring(req.user.data.text.indexOf('Nickname:') + 9,
                            req.user.data.text.indexOf('|Email:')),
                    }
                }, res);

                // Update user data with the new customer ID
                req.user.data.text += `|stripeid:${customer.id}`;
                console.log(`|stripeid:${customer.id}`);
                await req.user.save();

                req.paymentMethods = [];
                if (req.fromPostHashData) {
                    return next();
                } else {
                    res.status(200).json({ message: 'Customer created and updated successfully', customer });
                    return;
                }
            } catch (error) {
                console.error('Customer creation failed:', error);
                res.status(500).json({ error: 'Customer creation failed' });
                return;
            }
        }

        console.log('req.user.data.text:', req.user.data.text);

        const customerId = req.user.data.text.substring(req.user.data.text.indexOf('|stripeid:') + 10,
            req.user.data.text.indexOf('|stripeid:') + 28);
        console.log('Customer ID:', customerId, {
            customer: customerId,
            limit: 3,
            type: 'card',
        });
        const paymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            limit: 3,
            type: 'card',
        });
        console.log('Reply from Stripe:', JSON.stringify(paymentMethods.data, null, 2));

        req.paymentMethods = paymentMethods.data;
        
        if (req.fromPutHashData) {
            console.log('Returning next from GetHashData.GetPaymentMethods with payment methods count:', paymentMethods.data.length);
            return next();
        } else {
            console.log('Returning payment methods from GetHashData.GetPaymentMethods ...');
            res.status(200).json(paymentMethods.data);
        }
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        if (req.fromPostHashData || req.fromPutHashData) {
            return next(error);
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const getAllData = async (req, res) => {
    try {
        // Check if the user is an admin
        if (req.user && req.user._id.toString() === "6770a067c725cbceab958619") {
        //   console.log('Fetching all data...');
          const allData = await Data.find({});
            console.log('All data:', allData);
            res.status(200).json(allData.map((item) => ({
          _id: item._id,
          text: item.data.text,
          files: item.data.files ? item.data.files.map((f) => f.filename).join(', '): "",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })));
      } else {
        res.status(403).json({ message: 'Access denied. Admins only.' });
      }
    } catch (error) {
      console.error("Error fetching all data:", error);
      res.status(500).json({ message: error.message });
    }
  };

module.exports = { getHashData, getPaymentMethods, getAllData };