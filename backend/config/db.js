const mongoose = require('mongoose');   // Object Data Modeling (ODM) library for MongoDB and Node. js

// this async function connects to Mongo database using Mongoose => exported to server.js | RAN ON SERVER INITIALIZATION
const connectDB = async () => {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI)
  
      console.log(`MongoDB Connected: ${conn.connection.host}`.cyan.underline)
    } catch (error) {
      console.log(error)
      process.exit(1)
    }
  }
  
  module.exports = connectDB