// controllers/index.js

const {setData, upload} = require('./setData');
const {getData, getPublicData} = require('./getData');
const {updateData} = require('./updateData');
const {deleteData} = require('./deleteData');
const {registerUser} = require('./registerUser');
const {loginUser} = require('./loginUser');

module.exports = {
  setData,
  upload,
  getData,
  getPublicData,
  updateData,
  deleteData,
  registerUser,
  loginUser
};
