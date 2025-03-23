/**
 * Email templates for user subscription events
 */

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
            ${plan.toLowerCase() === 'premium' ? `
            <ul>
              <li>Unlimited access to all premium features</li>
              <li>Priority customer support</li>
              <li>Advanced analytics and reporting</li>
              <li>Custom workflows and integrations</li>
            </ul>
            ` : `
            <ul>
              <li>Access to core premium features</li>
              <li>Standard customer support</li>
              <li>Basic analytics</li>
            </ul>
            `}
          </div>
          
          <p>You can manage your subscription at any time through your account settings.</p>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <a href="https://sthopwood.com/account" class="button">Manage Your Account</a>
          
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
${plan.toLowerCase() === 'premium' 
  ? '- Unlimited access to all premium features\n- Priority customer support\n- Advanced analytics and reporting\n- Custom workflows and integrations' 
  : '- Access to core premium features\n- Standard customer support\n- Basic analytics'}

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
                ${oldPlan.toLowerCase() === 'premium' ? `
                <li>Unlimited access to all premium features</li>
                <li>Priority customer support</li>
                <li>Advanced analytics and reporting</li>
                <li>Custom workflows and integrations</li>
                ` : oldPlan.toLowerCase() === 'flex' ? `
                <li>Access to core premium features</li>
                <li>Standard customer support</li>
                <li>Basic analytics</li>
                ` : `
                <li>Basic features only</li>
                <li>Community support</li>
                `}
              </ul>
            </div>
            <div class="plan-column new-plan">
              <div class="plan-header">${newPlan} Plan (New)</div>
              <ul>
                ${newPlan.toLowerCase() === 'premium' ? `
                <li>Unlimited access to all premium features</li>
                <li>Priority customer support</li>
                <li>Advanced analytics and reporting</li>
                <li>Custom workflows and integrations</li>
                ` : newPlan.toLowerCase() === 'flex' ? `
                <li>Access to core premium features</li>
                <li>Standard customer support</li>
                <li>Basic analytics</li>
                ` : `
                <li>Basic features only</li>
                <li>Community support</li>
                `}
              </ul>
            </div>
          </div>
          
          <p>Your billing will be updated accordingly. You can manage your subscription at any time through your account settings.</p>
          
          <p>If you have any questions about your new plan or need assistance, please contact our support team.</p>
          
          <a href="https://sthopwood.com/account" class="button">Manage Your Account</a>
          
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
${oldPlan.toLowerCase() === 'premium' 
  ? '- Unlimited access to all premium features\n- Priority customer support\n- Advanced analytics and reporting\n- Custom workflows and integrations' 
  : oldPlan.toLowerCase() === 'flex'
    ? '- Access to core premium features\n- Standard customer support\n- Basic analytics'
    : '- Basic features only\n- Community support'}

New ${newPlan} Plan:
${newPlan.toLowerCase() === 'premium' 
  ? '- Unlimited access to all premium features\n- Priority customer support\n- Advanced analytics and reporting\n- Custom workflows and integrations' 
  : newPlan.toLowerCase() === 'flex'
    ? '- Access to core premium features\n- Standard customer support\n- Basic analytics'
    : '- Basic features only\n- Community support'}

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
            <a href="https://sthopwood.com/pricing" class="button">View Subscription Options</a>
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
Visit: https://sthopwood.com/pricing

If you have any questions or feedback, please don't hesitate to contact our support team.

Best regards,
The ST Hopwood Team

© ${new Date().getFullYear()} ST Hopwood. All rights reserved.
This email was sent to you because you cancelled your subscription.`
  };
};

module.exports = {
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate
};
