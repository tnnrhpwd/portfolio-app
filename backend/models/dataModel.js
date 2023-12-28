const mongoose = require('mongoose') // MVC library - used to communicate with MongoDB

// Schema of each data entry ( object attributes ) => exported to dataController ( object methods/functions )  => exported to dataRoutes
const dataSchema = mongoose.Schema(
  {
    data: {
      type: String,
      required: [true, 'Please add a text value'],
    },
  },
  {
    timestamps: true,
  }
)

module.exports = mongoose.model('Data', dataSchema) // exported to controller to create callback functions, which are executed from routes
