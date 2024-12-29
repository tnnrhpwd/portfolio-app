const mongoose = require('mongoose'); // MVC library - used to communicate with MongoDB

// Schema of each data entry (object attributes) => exported to dataController (object methods/functions) => exported to dataRoutes
const dataSchema = new mongoose.Schema(
  {
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Please add a value'],
    },
  },
  {
    timestamps: true,
    collection: 'data', // Name of the collection in the database
  }
);
// 1st param below is the name of the collection in the database, 2nd param is the schema defined above: 
module.exports = mongoose.model('data', dataSchema); // Exported to controller to create callback functions, which are executed from routes
