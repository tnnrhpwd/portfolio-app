const postmark = require('postmark');
require('dotenv').config();

// Initialize Postmark client
const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);

// Email templates
const templates = {
  subscriptionCreated: {
    subject: 'Welcome to Your Subscription!',
    templateId: 'subscription-created-template-id' // Replace with your Postmark template ID
  },
  subscriptionUpdated: {
    subject: 'Your Subscription Has Been Updated',
    templateId: 'subscription-updated-template-id' // Replace with your Postmark template ID
  },
  subscriptionCancelled: {
    subject: 'Your Subscription Has Been Cancelled',
    templateId: 'subscription-cancelled-template-id' // Replace with your Postmark template ID
  }
};

/**
 * Send an email using Postmark
 * @param {string} to - Recipient email address
 * @param {string} templateName - Name of the template to use (must be one of the keys in templates object)
 * @param {Object} data - Data to pass to the template
 * @returns {Promise} - Promise that resolves when email is sent
 */
const sendEmail = async (to, templateName, data) => {
  try {
    if (!templates[templateName]) {
      throw new Error(`Email template "${templateName}" not found`);
    }

    const template = templates[templateName];
    
    // Format data for template based on template type
    let templateModel = {};
    
    switch(templateName) {
      case 'subscriptionCreated':
        templateModel = {
          product_name: 'Your App',
          plan_name: data.plan,
          user_name: extractUserName(data.userData),
          action_url: 'https://yourdomain.com/account',
          current_date: new Date().toLocaleDateString()
        };
        break;
      
      case 'subscriptionUpdated':
        templateModel = {
          product_name: 'Your App',
          old_plan_name: data.oldPlan,
          new_plan_name: data.newPlan,
          user_name: extractUserName(data.userData),
          action_url: 'https://yourdomain.com/account',
          current_date: new Date().toLocaleDateString()
        };
        break;
      
      case 'subscriptionCancelled':
        templateModel = {
          product_name: 'Your App',
          plan_name: data.plan,
          user_name: extractUserName(data.userData),
          action_url: 'https://yourdomain.com/account',
          current_date: new Date().toLocaleDateString()
        };
        break;
      
      default:
        templateModel = data;
    }

    // Send the email via Postmark
    const result = await client.sendEmailWithTemplate({
      From: `${process.env.POSTMARK_FROM_NAME} <${process.env.POSTMARK_FROM_EMAIL}>`,
      To: to,
      TemplateId: template.templateId,
      TemplateModel: templateModel
    });

    console.log(`Email sent: ${result.MessageID}`);
    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
};

/**
 * Extract user name from userData object
 * @param {Object} userData - User data object
 * @returns {string} - User name
 */
const extractUserName = (userData) => {
  try {
    if (userData && userData.text) {
      const text = userData.text;
      const nicknameMatch = text.match(/Nickname:([^|]+)/);
      if (nicknameMatch && nicknameMatch[1]) {
        return nicknameMatch[1].trim();
      }
    }
    return 'Valued Customer';
  } catch (error) {
    console.error('Error extracting user name:', error);
    return 'Valued Customer';
  }
};

module.exports = { sendEmail };
