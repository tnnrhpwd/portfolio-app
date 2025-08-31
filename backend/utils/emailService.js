const postmark = require('postmark');
const {
  passwordResetTemplate,
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate
} = require('./emailTemplates');

// Create a client using the server token
const client = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);

/**
 * Send an email using Postmark
 * @param {string} to - Recipient email address
 * @param {string} templateName - Name of the email template to use
 * @param {Object} data - Data to be used in the template
 * @returns {Promise} Promise resolving to the send result
 */
const sendEmail = async (to, templateName, data) => {
  try {
    let emailContent;
    
    // Select template based on template name
    switch (templateName) {
      case 'passwordReset':
        emailContent = passwordResetTemplate(data);
        break;
      case 'subscriptionCreated':
        emailContent = subscriptionCreatedTemplate(data);
        break;
      case 'subscriptionUpdated':
        emailContent = subscriptionUpdatedTemplate(data);
        break;
      case 'subscriptionCancelled':
        emailContent = subscriptionCancelledTemplate(data);
        break;
      default:
        throw new Error(`Unknown email template: ${templateName}`);
    }
    
    // Send the email using Postmark
    const result = await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: emailContent.subject,
      HtmlBody: emailContent.html,
      TextBody: emailContent.text,
      MessageStream: 'outbound'
    });
    
    console.log(`Email sent successfully with ID: ${result.MessageID}`);
    return result;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = { sendEmail };
