const { SESv2Client, SendEmailCommand, GetAccountCommand } = require('@aws-sdk/client-sesv2');
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

// Reuses the same AWS credentials already configured for DynamoDB/S3 (see
// backend/config/.env / Render env vars) — no separate SES-specific
// credential is required, though AWS_SES_REGION lets SES run in a different
// region than the rest of the app if ever needed (defaults to AWS_REGION).
const client = new SESv2Client({
  region: process.env.AWS_SES_REGION || process.env.AWS_REGION,
});

if (!process.env.FROM_EMAIL) {
  logger.warn('⚠️  FROM_EMAIL not configured. SES sends will fail — no verified sender identity to use.');
}

/**
 * Report whether email sending is actually configured and reachable, without
 * exposing any credentials. Lets an admin confirm SES is out of sandbox mode
 * and reachable, without needing AWS console access or sending a real email.
 * @returns {Promise<Object>} Sanitized status — no secrets included.
 */
const getEmailServiceStatus = async () => {
  const status = {
    fromEmailConfigured: !!process.env.FROM_EMAIL,
    fromEmail: process.env.FROM_EMAIL || null,
    sesReachable: false,
    sendingEnabled: null,
    productionAccessEnabled: null,
    max24HourSend: null,
    sentLast24Hours: null,
    error: null
  };

  try {
    // GetAccount is a read-only call — confirms credentials are valid and
    // reachable, and reports sandbox vs. production status without sending
    // any email. While ProductionAccessEnabled is false, SES can only send
    // to recipient addresses/domains that have themselves been verified.
    const account = await client.send(new GetAccountCommand({}));
    status.sesReachable = true;
    status.sendingEnabled = account.SendingEnabled ?? null;
    status.productionAccessEnabled = account.ProductionAccessEnabled ?? null;
    status.max24HourSend = account.SendQuota?.Max24HourSend ?? null;
    status.sentLast24Hours = account.SendQuota?.SentLast24Hours ?? null;
  } catch (error) {
    status.error = error.message || String(error);
  }

  return status;
};

/**
 * Send an email using AWS SES
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
      return { MessageId: 'test-funnel-captured', Message: 'Captured by test funnel' };
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

    // Send the email using AWS SES. ConfigurationSetName routes bounce/
    // complaint events to the SNS topic set up for suppression/monitoring
    // (see docs/guides or AWS SES console: configuration set "default").
    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET || 'default',
      Content: {
        Simple: {
          Subject: { Data: emailContent.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: emailContent.html, Charset: 'UTF-8' },
            Text: { Data: emailContent.text, Charset: 'UTF-8' },
          },
        },
      },
    }));

    logger.debug(`Email sent successfully with ID: ${result.MessageId}`);
    return result;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};

module.exports = { sendEmail, getEmailServiceStatus };
