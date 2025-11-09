const fs = require('fs');
const path = require('path');

// Read the backup file
const backupPath = path.join(__dirname, 'CheckoutForm.backup.jsx');
const originalContent = fs.readFileSync(backupPath, 'utf8');

// Split into lines
const lines = originalContent.split('\n');

// New imports (lines 1-17)
const newImports = `import React, { useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { createCustomer } from '../../../features/data/dataSlice';
import { formatPrice } from '../../../utils/checkoutUtils';
import { getPaymentElementOptions, getPlanDisplayName, formatPaymentMethodDisplay } from '../../../utils/stripeHelpers';
import { useCheckoutState } from '../../../hooks/useCheckoutState';
import { useCheckoutHandlers } from '../../../hooks/useCheckoutHandlers';
import { useCheckoutData } from '../../../hooks/useCheckoutData';
import { useStripeSetup } from '../../../hooks/useStripeSetup';
import MembershipPlans from '../../../components/Checkout/MembershipPlans';
import PaymentMethodsList from '../../../components/Checkout/PaymentMethodsList';
import CheckoutProgressBar from '../../../components/Checkout/CheckoutProgressBar';
import { LinkBenefits } from '../../../components/Checkout/LinkBenefits';
import './CheckoutForm.css';`;

// Keep Stripe initialization (lines 13-21 of original, but update)
const stripeInit = `
const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY).catch(err => {
  console.error('Failed to load Stripe:', err);
  return null;
});`;

// New CheckoutContent component
const newCheckoutContent = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'refactor-checkoutcontent.txt'), 'utf8');

// Keep CheckoutForm wrapper from line 962 onwards, but update it
// Find where "function CheckoutForm" starts in original
const checkoutFormStartLine = lines.findIndex(line => line.trim().startsWith('function CheckoutForm'));

console.log('CheckoutForm starts at line:', checkoutFormStartLine);

// Extract from CheckoutForm to end
const wrapperSection = lines.slice(checkoutFormStartLine).join('\n');

// Build new file
const newContent = `${newImports}

${stripeInit}

${newCheckoutContent}

${wrapperSection}
`;

// Write new file
const outputPath = path.join(__dirname, 'CheckoutForm.jsx');
fs.writeFileSync(outputPath, newContent, 'utf8');

console.log('Refactoring complete!');
console.log('Original lines:', lines.length);
console.log('New file written to:', outputPath);
