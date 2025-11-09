/**
 * FAQ data for Support page
 */
export const faqData = [
  {
    id: 1,
    question: "How do I create a new account?",
    answer: "Click the 'Register' button on the <a href='/login'>login page</a> and fill out the required information. You'll receive a confirmation email to activate your account.",
    category: "account"
  },
  {
    id: 2,
    question: "How do I reset my password?",
    answer: "On the <a href='/login'>login page</a>, click 'Forgot Password' and enter your email address. We'll send you a reset link within a few minutes.",
    category: "account"
  },
  {
    id: 3,
    question: "How do I link my social media accounts?",
    answer: "Go to <a href='/settings'>Settings</a> > Authentication & Account Linking. Click 'Link Account' for any supported provider (Google, Facebook, etc.) and follow the authentication flow.",
    category: "account"
  },
  {
    id: 4,
    question: "What data do you collect?",
    answer: "We only collect data necessary to provide our services. See our <a href='/privacy'>Privacy Policy</a> for detailed information about data collection, storage, and usage.",
    category: "privacy"
  },
  {
    id: 5,
    question: "How do I delete my account?",
    answer: "Go to <a href='/settings'>Settings</a> and scroll to the bottom. Click 'Delete Account' and confirm. Note that this action is irreversible.",
    category: "account"
  },
  {
    id: 6,
    question: "Why is the app running slowly?",
    answer: "Try clearing your browser cache, updating your browser, or checking your internet connection. If issues persist, report a bug using our <a href='#bug' onclick='setActiveTab(\"bug\")'>support form</a>.",
    category: "technical"
  },
  {
    id: 7,
    question: "How do I contact support?",
    answer: "Use the <a href='#contact' onclick='setActiveTab(\"contact\")'>Contact Us</a> tab on this page, email us directly, or check our FAQ section for common questions.",
    category: "support"
  },
  {
    id: 8,
    question: "What browsers are supported?",
    answer: "We support the latest versions of Chrome, Firefox, Safari, and Edge. For the best experience, keep your browser updated.",
    category: "technical"
  },
  {
    id: 9,
    question: "How do I access my profile?",
    answer: "Click on your name in the navigation menu or go directly to your <a href='/profile'>Profile</a> page to view and edit your account information.",
    category: "account"
  },
  {
    id: 10,
    question: "Where can I learn more about the app?",
    answer: "Visit our <a href='/about'>About</a> page to learn more about our services, or explore our various tools like <a href='/wordle'>Wordle</a>, <a href='/passgen'>Password Generator</a>, and <a href='/annuities'>Annuities Calculator</a>.",
    category: "general"
  },
  {
    id: 11,
    question: "How do I view terms and conditions?",
    answer: "You can read our full <a href='/terms'>Terms of Service</a> and <a href='/privacy'>Privacy Policy</a> at any time.",
    category: "legal"
  },
  {
    id: 12,
    question: "What should I do if I found a bug?",
    answer: "Please use our <a href='#bug' onclick='setActiveTab(\"bug\")'>Bug Report</a> form to describe the issue in detail. This helps us fix problems quickly and improve the app for everyone.",
    category: "technical"
  }
];
