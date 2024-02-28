// getData.js
// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
require('dotenv').config();
const asyncHandler = require('express-async-handler') // sends the errors to the errorhandler
const fetch = require('node-fetch');
const Data = require('../models/dataModel')
// const getData = require('./getData');
const wordBaseUrl = 'https://random-word-api.p.rapidapi.com/L/';
const defBaseUrl = 'https://mashape-community-urban-dictionary.p.rapidapi.com/define?term=';
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
    res.status(401)
    throw new Error('User not found')
  }

  if (!req.query || !req.query.data) {
    res.status(400)
    throw new Error('Please add a text field')
  }

  try {
    const dataSearchString = req.query.data.toLowerCase();
    const userSearchString = req.user.id.toLowerCase();
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

    }  else if (dataSearchString.startsWith("getdef:")) {      // Handle "getdef:" request
      const word = dataSearchString.substring(7); // Extract the word from dataSearchString
      const defUrl = `${defBaseUrl}${word}`;

      const response = await fetch(defUrl, rapidapidefoptions);
      // if (response) {
      if (!response.ok) {
        throw new Error('Failed to fetch definition from rapidapi');
      }
      const data = await response.json();
      const definition = data.list[0].definition + data.list[1].definition + data.list[2].definition;
      // const dataString = JSON.stringify(data);
      res.status(200).json({ worddef: definition }); // Return the definition

    } else {      // Handle database search requests
      const datas = await Data.find({
        $and: [
          { data: { $regex: dataSearchString, $options: 'i' } },
          { user: userSearchString },
        ],
      });

      if (dataSearchString === "net:") {
        res.status(200).json({ data: datas.map((data) => `${data._id} ${data.data}`) });
      } else {
        res.status(200).json({ data: datas.map((data) => data.data) });
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

module.exports = { getData };