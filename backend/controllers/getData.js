require('dotenv').config();
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const fetch = require('node-fetch');
const Data = require('../models/dataModel');
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

// @desc    Get Data
// @route   GET /api/data
// @access  Private
const getData = asyncHandler(async (req, res) => {
    if (!req.user) {  // Check for user
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

                const searchConditions = [
                    {
                        $or: [
                            { 'data.text': { $regex: "\\|Public:true", $options: 'i' } },
                            { 'data': { $regex: "\\|Public:true", $options: 'i' } },
                            { 'data.text': { $regex: userSearchString, $options: 'i' } },
                            { 'data': { $regex: userSearchString, $options: 'i' } }
                        ]
                    },
                    {
                        $or: [
                            { 'data.text': { $regex: dataSearchString, $options: 'i' } },
                            { 'data': { $regex: dataSearchString, $options: 'i' } },
                        ]
                    }
                ];
                
                if (ObjectId.isValid(dataSearchString)) {
                    searchConditions[1].$or.push({ _id: ObjectId(dataSearchString) });
                }

                const dataList = await Data.find({ $and: searchConditions });

                res.status(200).json({
                    data: dataList.map((data) => ({
                        data: data.data,
                        files: data.files,
                        updatedAt: data.updatedAt,
                        createdAt: data.createdAt,
                        __v: data.__v,
                        _id: data._id
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

// @desc    Get Public Data
// @route   GET /api/publicdata
// @access  Public
const getPublicData = asyncHandler(async (req, res) => {
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

        const searchConditions = [
            {
                $or: [
                    { 'data.text': { $regex: "\\|Public:true", $options: 'i' } },
                    { 'data': { $regex: "\\|Public:true", $options: 'i' } },
                ]
            },
            {
                $or: [
                    { 'data.text': { $regex: dataSearchString, $options: 'i' } },
                    { 'data': { $regex: dataSearchString, $options: 'i' } },
                ]
            }
        ];
        
        if (ObjectId.isValid(dataSearchString)) {
            searchConditions[1].$or.push({ _id: ObjectId(dataSearchString) });
        }
        
        const dataList = await Data.find({ $and: searchConditions });

        res.status(200).json({
            data: dataList.map((data) => ({
                data: data.data,
                files: data.files,
                updatedAt: data.updatedAt,
                createdAt: data.createdAt,
                __v: data.__v,
                _id: data._id
            }))
        });    } catch (error) {
        console.error("Error fetching public data:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = { getData, getPublicData };