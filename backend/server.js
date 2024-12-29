const path = require('path'); // module to read file locations
const express = require('express'); // import express to create REST API server
const colors = require('colors'); // allows the console to print colored text
const dotenv = require('dotenv').config();   // import env vars from .env
const { errorHandler } = require('./middleware/errorMiddleware');    // creates json of error
const connectDB = require('./config/db'); // connect to MongoDB using Mongooose
const { default: mongoose } = require('mongoose');
const port = process.env.PORT || 5000;  //set port to hold api server
var cors = require('cors')
const bodyParser = require('body-parser'); // import body-parser

connectDB()// this async function connects to Mongo database using Mongoose | RAN ON SERVER INITIALIZATION

const app = express() // Calls the express function "express()" and puts new Express application inside the app variable

// app.use adds middleware to the data routes
app.use(cors())
app.use(bodyParser.json({ limit: "50mb" })) // adds middleware that parses json requests and moves data into the request body (regardless of hit url)
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true, parameterLimit: 50000 })) // parses data using query-string library rather than qs library (regardless of hit url)

app.use('/api/data', require('./routes/routeData')) // serve all data at /api/data (regardless of hit url)

app.use(errorHandler) // adds middleware that returns errors in json format (regardless of hit url)

// IF MongoDB connected, 
mongoose.connection.once('open', () => {
  console.log('Connected to MongoDB');  // print confirmation
  app.listen(port, () => console.log(`Server started on port ${port}`)) // listen for incoming http requests on the PORT && print PORT in console
})
// IF MongoDB could not connect, 
mongoose.connection.once('closed',() => {
  console.log(`Unable to connect to MongoDB.`.red) // print error
})