/**
 * Payment Element configuration for Stripe
 */
import { PLAN_IDS, PLAN_NAMES } from '../constants/pricing';

export const getPaymentElementOptions = (userEmail) => ({
  layout: {
    type: 'tabs',
    defaultCollapsed: false,
    radios: false,
    spacedAccordionItems: true
  },
  defaultValues: {
    billingDetails: {
      email: userEmail
    }
  },
  paymentMethodOrder: [
    'link',
    'card', 
    'cashapp',
  ],
  wallets: {
    applePay: 'auto',
    googlePay: 'auto'
  }
});

/**
 * Get plan display name for confirmation
 */
export const getPlanDisplayName = (selectedPlan, membershipPricing, customPrice, formatPrice) => {
  if (membershipPricing && membershipPricing.success && membershipPricing.data && membershipPricing.data.length > 0) {
    const dynamicPlan = membershipPricing.data.find(plan => plan.id === selectedPlan);
    if (dynamicPlan) {
      const price = dynamicPlan.price ? formatPrice(dynamicPlan.price) : 'Custom Pricing';
      const period = dynamicPlan.interval || 'month';
      return `${dynamicPlan.name} (${price} per ${period})`;
    }
  }
  
  if (selectedPlan === PLAN_IDS.SIMPLE) {
    return `${PLAN_NAMES[PLAN_IDS.SIMPLE]} (Full PC automation)`;
  } else if (selectedPlan === PLAN_IDS.PRO) {
    return PLAN_NAMES[PLAN_IDS.PRO];
  } else {
    return PLAN_NAMES[PLAN_IDS.FREE];
  }
};

/**
 * Get payment method icon
 */
export const getPaymentIcon = (type) => {
  switch (type) {
    case 'card': return '💳';
    case 'link': return '🔗';
    case 'cashapp': return '💵';
    default: return '💰';
  }
};

/**
 * Format payment method display for confirmation
 */
export const formatPaymentMethodDisplay = (paymentMethods, selectedPaymentMethod) => {
  if (!paymentMethods || !selectedPaymentMethod) {
    return { icon: '💰', text: 'Selected payment method' };
  }

  const method = paymentMethods.find(m => m.id === selectedPaymentMethod);
  if (!method) {
    return { icon: '💰', text: 'Selected payment method' };
  }

  const icon = getPaymentIcon(method.type);

  if (method.type === 'card') {
    return {
      icon,
      text: `${method.card.brand.toUpperCase()} •••• ${method.card.last4}`
    };
  } else {
    return {
      icon,
      text: method.type.charAt(0).toUpperCase() + method.type.slice(1).replace('_', ' ')
    };
  }
};
