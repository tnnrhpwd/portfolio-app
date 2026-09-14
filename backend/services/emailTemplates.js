/**
 * Transactional email templates.
 *
 * Every template is built from ONE layout builder (`renderEmail`) so the six
 * emails a user can receive are the same document with different content — the
 * old file hand-copied a `<style>` block and a header/footer into each of them,
 * which is how the six drifted apart.
 *
 * Rules that keep these readable in real inboxes:
 *
 * - **Tables, not divs.** Outlook (and a few webmail clients) throw away
 *   flex/grid, so the shell is a nested `role="presentation"` table.
 * - **Inline styles for anything structural.** A `<style>` block is stripped by
 *   some clients, so it only carries progressive extras: the mobile stack, the
 *   dark-mode palette, and the hover state.
 * - **Every color has a solid fallback.** The accent bar and the button use
 *   `background-color` first and a `linear-gradient` second; a client that drops
 *   the gradient still paints a readable brand color.
 * - **Escape every interpolated value.** Nicknames, bug titles, resolutions and
 *   (especially) user-agent strings reach the HTML — an unescaped `&` or `<`
 *   corrupts the message.
 * - **A preheader.** The first line of body text is what most clients show next
 *   to the subject, so each template sets one explicitly and hides it.
 *
 * Exports and data contracts are unchanged — `services/emailService.js` selects
 * a template by name and only ever reads `{ subject, html, text }`.
 */

const { FEATURES_PLAIN, isProTier } = require('../constants/pricing');

// Centralized origin for links inside emails. Mirrors passwordReset.js:
// defaults to production, overridable via FRONTEND_URL (dev / deploy previews).
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.sthopwood.com';

const BRAND = {
  name: 'ST Hopwood',
  page: '#eef1f7',        // page behind the card
  card: '#ffffff',
  panel: '#f4f6fa',       // inset readout
  text: '#212124',
  muted: '#5b5b63',
  rule: '#d9dee8',
  blue: '#1f5fd0',        // link + button, contrast-checked on white
  mint: '#0d8f8f',        // text-safe mint (raw --fg-mint is a display color)
  pink: '#c22b76',
  warnBg: '#fff6e5',
  warnEdge: '#c47d00',
  badBg: '#fdecec',
  badEdge: '#b3261e',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Escape a value for HTML text/attribute context. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

/** Get plain-text feature bullets for a plan (for emails). */
function getPlanFeatures(plan) {
  const lc = String(plan || '').toLowerCase();
  if (isProTier(plan) || lc === 'pro' || lc === 'simple') return FEATURES_PLAIN.pro;
  return FEATURES_PLAIN.free;
}

/** HTML `<li>` list from plan features. */
function featuresHtml(plan) {
  return getPlanFeatures(plan).map((f) => `<li>${esc(f)}</li>`).join('');
}

/** Plain-text bullet list from plan features. */
function featuresText(plan) {
  return getPlanFeatures(plan).map((f) => `- ${f}`).join('\n');
}

// ── Layout primitives ────────────────────────────────────────────────────────

/** Body paragraph. `html` may contain markup; escape dynamic values first. */
const p = (html, { size = 15, muted = false, bottom = 14 } = {}) =>
  `<p class="${muted ? 'dm-muted' : 'dm-text'}" style="margin:0 0 ${bottom}px;font-size:${size}px;line-height:1.6;color:${muted ? BRAND.muted : BRAND.text};">${html}</p>`;

/** Inset panel — a label plus rows, or free content. */
const panel = (content, { tone = 'panel', title = '' } = {}) => {
  const bg = tone === 'warn' ? BRAND.warnBg : tone === 'bad' ? BRAND.badBg : BRAND.panel;
  const edge = tone === 'warn' ? BRAND.warnEdge : tone === 'bad' ? BRAND.badEdge : BRAND.rule;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
    <tr>
      <td class="dm-panel" style="background-color:${bg};border-left:3px solid ${edge};border-radius:6px;padding:16px 18px;">
        ${title ? `<p class="dm-text" style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};">${esc(title)}</p>` : ''}
        ${content}
      </td>
    </tr>
  </table>`;
};

/** Label/value rows for a panel — a two-column table so the values align. */
const rows = (pairs) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${pairs
      .map(
        ([label, value], i) => `
    <tr>
      <td class="dm-muted" style="padding:${i === 0 ? '0' : '7px'} 12px 7px 0;font-size:13px;line-height:1.5;color:${BRAND.muted};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td class="dm-text" style="padding:${i === 0 ? '0' : '7px'} 0 7px 0;font-size:14px;line-height:1.5;color:${BRAND.text};word-break:break-word;">${esc(value)}</td>
    </tr>`,
      )
      .join('')}
  </table>`;

/** Bulleted list (small, muted, for security notes). */
const bullets = (items) => `
  <ul class="dm-muted" style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6;color:${BRAND.muted};">
    ${items.map((item) => `<li style="margin:0 0 6px;">${item}</li>`).join('')}
  </ul>`;

/**
 * Primary action button. A padded `<a>` inside a colored cell: the cell carries
 * a solid `bgcolor` (Outlook) plus a gradient (everything else), and the anchor
 * carries the label, so the button is clickable even if the styling is dropped.
 */
const button = ({ label, href }) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
    <tr>
      <td class="sm-btn" align="center" bgcolor="#1f5fd0" style="border-radius:999px;background-color:${BRAND.blue};background-image:linear-gradient(90deg,#2f6fe4,#0d8f8f);">
        <a href="${esc(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:.02em;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
      </td>
    </tr>
  </table>`;

/** The raw URL, for the (common) case where the button is stripped. */
const linkFallback = (href) => `
  <p class="dm-muted" style="margin:0 0 14px;font-size:12px;line-height:1.6;color:${BRAND.muted};">
    If the button doesn’t work, paste this into your browser:<br>
    <a href="${esc(href)}" style="color:${BRAND.blue};word-break:break-all;">${esc(href)}</a>
  </p>`;

const footer = (reason) => `
  <tr>
    <td class="dm-bg" style="padding:18px 6px 0;font-family:${FONT};">
      <p class="dm-muted" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
        ${esc(reason)}
      </p>
      <p class="dm-muted" style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
        <a href="${FRONTEND_URL}/settings#notifications" style="color:${BRAND.muted};text-decoration:underline;">Email settings</a>
        &nbsp;·&nbsp;
        <a href="${FRONTEND_URL}/support" style="color:${BRAND.muted};text-decoration:underline;">Get help</a>
      </p>
      <p class="dm-muted" style="margin:10px 0 0;font-size:11px;line-height:1.6;color:${BRAND.muted};text-align:center;">
        &copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
      </p>
    </td>
  </tr>`;

/**
 * The one document every template is built from.
 *
 * @param {Object}   spec
 * @param {string}   spec.title      `<title>` + the document name
 * @param {string}   spec.preheader  Hidden first line, shown next to the subject
 * @param {string}   [spec.eyebrow]  Small uppercase label above the heading
 * @param {string}   spec.heading    The `<h1>` — what happened, in a few words
 * @param {string[]} spec.body       Body blocks (already-escaped HTML)
 * @param {Object}   [spec.cta]      { label, href }
 * @param {string}   [spec.footerReason]
 */
function renderEmail({ title, preheader, eyebrow, heading, body = [], cta, footerReason }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${esc(title)}</title>
  <style>
    /* Only progressive extras live here — a client that strips <style> still
       gets the full inline layout below. */
    a { text-decoration: none; }
    @media (max-width: 600px) {
      .sm-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .sm-btn { display: block !important; }
      .sm-btn a { display: block !important; }
    }
    /* Dark mode. Named classes rather than a blanket filter, so the accent bar
       and the button keep their brand colors. */
    @media (prefers-color-scheme: dark) {
      .dm-bg   { background-color: #141416 !important; }
      .dm-card { background-color: #1e1e21 !important; }
      .dm-panel{ background-color: #26262a !important; }
      .dm-text { color: #f4f7fd !important; }
      .dm-muted{ color: #a5a5aa !important; }
      .dm-rule { border-color: #33333a !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${BRAND.page};">
    ${esc(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.page};" class="dm-bg">
    <tr>
      <td align="center" style="padding:24px 12px 32px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background-color:${BRAND.mint};background-image:linear-gradient(90deg,#4da6ff,#0d8f8f 45%,${BRAND.pink});">&nbsp;</td>
          </tr>
          <tr>
            <td class="dm-card sm-pad" style="background-color:${BRAND.card};padding:32px 30px 28px;font-family:${FONT};border-radius:0 0 10px 10px;">
              ${eyebrow ? `<p class="dm-muted" style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.muted};">${esc(eyebrow)}</p>` : ''}
              <h1 class="dm-text" style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.text};">${esc(heading)}</h1>
              ${body.join('\n')}
              ${cta ? button(cta) : ''}
              ${cta ? linkFallback(cta.href) : ''}
            </td>
          </tr>
          ${footer(footerReason || `You’re receiving this because you have an ${BRAND.name} account.`)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

// Template for password reset
const passwordResetTemplate = (data) => {
  const { resetLink, userNickname, requestInfo } = data;

  // Format timestamp for display. Wrapped in try/catch because an invalid
  // IANA zone name (e.g. a stale/placeholder value like 'Unknown' from a
  // failed geolocation lookup) makes toLocaleString() throw a RangeError,
  // which would otherwise abort the whole password-reset email silently.
  const formatTimestamp = (timestamp) => {
    const timeZone = requestInfo?.location?.timezone || 'UTC';
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    try {
      return new Date(timestamp).toLocaleString('en-US', { ...options, timeZone });
    } catch (error) {
      return new Date(timestamp).toLocaleString('en-US', { ...options, timeZone: 'UTC' });
    }
  };

  const name = userNickname || 'there';
  const formattedTime = requestInfo ? formatTimestamp(requestInfo.timestamp) : null;
  const place = requestInfo?.location
    ? [requestInfo.location.city, requestInfo.location.region, requestInfo.location.country]
        .filter(Boolean)
        .join(', ')
    : null;

  const requestRows = requestInfo
    ? [
        ['Time', formattedTime],
        ['IP address', requestInfo.ipAddress],
        ['Location', place],
        ['Browser', requestInfo.device?.browser],
        ['Operating system', requestInfo.device?.os],
      ].filter(([, value]) => Boolean(value))
    : [];

  const html = renderEmail({
    title: 'Reset your password',
    preheader: 'Reset your ST Hopwood password — the link works for one hour.',
    eyebrow: 'Account security',
    heading: 'Reset your password',
    body: [
      p(`Hi ${esc(name)},`),
      p('We received a request to reset the password on your ST Hopwood account. If that was you, set a new one below.'),
      panel(
        `<p class="dm-text" style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${BRAND.text};"><strong>This link expires in 1 hour</strong> and can only be used once.</p>
         <p class="dm-muted" style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">Your password stays as it is until you finish this step.</p>`,
        { tone: 'warn' },
      ),
      requestRows.length ? panel(rows(requestRows), { title: 'Where this request came from' }) : '',
      p(`<strong>Didn’t ask for this?</strong> You can ignore this email — nothing changes. If it keeps happening, tell us and we’ll help you lock the account down.`, { size: 14, muted: true, bottom: 6 }),
      `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${BRAND.text};" class="dm-text"><strong>For your security:</strong></p>`,
      bullets([
        'Never share this email or the reset link with anyone.',
        'ST Hopwood will never ask you for your password.',
        'Only open the link if you started this request.',
      ]),
    ],
    cta: { label: 'Choose a new password', href: resetLink },
    footerReason: 'You’re receiving this because a password reset was requested for your account.',
  });

  const text = `RESET YOUR PASSWORD

Hi ${name},

We received a request to reset the password on your ST Hopwood account. If that was you, open this link — it expires in 1 hour and can only be used once:

${resetLink}

${requestRows.length ? `WHERE THIS REQUEST CAME FROM\n${requestRows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n` : ''}
FOR YOUR SECURITY
- Never share this email or the reset link with anyone.
- ST Hopwood will never ask you for your password.
- Only open the link if you started this request.

Didn't ask for this? You can ignore this email — nothing changes. If it keeps happening, reply and we'll help you lock the account down.

Manage your email settings: ${FRONTEND_URL}/settings#notifications
Get help: ${FRONTEND_URL}/support

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because a password reset was requested for your account.`;

  return { subject: 'Reset your ST Hopwood password', html, text };
};

// Template for when a user creates a new subscription
const subscriptionCreatedTemplate = (data) => {
  const { plan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'there';

  const html = renderEmail({
    title: `Welcome to ${plan}`,
    preheader: `Your ${plan} plan is active — here’s what you can do now.`,
    eyebrow: 'Subscription confirmed',
    heading: `Your ${plan} plan is active`,
    body: [
      p(`Hi ${esc(userNickname)},`),
      p(`Thanks for subscribing. Your <strong>${esc(plan)} plan</strong> is live and everything below is switched on right now.`),
      panel(`<ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6;color:${BRAND.text};" class="dm-text">${featuresHtml(plan)}</ul>`, { title: `What ${plan} includes` }),
      p('You can change or cancel your plan at any time from your account — no email required.'),
      p('Questions about billing, or something not working as you expected? Reply to this email and it comes straight to us.', { size: 14, muted: true, bottom: 6 }),
    ],
    cta: { label: 'Go to your account', href: `${FRONTEND_URL}/profile` },
    footerReason: `You’re receiving this because you subscribed to ${BRAND.name}.`,
  });

  const text = `YOUR ${String(plan).toUpperCase()} PLAN IS ACTIVE

Hi ${userNickname},

Thanks for subscribing. Your ${plan} plan is live and everything below is switched on right now.

WHAT ${String(plan).toUpperCase()} INCLUDES
${featuresText(plan)}

You can change or cancel your plan at any time from your account:
${FRONTEND_URL}/profile

Questions about billing, or something not working as you expected? Reply to this email and it comes straight to us.

Manage your email settings: ${FRONTEND_URL}/settings#notifications

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because you subscribed to ${BRAND.name}.`;

  return { subject: `Your ${plan} plan is active`, html, text };
};

// Template for when a user updates their subscription plan
const subscriptionUpdatedTemplate = (data) => {
  const { oldPlan, newPlan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'there';

  const html = renderEmail({
    title: `Plan changed to ${newPlan}`,
    preheader: `You’ve moved from ${oldPlan} to ${newPlan}.`,
    eyebrow: 'Subscription updated',
    heading: `You’re now on ${newPlan}`,
    body: [
      p(`Hi ${esc(userNickname)},`),
      p(`Your plan change went through. You were on <strong>${esc(oldPlan)}</strong> and you’re now on <strong>${esc(newPlan)}</strong> — the new limits and features apply immediately.`),
      panel(rows([['Previous plan', oldPlan], ['New plan', newPlan]]), { title: 'The change' }),
      newPlan && getPlanFeatures(newPlan).length
        ? panel(`<ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6;color:${BRAND.text};" class="dm-text">${featuresHtml(newPlan)}</ul>`, { title: `What ${newPlan} includes` })
        : '',
      p(`If you didn’t expect this change, reply to this email immediately — we’ll sort it out.`, { size: 14, muted: true, bottom: 6 }),
    ],
    cta: { label: 'Review your plan', href: `${FRONTEND_URL}/profile` },
    footerReason: 'You’re receiving this because your subscription changed.',
  });

  const text = `YOU'RE NOW ON ${String(newPlan).toUpperCase()}

Hi ${userNickname},

Your plan change went through. You were on ${oldPlan} and you're now on ${newPlan} — the new limits and features apply immediately.

WHAT ${String(newPlan).toUpperCase()} INCLUDES
${featuresText(newPlan)}

Review your plan: ${FRONTEND_URL}/profile

If you didn't expect this change, reply to this email immediately — we'll sort it out.

Manage your email settings: ${FRONTEND_URL}/settings#notifications

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because your subscription changed.`;

  return { subject: `Your plan changed to ${newPlan}`, html, text };
};

// Template for when a user cancels their subscription
const subscriptionCancelledTemplate = (data) => {
  const { plan, userData } = data;
  const userNickname = userData?.text?.match(/Nickname:([^|]+)/)?.[1]?.trim() || 'there';

  const html = renderEmail({
    title: 'Your subscription is cancelled',
    preheader: `Your ${plan} plan has been cancelled — here’s what still works.`,
    eyebrow: 'Subscription cancelled',
    heading: 'Your subscription is cancelled',
    body: [
      p(`Hi ${esc(userNickname)},`),
      p(`Your <strong>${esc(plan)}</strong> subscription is cancelled and you won’t be billed again.`),
      panel(
        rows([
          ['Plan', `${plan} — cancelled`],
          ['Billing', 'No further charges'],
        ]),
        { title: 'Where things stand' },
      ),
      p('Here’s what changes:'),
      bullets([
        'Anything you saved stays yours — nothing is deleted.',
        'Plan features and limits end at the close of the period you already paid for.',
        'Your account stays open on the free plan.',
      ]),
      p('You can resubscribe whenever you like, and everything you had will still be there.', { size: 14, muted: true, bottom: 6 }),
    ],
    cta: { label: 'View your account', href: `${FRONTEND_URL}/profile` },
    footerReason: 'You’re receiving this because your subscription was cancelled.',
  });

  const text = `YOUR SUBSCRIPTION IS CANCELLED

Hi ${userNickname},

Your ${plan} subscription is cancelled and you won't be billed again.

WHAT CHANGES
- Anything you saved stays yours — nothing is deleted.
- Plan features and limits end at the close of the period you already paid for.
- Your account stays open on the free plan.

You can resubscribe whenever you like, and everything you had will still be there.

View your account: ${FRONTEND_URL}/profile

Manage your email settings: ${FRONTEND_URL}/settings#notifications

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because your subscription was cancelled.`;

  return { subject: 'Your subscription is cancelled', html, text };
};

// Template for new account registration (transactional — always sent)
const welcomeTemplate = (data) => {
  const { userNickname } = data;
  const name = userNickname || 'there';

  const nextSteps = [
    ['Talk to it', `Ask for anything in plain English at <a href="${FRONTEND_URL}/net" style="color:${BRAND.blue};">the chat</a> — it can answer, plan, and get things done.`],
    ['Watch it work', `Connect the desktop addon and you can see every step it takes at <a href="${FRONTEND_URL}/simple" style="color:${BRAND.blue};">Control</a>, and stop it any time.`],
    ['Keep what it learns', `Goals, plans and lessons are saved at <a href="${FRONTEND_URL}/plans" style="color:${BRAND.blue};">Goals</a>, so next time is one click.`],
  ];

  const html = renderEmail({
    title: 'Welcome aboard',
    preheader: 'Your account is ready — here are the three things worth trying first.',
    eyebrow: 'Welcome',
    heading: 'Welcome aboard',
    body: [
      p(`Hi ${esc(name)},`),
      p('Thanks for creating an account. Here are the three things worth trying first:'),
      `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
        ${nextSteps
          .map(
            ([title, body]) => `
        <tr>
          <td class="dm-text" style="padding:14px 0 0;font-size:14px;line-height:1.6;color:${BRAND.text};">
            <strong>${esc(title)}</strong><br>
            <span class="dm-muted" style="color:${BRAND.muted};">${body}</span>
          </td>
        </tr>`,
          )
          .join('')}
      </table>`,
      p('Questions or feedback? Just reply to this email — we read every message.', { size: 14, muted: true, bottom: 6 }),
    ],
    cta: { label: 'Open the chat', href: `${FRONTEND_URL}/net` },
    footerReason: 'You’re receiving this because you created an ST Hopwood account.',
  });

  const text = `WELCOME ABOARD

Hi ${name},

Thanks for creating an account. Here are the three things worth trying first:

1. Talk to it — ask for anything in plain English at ${FRONTEND_URL}/net
2. Watch it work — connect the desktop addon and see every step at ${FRONTEND_URL}/simple
3. Keep what it learns — goals, plans and lessons live at ${FRONTEND_URL}/plans

Questions or feedback? Just reply to this email — we read every message.

Open the chat: ${FRONTEND_URL}/net

Manage your email settings: ${FRONTEND_URL}/settings#notifications

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because you created an ST Hopwood account.`;

  return { subject: 'Welcome to ST Hopwood', html, text };
};

// Template for when an admin resolves a user's bug report
const bugReportResolvedTemplate = (data) => {
  const { userNickname, bugTitle, resolutionText } = data;
  const name = userNickname || 'there';
  const title = bugTitle || 'Your bug report';
  const resolution = resolutionText || 'Your report has been reviewed and resolved.';

  const html = renderEmail({
    title: 'Your bug report has been resolved',
    preheader: `“${title}” — here’s what we did.`,
    eyebrow: 'Bug report',
    heading: 'Your bug report is resolved',
    body: [
      p(`Hi ${esc(name)},`),
      p('Good news — a bug report you sent us has been fixed. Thank you for taking the time to write it up; that’s what makes these fast to track down.'),
      panel(
        `<p class="dm-text" style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${BRAND.text};"><strong>Report</strong><br><span class="dm-muted" style="color:${BRAND.muted};">${esc(title)}</span></p>
         <p class="dm-text" style="margin:0;font-size:14px;line-height:1.6;color:${BRAND.text};"><strong>What we did</strong><br><span class="dm-muted" style="color:${BRAND.muted};">${esc(resolution)}</span></p>`,
      ),
      p('If it still looks wrong on your side, reply to this email — re-opening it is quick.', { size: 14, muted: true, bottom: 6 }),
    ],
    cta: { label: 'See your reports', href: `${FRONTEND_URL}/support` },
    footerReason: 'You’re receiving this because a bug report you filed was resolved.',
  });

  const text = `YOUR BUG REPORT IS RESOLVED

Hi ${name},

Good news — a bug report you sent us has been fixed. Thank you for taking the time to write it up.

REPORT
${title}

WHAT WE DID
${resolution}

If it still looks wrong on your side, reply to this email — re-opening it is quick.

See your reports: ${FRONTEND_URL}/support

Manage your email settings: ${FRONTEND_URL}/settings#notifications

© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
You're receiving this because a bug report you filed was resolved.`;

  return { subject: 'Your bug report has been resolved', html, text };
};

module.exports = {
  passwordResetTemplate,
  subscriptionCreatedTemplate,
  subscriptionUpdatedTemplate,
  subscriptionCancelledTemplate,
  welcomeTemplate,
  bugReportResolvedTemplate,
};
