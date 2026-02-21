const postmark = require('postmark');
const {
  passwordResetTemplate,
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate
} = require('./emailTemplates');

// Lazy-loaded test funnel hook — avoids circular require at module load
let _interceptTestEmail = null;
function getInterceptor() {
  if (_interceptTestEmail === null) {
    try {
      _interceptTestEmail = require('../controllers/testFunnelController').interceptTestEmail;
    } catch (_) {
      _interceptTestEmail = false; // module not available
    }
  }
  return _interceptTestEmail || null;
}

// Create a client using the server token (only if token is provided)
let client = null;
if (process.env.POSTMARK_API_TOKEN) {
  client = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
} else {
  console.warn('⚠️  POSTMARK_API_TOKEN not configured. Email functionality will be disabled.');
}

/**
 * Send an email using Postmark
 * @param {string} to - Recipient email address
 * @param {string} templateName - Name of the email template to use
 * @param {Object} data - Data to be used in the template
 * @returns {Promise} Promise resolving to the send result
 */
const sendEmail = async (to, templateName, data) => {
  try {
    // Test-funnel intercept — capture instead of sending
    const intercept = getInterceptor();
    if (intercept && intercept(to, templateName, data)) {
      console.log(`📧 [TEST FUNNEL] Captured email to ${to} (template: ${templateName})`);
      return { MessageID: 'test-funnel-captured', Message: 'Captured by test funnel' };
    }

    // If email client is not configured, log and skip
    if (!client) {
      console.warn(`⚠️  Email would be sent to ${to} with template ${templateName}, but Postmark is not configured.`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Email data:', JSON.stringify(data, null, 2));
      }
      return { MessageID: 'dev-mode-skip', Message: 'Email service not configured' };
    }

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
