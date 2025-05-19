const path = require('path'); // module to read file locations
const express = require('express'); // import express to create REST API server
const colors = require('colors'); // allows the console to print colored text
const dotenv = require('dotenv').config();   // import env vars from .env
const { errorHandler } = require('./middleware/errorMiddleware');    // creates json of error
const port = process.env.PORT || 5000;  //set port to hold api server
var cors = require('cors')

const app = express() // Calls the express function "express()" and puts new Express application inside the app variable

// app.use adds middleware to the data routes
app.use(cors())
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/data', require('./routes/routeData')) // serve all data at /api/data (regardless of hit url)

app.use(errorHandler) // adds middleware that returns errors in json format (regardless of hit url)

  console.log('Connected to DynamoDB');  // print confirmation
  const server = app.listen(port, () => console.log(`Server started on port ${port}`)); // listen for incoming http requests on the PORT && print PORT in console
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
      process.exit(1);
    } else {
      throw err;
    }
  });