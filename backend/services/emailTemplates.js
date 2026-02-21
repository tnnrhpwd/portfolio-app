/**
 * Email templates for user subscription events
 */
const { FEATURES_PLAIN, isSimpleTier, isProTier } = require('../constants/pricing');

/**
 * Get plain-text feature bullets for a plan (for emails).
 * @param {string} plan - Plan name (e.g. 'Simple', 'Pro', 'Free', 'Premium', 'Flex')
 * @returns {string[]} Array of feature strings
 */
function getPlanFeatures(plan) {
  const lc = plan.toLowerCase();
  if (isSimpleTier(plan) || lc === 'simple') return FEATURES_PLAIN.simple;
  if (isProTier(plan) || lc === 'pro') return FEATURES_PLAIN.pro;
  return FEATURES_PLAIN.free;
}

/** HTML <li> list from plan features */
function featuresHtml(plan) {
  return getPlanFeatures(plan).map(f => `<li>${f}</li>`).join('\n                ');
}

/** Plain-text bullet list from plan features */
function featuresText(plan) {
  return getPlanFeatures(plan).map(f => `- ${f}`).join('\n');
}

// Template for password reset
const passwordResetTemplate = (data) => {
  const { resetLink, userNickname, requestInfo } = data;
  
  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: requestInfo?.location?.timezone || 'UTC'
    });
  };

  const formattedTime = requestInfo ? formatTimestamp(requestInfo.timestamp) : 'Unknown time';
  
  return {
    subject: 'Password Reset Request',
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
        }
        .header {
          background-color: #4a6fa5;
          padding: 20px;
          text-align: center;
          color: white;
          border-radius: 5px 5px 0 0;
        }
        .content {
          padding: 20px;
          border: 1px solid #e9e9e9;
          border-top: none;
          border-radius: 0 0 5px 5px;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #999;
        }
        .button {
          display: inline-block;
          padding: 15px 25px;
          background-color: #4a6fa5;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin: 20px 0;
          font-weight: bold;
        }
        .warning {
          background-color: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 4px;
          padding: 15px;
          margin: 20px 0;
        }
        .security-note {
          background-color: #f8f9fa;
          border-left: 4px solid #4a6fa5;
          padding: 15px;
          margin: 20px 0;
        }
        .request-info {
          background-color: #f0f7ff;
          border: 1px solid #b8daff;
          border-radius: 4px;
          padding: 15px;
          margin: 20px 0;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        .info-table td {
          padding: 5px 10px;
          border-bottom: 1px solid #e9e9e9;
        }
        .info-table td:first-child {
          font-weight: bold;
          width: 30%;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <h2>Hello ${userNickname || 'valued user'},</h2>
          <p>We received a request to reset your password for your ST Hopwood account.</p>
          
          <p>Click the button below to reset your password:</p>
          
          <div style="text-align: center;">
            <a href="${resetLink}" class="button">Reset My Password</a>
          </div>
          
          <div class="warning">
            <p><strong>⚠️ Important:</strong> This link will expire in 1 hour for security reasons.</p>
          </div>

          ${requestInfo ? `
          <div class="request-info">
            <h3>🔍 Request Details:</h3>
            <p>For your security, here are the details of this password reset request:</p>
            <table class="info-table">
              <tr>
                <td>Time:</td>
                <td>${formattedTime}</td>
              </tr>
              <tr>
                <td>IP Address:</td>
                <td>${requestInfo.ipAddress}</td>
              </tr>
              <tr>
                <td>Location:</td>
                <td>${requestInfo.location.city}, ${requestInfo.location.region}, ${requestInfo.location.country}</td>
              </tr>
              <tr>
                <td>Browser:</td>
                <td>${requestInfo.device.browser}</td>
              </tr>
              <tr>
                <td>Operating System:</td>
                <td>${requestInfo.device.os}</td>
              </tr>
            </table>
          </div>
          ` : ''}
          
          <div class="security-note">
            <h3>Security Information:</h3>
            <ul>
              <li>If you didn't request this password reset from the above location, please ignore this email and contact our support team immediately</li>
              <li>Your password won't change until you click the link above and create a new one</li>
              <li>For your security, this link can only be used once</li>
              <li>Never share this email or reset link with anyone</li>
            </ul>
          </div>
          
          <p>If the button above doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #4a6fa5;">${resetLink}</p>
          
          <p>If you continue to have trouble, please contact our support team.</p>
          
          <p>Best regards,<br>The ST Hopwood Team</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ST Hopwood. All rights reserved.</p>
          <p>This email was sent because a password reset was requested for your account.</p>
        </div>
      </div>
    </body>
    </html>
    `,
    text: `Hello ${userNickname || 'valued user'},

We received a request to reset your password for your ST Hopwood account.

To reset your password, visit this link: ${resetLink}

⚠️ Important: This link will expire in 1 hour for security reasons.

REQUEST DETAILS:
${requestInfo ? `
Time: ${formattedTime}
IP Address: ${requestInfo.ipAddress}
Location: ${requestInfo.location.city}, ${requestInfo.location.region}, ${requestInfo.location.country}
Browser: ${requestInfo.device.browser}
Operating System: ${requestInfo.device.os}
` : 'Request details not available'}

Security Information:
- If you didn't request this password reset from the above location, please ignore this email and contact our support team immediately
- Your password won't change until you click the link above and create a new one
- For your security, this link can only be used once
- Never share this email or reset link with anyone

If you continue to have trouble, please contact our support team.

Best regards,
The ST Hopwood Team

© ${new Date().getFullYear()} ST Hopwood. All rights reserved.
This email was sent because a password reset was requested for your account.`
  };
};

// Template for when a user creates a new subscription
const subscriptionCreatedTemplate = (data) => {
  const { plan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'valued customer';
  
  return {
    subject: `Welcome to ${plan} Membership!`,
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subscription Confirmation</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
        }
        .header {
          background-color: #4a6fa5;
          padding: 20px;
          text-align: center;
          color: white;
          border-radius: 5px 5px 0 0;
        }
        .content {
          padding: 20px;
          border: 1px solid #e9e9e9;
          border-top: none;
          border-radius: 0 0 5px 5px;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #999;
        }
        .button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #4a6fa5;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin-top: 15px;
        }
        .highlights {
          background-color: #f8f9fa;
          border-left: 4px solid #4a6fa5;
          padding: 15px;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Confirmed!</h1>
        </div>
        <div class="content">
          <h2>Hello ${userNickname},</h2>
          <p>Thank you for subscribing to our <strong>${plan} Plan</strong>! Your subscription is now active.</p>
          
          <div class="highlights">
            <h3>Your ${plan} Benefits:</h3>
            <ul>
              ${featuresHtml(plan)}
            </ul>
          </div>
          
          <p>You can manage your subscription at any time through your account settings.</p>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <a href="https://www.sthopwood.com/account" class="button">Manage Your Account</a>
          
          <p>Best regards,<br>The ST Hopwood Team</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ST Hopwood. All rights reserved.</p>
          <p>This email was sent to you because you subscribed to our service.</p>
        </div>
      </div>
    </body>
    </html>
    `,
    text: `Hello ${userNickname},
    
Thank you for subscribing to our ${plan} Plan! Your subscription is now active.

Your ${plan} Benefits:
${featuresText(plan)}

You can manage your subscription at any time through your account settings.

If you have any questions or need assistance, please don't hesitate to contact our support team.

Best regards,
The ST Hopwood Team

© ${new Date().getFullYear()} ST Hopwood. All rights reserved.
This email was sent to you because you subscribed to our service.`
  };
};

// Template for when a user updates their subscription plan
const subscriptionUpdatedTemplate = (data) => {
  const { oldPlan, newPlan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'valued customer';
  
  return {
    subject: `Your Subscription Has Been Updated to ${newPlan}`,
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subscription Update</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
        }
        .header {
          background-color: #5e8b7e;
          padding: 20px;
          text-align: center;
          color: white;
          border-radius: 5px 5px 0 0;
        }
        .content {
          padding: 20px;
          border: 1px solid #e9e9e9;
          border-top: none;
          border-radius: 0 0 5px 5px;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #999;
        }
        .button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #5e8b7e;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin-top: 15px;
        }
        .highlights {
          background-color: #f8f9fa;
          border-left: 4px solid #5e8b7e;
          padding: 15px;
          margin: 20px 0;
        }
        .comparison {
          display: flex;
          margin: 20px 0;
          border: 1px solid #e9e9e9;
          border-radius: 5px;
          overflow: hidden;
        }
        .plan-column {
          flex: 1;
          padding: 15px;
        }
        .old-plan {
          background-color: #f8f9fa;
          border-right: 1px solid #e9e9e9;
        }
        .new-plan {
          background-color: #f0f7f4;
        }
        .plan-header {
          text-align: center;
          font-weight: bold;
          margin-bottom: 10px;
          padding-bottom: 10px;
          border-bottom: 1px solid #e9e9e9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Updated</h1>
        </div>
        <div class="content">
          <h2>Hello ${userNickname},</h2>
          <p>Your subscription has been successfully updated from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>!</p>
          
          <div class="comparison">
            <div class="plan-column old-plan">
              <div class="plan-header">${oldPlan} Plan (Previous)</div>
              <ul>
                ${featuresHtml(oldPlan)}
              </ul>
            </div>
            <div class="plan-column new-plan">
              <div class="plan-header">${newPlan} Plan (New)</div>
              <ul>
                ${featuresHtml(newPlan)}
              </ul>
            </div>
          </div>
          
          <p>Your billing will be updated accordingly. You can manage your subscription at any time through your account settings.</p>
          
          <p>If you have any questions about your new plan or need assistance, please contact our support team.</p>
          
          <a href="https://www.sthopwood.com/account" class="button">Manage Your Account</a>
          
          <p>Best regards,<br>The ST Hopwood Team</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ST Hopwood. All rights reserved.</p>
          <p>This email was sent to you because you updated your subscription plan.</p>
        </div>
      </div>
    </body>
    </html>
    `,
    text: `Hello ${userNickname},

Your subscription has been successfully updated from ${oldPlan} to ${newPlan}!

Previous ${oldPlan} Plan:
${featuresText(oldPlan)}

New ${newPlan} Plan:
${featuresText(newPlan)}

Your billing will be updated accordingly. You can manage your subscription at any time through your account settings.

If you have any questions about your new plan or need assistance, please contact our support team.

Best regards,
The ST Hopwood Team

© ${new Date().getFullYear()} ST Hopwood. All rights reserved.
This email was sent to you because you updated your subscription plan.`
  };
};

// Template for when a user cancels their subscription
const subscriptionCancelledTemplate = (data) => {
  const { plan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'valued customer';
  
  return {
    subject: 'Your Subscription Has Been Cancelled',
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subscription Cancellation</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
        }
        .header {
          background-color: #7d8597;
          padding: 20px;
          text-align: center;
          color: white;
          border-radius: 5px 5px 0 0;
        }
        .content {
          padding: 20px;
          border: 1px solid #e9e9e9;
          border-top: none;
          border-radius: 0 0 5px 5px;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #999;
        }
        .button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #7d8597;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin-top: 15px;
        }
        .message-box {
          background-color: #f8f9fa;
          border-left: 4px solid #7d8597;
          padding: 15px;
          margin: 20px 0;
        }
        .resubscribe {
          background-color: #f0f7f4;
          border: 1px solid #d1e7dd;
          border-radius: 5px;
          padding: 15px;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Cancelled</h1>
        </div>
        <div class="content">
          <h2>Hello ${userNickname},</h2>
          <p>Your ${plan} subscription has been successfully cancelled. Your account has been downgraded to the free plan.</p>
          
          <div class="message-box">
            <h3>What This Means:</h3>
            <ul>
              <li>You will no longer be billed for the ${plan} plan</li>
              <li>You now have access to free plan features only</li>
              <li>Your account data has been preserved</li>
            </ul>
          </div>
          
          <p>We're sorry to see you go! If you have a moment, we'd appreciate it if you could let us know why you decided to cancel so we can continue to improve our service.</p>
          
          <div class="resubscribe">
            <h3>Changed Your Mind?</h3>
            <p>You can resubscribe at any time to regain access to premium features.</p>
            <a href="https://www.sthopwood.com/pricing" class="button">View Subscription Options</a>
          </div>
          
          <p>If you have any questions or feedback, please don't hesitate to contact our support team.</p>
          
          <p>Best regards,<br>The ST Hopwood Team</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ST Hopwood. All rights reserved.</p>
          <p>This email was sent to you because you cancelled your subscription.</p>
        </div>
      </div>
    </body>
    </html>
    `,
    text: `Hello ${userNickname},

Your ${plan} subscription has been successfully cancelled. Your account has been downgraded to the free plan.

What This Means:
- You will no longer be billed for the ${plan} plan
- You now have access to free plan features only
- Your account data has been preserved

We're sorry to see you go! If you have a moment, we'd appreciate it if you could let us know why you decided to cancel so we can continue to improve our service.

Changed Your Mind?
You can resubscribe at any time to regain access to premium features.
Visit: https://www.sthopwood.com/pricing

If you have any questions or feedback, please don't hesitate to contact our support team.

Best regards,
The ST Hopwood Team

© ${new Date().getFullYear()} ST Hopwood. All rights reserved.
This email was sent to you because you cancelled your subscription.`
  };
};

module.exports = {
  passwordResetTemplate,
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate
};
