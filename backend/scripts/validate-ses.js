/**
 * validate-ses.js — Verify AWS SES is configured, out of sandbox, and able to
 * actually send email (run after AWS approves production access for SES).
 *
 * Usage:  node backend/scripts/validate-ses.js
 *
 * Checks (all read-only except the optional test send):
 *   1. SES is reachable with the configured credentials.
 *   2. ProductionAccessEnabled (out of sandbox) — true after AWS approval.
 *   3. SendingEnabled + 24h send quota.
 *   4. FROM_EMAIL identity (address and/or domain) is verified.
 *   5. If SES_CONFIGURATION_SET is set, that configuration set exists — a
 *      missing set makes sends fail with ConfigurationSetDoesNotExist.
 *   6. Sends a real test email to FROM_EMAIL (the same SendEmail path the app
 *      uses) so delivery capability is confirmed end-to-end.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  SESv2Client,
  GetAccountCommand,
  GetEmailIdentityCommand,
  ListConfigurationSetsCommand,
  SendEmailCommand,
} = require('@aws-sdk/client-sesv2');

const region = process.env.AWS_SES_REGION || process.env.AWS_REGION;
const fromEmail = process.env.FROM_EMAIL;
const configSet = process.env.SES_CONFIGURATION_SET; // optional — omitted from sends when unset

const client = new SESv2Client({ region });

function report(label, ok, detail = '') {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  console.log('\n========== AWS SES Validation ==========');
  console.log(`Region: ${region || '(unset)'}`);
  console.log(`FROM_EMAIL: ${fromEmail || '(unset)'}`);
  console.log(`Configuration set: ${configSet || '(none — omitted from sends)'}`);
  console.log('----------------------------------------\n');

  if (!fromEmail) {
    report('FROM_EMAIL configured', false, 'set FROM_EMAIL in backend/.env');
    process.exit(1);
  }
  report('FROM_EMAIL configured', true, fromEmail);

  // 1. Account status (read-only)
  let productionAccess = null;
  let sendingEnabled = null;
  try {
    const account = await client.send(new GetAccountCommand({}));
    productionAccess = account.ProductionAccessEnabled;
    sendingEnabled = account.SendingEnabled;
    report('SES reachable (credentials valid)', true);
    report(
      'Production access (out of sandbox)',
      !!productionAccess,
      productionAccess ? 'approved — can email any address' : 'still in sandbox — only verified recipients'
    );
    report('Sending enabled', !!sendingEnabled, sendingEnabled ? 'enabled' : 'DISABLED');
    const q = account.SendQuota || {};
    console.log(`   Send quota: ${q.Max24HourSend ?? '?'}/24h (${q.SentLast24Hours ?? '?'} sent)`);
  } catch (err) {
    report('SES reachable (credentials valid)', false, err.message);
    console.log('\nAborting — fix credentials/region above first.\n');
    process.exit(1);
  }

  // 2. FROM_EMAIL identity verification — a verified DOMAIN covers every
  //    address on it, so admin@sthopwood.com works without its own identity.
  const domain = fromEmail.includes('@') ? fromEmail.split('@')[1] : null;

  let domainVerified = false;
  if (domain) {
    try {
      const info = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      domainVerified = info.VerificationStatus === 'SUCCESS';
      report(`FROM_EMAIL domain (${domain}) verified`, domainVerified, `status=${info.VerificationStatus}`);
    } catch (err) {
      report(`FROM_EMAIL domain (${domain}) verified`, false, err.message);
    }
  }

  try {
    const info = await client.send(new GetEmailIdentityCommand({ EmailIdentity: fromEmail }));
    report(`FROM_EMAIL address (${fromEmail}) verified`, info.VerificationStatus === 'SUCCESS', `status=${info.VerificationStatus}`);
  } catch (err) {
    if (domainVerified) {
      report(`FROM_EMAIL address (${fromEmail}) verified`, true, 'covered by verified domain');
    } else {
      report(`FROM_EMAIL address (${fromEmail}) verified`, false, err.message);
    }
  }

  // 3. Configuration set existence (paginated — ListConfigurationSets returns
  //    a maximum of 100 per page). Only relevant when SES_CONFIGURATION_SET is
  //    configured; when unset, emailService.js omits the field entirely.
  if (!configSet) {
    console.log('ℹ️  No SES_CONFIGURATION_SET — sends omit ConfigurationSetName (no bounce/complaint routing).\n');
  } else {
    try {
      const names = [];
      let nextToken;
      do {
        const sets = await client.send(new ListConfigurationSetsCommand(nextToken ? { NextToken: nextToken } : {}));
        names.push(...(sets.ConfigurationSets || []).map((s) => s.Name));
        nextToken = sets.NextToken;
      } while (nextToken);
      const exists = names.includes(configSet);
      report(
        `Configuration set "${configSet}" exists`,
        exists,
        exists ? `available (${names.length} total)` : `not found — existing: ${names.join(', ') || '(none)'}`
      );
      if (!exists) {
        console.log('   ⚠️  Sends will fail until you create it or clear SES_CONFIGURATION_SET.\n');
      }
    } catch (err) {
      report(`Configuration set "${configSet}" exists`, false, err.message);
    }
  }

  // 4. Real test send (the same SendEmailCommand path emailService.js uses)
  console.log('\nSending test email...');
  try {
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [fromEmail] },
        ...(configSet ? { ConfigurationSetName: configSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: '✅ SES validation test', Charset: 'UTF-8' },
            Body: {
              Html: { Data: '<p>Your AWS SES email service is working and out of sandbox.</p>', Charset: 'UTF-8' },
              Text: { Data: 'Your AWS SES email service is working and out of sandbox.', Charset: 'UTF-8' },
            },
          },
        },
      })
    );
    report('Test email sent', true, `MessageId=${result.MessageId}`);
  } catch (err) {
    report('Test email sent', false, `${err.name}: ${err.message}`);
  }

  console.log('\n=========================================\n');
})().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
