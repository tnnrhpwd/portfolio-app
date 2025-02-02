// controllers/index.js

const {setData,upload} = require('./setData');
const {getData, getPublicData, getAllData} = require('./getData');
const {updateData} = require('./updateData');
const {compressData} = require('./compressData');
const {deleteData} = require('./deleteData');
const {registerUser} = require('./registerUser');
const {loginUser} = require('./loginUser');
const Data = require('../models/dataModel');

module.exports = {
  setData,
  upload,
  getData,
  getPublicData,
  updateData,
  compressData,
  deleteData,
  registerUser,
  loginUser,
  getAllData,
};
