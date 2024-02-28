const jwt = require('jsonwebtoken') //import json web tokens to send to user on login -- this token will be read when user request user details -- confirms same user

// Generate JWT -- sent to user after register + sign in. User stores this token and send it back inside the header on following requests.
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    })
}

module.exports = { generateToken };