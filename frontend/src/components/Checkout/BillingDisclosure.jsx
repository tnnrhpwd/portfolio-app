import React from 'react';

/**
 * BillingDisclosure
 *
 * Plain-language summary of how billing actually works, shown directly on the
 * checkout flow. Professional payment pages (Stripe, Apple, most SaaS
 * checkouts) always surface this information up front — omitting it is what
 * makes a payment page feel evasive or untrustworthy. Full legal language
 * still lives on /terms and /privacy; this is a summary, not a replacement.
 */
const BillingDisclosure = ({ variant = 'full' }) => {
  return (
    <div className="billing-disclosure">
      <h4 className="billing-disclosure-title">How billing works</h4>
      <ul className="billing-disclosure-list">
        <li>Billed monthly on the anniversary of your sign-up date. Cancel anytime from your account settings.</li>
        <li>If you cancel, you keep paid features until the end of the current billing period — no partial-month refund.</li>
        <li>Subscription fees are non-refundable once a billing cycle starts, except where required by law.</li>
        <li>Payments are processed securely by Stripe. We never see or store your full card number.</li>
      </ul>
      {variant === 'full' && (
        <p className="billing-disclosure-links">
          Read the full <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> for complete details,
          or contact <a href="/support">support</a> with billing questions.
        </p>
      )}
    </div>
  );
};

export default BillingDisclosure;
