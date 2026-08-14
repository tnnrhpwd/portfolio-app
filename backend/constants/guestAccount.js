/**
 * Canonical credentials for the public "Login as Guest" demo account.
 *
 * A single source of truth so the login flow (self-healing provisioning in
 * controllers/postData.js), the dev CLI tools (utils/createGuestUser.js,
 * utils/guestUserManager.js), and the frontend guest-login buttons never
 * drift out of sync with each other again.
 */
const GUEST_EMAIL = 'guest@gmail.com';
const GUEST_PASSWORD = 'guest';
const GUEST_NICKNAME = 'Guest User';

module.exports = {
    GUEST_EMAIL,
    GUEST_PASSWORD,
    GUEST_NICKNAME,
};
