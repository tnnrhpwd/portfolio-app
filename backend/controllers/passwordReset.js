const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendEmail } = require('../utils/emailService');
const useragent = require('useragent');
const ipinfo = require('ipinfo');

// Initialize DynamoDB client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const dynamodb = DynamoDBDocumentClient.from(client);

/**
 * Get IP address and location information from request
 * @param {Object} req - Express request object
 * @returns {Object} IP and location information
 */
const getIPLocationInfo = async (req) => {
    // Extract IP address
    let ipAddress = req.headers['x-forwarded-for']
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress;

    if (ipAddress) {
        // Handle multiple IPs in the x-forwarded-for header
        ipAddress = ipAddress.split(',').shift().trim();
    }

    // Handle IPv6 localhost address
    if (ipAddress === '::1') {
        ipAddress = '127.0.0.1';
    } else if (req.headers['x-forwarded-for']) {
        ipAddress = req.headers['x-forwarded-for'].split(',')[0].trim();
    }

    // Extract user agent information
    const agent = useragent.parse(req.headers['user-agent']);
    const deviceInfo = {
        browser: agent.toAgent(),
        os: agent.os.toString(),
        device: agent.device.toString()
    };

    // Default location info
    let locationInfo = {
        city: 'Unknown',
        region: 'Unknown',
        country: 'Unknown',
        timezone: 'Unknown'
    };

    // Get geolocation information (skip for localhost)
    if (ipAddress && ipAddress !== '127.0.0.1') {
        try {
            const geoInfo = await new Promise((resolve, reject) => {
                ipinfo(ipAddress, (err, cLoc) => {
                    if (err) {
                        console.error('Error getting IP info:', err);
                        resolve(null);
                    } else {
                        resolve(cLoc);
                    }
                });
            });

            if (geoInfo) {
                locationInfo = {
                    city: geoInfo.city || 'Unknown',
                    region: geoInfo.region || 'Unknown',
                    country: geoInfo.country || 'Unknown',
                    timezone: geoInfo.timezone || 'Unknown'
                };
            }
        } catch (geoError) {
            console.error('Failed to get geolocation data:', geoError);
        }
    } else {
        // For localhost, use local information
        locationInfo = {
            city: 'Local Development',
            region: 'Local',
            country: 'Local',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }

    return {
        ipAddress,
        location: locationInfo,
        device: deviceInfo,
        timestamp: new Date().toISOString()
    };
};

/**
 * @desc    Send password reset email
 * @route   POST /api/data/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        res.status(400);
        throw new Error('Email is required');
    }

    // Get IP and location information
    const requestInfo = await getIPLocationInfo(req);

    try {
        // Find user by email
        const params = {
            TableName: 'Simple',
            FilterExpression: 'contains(#text, :emailValue)',
            ExpressionAttributeNames: {
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':emailValue': `Email:${email}`
            }
        };

        const result = await dynamodb.send(new ScanCommand(params));
        
        // Always return success to prevent email enumeration attacks
        // But only send email if user exists
        if (result.Items.length === 1) {
            const user = result.Items[0];
            const userText = user.text; // DynamoDBDocumentClient automatically handles the format
            
            // Extract user nickname
            const userNickname = userText.substring(userText.indexOf('Nickname:') + 9, userText.indexOf('|Email:'));
            
            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
            
            // Store reset token in database
            // Add or update reset token fields in the user's text
            let updatedText = userText;
            
            // Remove existing reset token fields if they exist
            updatedText = updatedText.replace(/\|ResetToken:[^|]*/, '');
            updatedText = updatedText.replace(/\|ResetTokenExpiry:[^|]*/, '');
            
            // Add new reset token fields
            updatedText += `|ResetToken:${resetToken}|ResetTokenExpiry:${resetTokenExpiry}`;
            
            const putParams = {
                TableName: 'Simple',
                Item: {
                    ...user, // Keep all existing data
                    text: updatedText, // Update the text
                    updatedAt: new Date().toISOString() // Update timestamp
                }
            };

            await dynamodb.send(new PutCommand(putParams));
            
            // Create reset link with proper environment detection
            const getBaseUrl = () => {
                if (process.env.NODE_ENV === 'production') {
                    return process.env.FRONTEND_URL || 'https://www.sthopwood.com';
                } else {
                    return process.env.FRONTEND_URL || 'http://localhost:3000';
                }
            };
            
            const resetLink = `${getBaseUrl()}/reset-password?token=${resetToken}`;
            
            // Send password reset email
            await sendEmail(email, 'passwordReset', {
                resetLink,
                userNickname: userNickname.trim(),
                requestInfo
            });
            
            console.log(`Password reset email sent to: ${email}`);
        } else {
            console.log(`Password reset attempted for non-existent email: ${email}`);
        }
        
        // Always return success to prevent email enumeration
        res.status(200).json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.'
        });
        
    } catch (error) {
        console.error('Error in forgotPassword:', error);
        res.status(500);
        throw new Error('Server error while processing password reset request');
    }
});

/**
 * @desc    Reset password with token
 * @route   POST /api/data/reset-password
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        res.status(400);
        throw new Error('Token and password are required');
    }

    if (password.length < 6) {
        res.status(400);
        throw new Error('Password must be at least 6 characters long');
    }

    try {
        // Find user by reset token
        const params = {
            TableName: 'Simple',
            FilterExpression: 'contains(#text, :tokenValue)',
            ExpressionAttributeNames: {
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':tokenValue': `ResetToken:${token}`
            }
        };

        const result = await dynamodb.send(new ScanCommand(params));
        
        if (result.Items.length !== 1) {
            res.status(400);
            throw new Error('Invalid or expired reset token');
        }

        const user = result.Items[0];
        const userText = user.text; // DynamoDBDocumentClient automatically handles the format
        
        // Extract reset token expiry
        const tokenExpiryMatch = userText.match(/\|ResetTokenExpiry:([^|]+)/);
        if (!tokenExpiryMatch) {
            res.status(400);
            throw new Error('Invalid reset token');
        }
        
        const tokenExpiry = new Date(tokenExpiryMatch[1]);
        if (tokenExpiry < new Date()) {
            res.status(400);
            throw new Error('Reset token has expired. Please request a new password reset.');
        }
        
        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Update user's password and remove reset token fields
        let updatedText = userText;
        
        // Replace the password
        if (updatedText.includes('|Birth:')) {
            // New format: Nickname:xxx|Email:xxx|Password:xxx|Birth:xxx|stripeid:xxx
            const passwordStart = updatedText.indexOf('|Password:') + 10;
            const passwordEnd = updatedText.indexOf('|Birth:');
            updatedText = updatedText.substring(0, passwordStart) + hashedPassword + updatedText.substring(passwordEnd);
        } else {
            // Old format: Nickname:xxx|Email:xxx|Password:xxx|stripeid:xxx
            const passwordStart = updatedText.indexOf('|Password:') + 10;
            const passwordEnd = updatedText.indexOf('|stripeid:');
            updatedText = updatedText.substring(0, passwordStart) + hashedPassword + updatedText.substring(passwordEnd);
        }
        
        // Remove reset token fields
        updatedText = updatedText.replace(/\|ResetToken:[^|]*/, '');
        updatedText = updatedText.replace(/\|ResetTokenExpiry:[^|]*/, '');
        
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...user, // Keep all existing data
                text: updatedText, // Update the text
                updatedAt: new Date().toISOString() // Update timestamp
            }
        };

        await dynamodb.send(new PutCommand(putParams));
        
        console.log(`Password reset successful for user: ${user.id}`);
        
        res.status(200).json({
            success: true,
            message: 'Password has been reset successfully'
        });
        
    } catch (error) {
        console.error('Error in resetPassword:', error);
        res.status(500);
        throw new Error('Server error while resetting password');
    }
});

module.exports = {
    forgotPassword,
    resetPassword
};
