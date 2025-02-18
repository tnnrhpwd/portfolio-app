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
const { checkIP } = require('../utils/accessData.js');

// @desc    Get Public Data
// @route   GET /api/publicdata
// @access  Public
const getPublicData = asyncHandler(async (req, res) => {
    await checkIP(req);
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
                ]
            },
            {
                $or: [
                    { 'data.text': { $regex: dataSearchString, $options: 'i' } },
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
                _id: data._id,
                ActionGroup: data.ActionGroup // ← Added
            }))
        });    } catch (error) {
        console.error("Error fetching public data:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

const getAllData = async (req, res) => {
  try {
    // Check if the user is an admin
    // console.log('User:', req.user);
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

module.exports = { getPublicData, getAllData };