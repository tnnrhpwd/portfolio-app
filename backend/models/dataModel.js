const mongoose = require('mongoose') // MVC library - used to communicate with MongoDB

// Schema of each data entry ( object attributes ) => exported to dataController ( object methods/functions )  => exported to dataRoutes
const dataSchema = mongoose.Schema(
  {
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Please add a value'],
    },
  },
  {
    timestamps: true,
  }
)

module.exports = mongoose.model('Data', dataSchema) // exported to controller to create callback functions, which are executed from routes
