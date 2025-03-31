const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter with environment variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Email templates for different subscription events
const emailTemplates = {
  subscriptionCreated: (plan, userDetails) => ({
    subject: `Your ${plan} Subscription Has Been Activated`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h2 style="color: #4f9cf9;">Welcome to Your ${plan} Subscription!</h2>
        <p>Hello ${userDetails.name || 'there'},</p>
        <p>Thank you for subscribing to our <strong>${plan}</strong> plan. Your subscription is now active.</p>
        <p>Subscription details:</p>
        <ul>
          <li>Plan: ${plan}</li>
          <li>Start date: ${new Date().toLocaleDateString()}</li>
        </ul>
        <p>You can manage your subscription anytime through your profile page.</p>
        <p>If you have any questions, please don't hesitate to contact our support team.</p>
        <p>Thank you for your support!</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eaeaea;">
          <p style="font-size: 12px; color: #666;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `
  }),
  
  subscriptionUpdated: (oldPlan, newPlan, userDetails) => ({
    subject: `Your Subscription Has Been Updated to ${newPlan}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h2 style="color: #4f9cf9;">Subscription Update Confirmation</h2>
        <p>Hello ${userDetails.name || 'there'},</p>
        <p>Your subscription has been successfully updated from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.</p>
        <p>The changes are effective immediately.</p>
        <p>You can manage your subscription anytime through your profile page.</p>
        <p>If you have any questions, please don't hesitate to contact our support team.</p>
        <p>Thank you for your continued support!</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eaeaea;">
          <p style="font-size: 12px; color: #666;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `
  }),
  
  subscriptionCancelled: (plan, userDetails) => ({
    subject: 'Your Subscription Has Been Cancelled',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h2 style="color: #4f9cf9;">Subscription Cancellation Confirmation</h2>
        <p>Hello ${userDetails.name || 'there'},</p>
        <p>Your <strong>${plan}</strong> subscription has been cancelled successfully.</p>
        <p>You have been moved to the Free tier, and you will no longer be billed.</p>
        <p>We're sorry to see you go! If you wish to resubscribe in the future, you can do so anytime through your profile page.</p>
        <p>If you have any feedback on how we can improve our service, we'd love to hear from you.</p>
        <p>Thank you for your past support!</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eaeaea;">
          <p style="font-size: 12px; color: #666;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `
  })
};

/**
 * Send an email notification
 * @param {string} to - Recipient email address
 * @param {string} template - Template name (subscriptionCreated, subscriptionUpdated, subscriptionCancelled)
 * @param {Object} data - Data for the template
 * @returns {Promise} - Email sending result
 */
const sendEmail = async (to, template, data) => {
  try {
    // Extract user details from text field if available
    const userDetails = {
      name: data.name || extractNameFromUserData(data.userData) || '',
      email: to
    };
    
    let emailContent;
    
    // Select the appropriate template
    switch (template) {
      case 'subscriptionCreated':
        emailContent = emailTemplates.subscriptionCreated(data.plan, userDetails);
        break;
      case 'subscriptionUpdated':
        emailContent = emailTemplates.subscriptionUpdated(data.oldPlan, data.newPlan, userDetails);
        break;
      case 'subscriptionCancelled':
        emailContent = emailTemplates.subscriptionCancelled(data.plan, userDetails);
        break;
      default:
        throw new Error(`Email template "${template}" not found`);
    }
    
    // Configure email options
    const mailOptions = {
      from: `"MyApp Support" <${process.env.EMAIL_USER}>`,
      to,
      subject: emailContent.subject,
      html: emailContent.html
    };
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return info;
    
  } catch (error) {
    console.error('Error sending email:', error);
    // Don't throw so the main function continues even if email fails
    return { error: error.message };
  }
};

// Helper function to extract name from user data text
const extractNameFromUserData = (userData) => {
  if (!userData || !userData.text) return null;
  
  // Try to extract nickname from user data
  const nicknameMatch = userData.text.match(/Nickname:([^|]+)/);
  if (nicknameMatch && nicknameMatch[1]) {
    return nicknameMatch[1].trim();
  }
  
  return null;
};

module.exports = { sendEmail };
