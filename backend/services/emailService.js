const postmark = require('postmark');
const {
  passwordResetTemplate,
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate
} = require('./emailTemplates');
const { logger } = require('../utils/logger');

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

// Create a client using the server token (only if token is provided).
// Accepts either POSTMARK_API_TOKEN (original name) or POSTMARK_SERVER_API_TOKEN
// (the name Postmark's own docs/dashboard use to distinguish it from an
// Account API token) so a env-var rename on one side (local .env vs. the
// Render dashboard) can't silently disable email sending.
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_API_TOKEN || process.env.POSTMARK_SERVER_API_TOKEN;
let client = null;
if (POSTMARK_SERVER_TOKEN) {
  client = new postmark.ServerClient(POSTMARK_SERVER_TOKEN);
} else {
  logger.warn('⚠️  POSTMARK_API_TOKEN / POSTMARK_SERVER_API_TOKEN not configured. Email functionality will be disabled.');
}

if (client && !process.env.FROM_EMAIL) {
  logger.warn('⚠️  FROM_EMAIL not configured. Postmark sends will fail with "Invalid \'From\' value".');
}

/**
 * Report whether email sending is actually configured and reachable, without
 * exposing the API token itself. Lets an admin confirm production env vars
 * (POSTMARK_API_TOKEN / FROM_EMAIL) are set correctly and Postmark accepts
 * them, without needing dashboard/host access or sending a real email.
 * @returns {Promise<Object>} Sanitized status — no secrets included.
 */
const getEmailServiceStatus = async () => {
  const status = {
    tokenConfigured: !!POSTMARK_SERVER_TOKEN,
    fromEmailConfigured: !!process.env.FROM_EMAIL,
    fromEmail: process.env.FROM_EMAIL || null,
    postmarkReachable: false,
    serverName: null,
    deliveryType: null,
    error: null
  };

  if (!client) {
    status.error = 'POSTMARK_API_TOKEN / POSTMARK_SERVER_API_TOKEN not configured; client not initialized.';
    return status;
  }

  try {
    // getServer() is a read-only call — confirms the token is valid and the
    // account is reachable without sending any email.
    const server = await client.getServer();
    status.postmarkReachable = true;
    status.serverName = server.Name;
    status.deliveryType = server.DeliveryType;
  } catch (error) {
    status.error = error.message || String(error);
  }

  return status;
};

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
      logger.debug(`📧 [TEST FUNNEL] Captured email to ${to} (template: ${templateName})`);
      return { MessageID: 'test-funnel-captured', Message: 'Captured by test funnel' };
    }

    // If email client is not configured, log and skip
    if (!client) {
      logger.warn(`⚠️  Email would be sent to ${to} with template ${templateName}, but Postmark is not configured.`);
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Email data:', JSON.stringify(data, null, 2));
      }
      return { MessageID: 'dev-mode-skip', Message: 'Email service not configured' };
    }

    if (!process.env.FROM_EMAIL) {
      throw new Error('FROM_EMAIL environment variable is not configured; cannot send email.');
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
    
    logger.debug(`Email sent successfully with ID: ${result.MessageID}`);
    return result;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};

module.exports = { sendEmail, getEmailServiceStatus };
