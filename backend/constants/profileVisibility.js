/**
 * profileVisibility.js — who may see an account's public page (`/u/<username>`).
 *
 * The rule the product asks for is "private by default": a page is visible to its
 * owner and to the people they are connected with, and to nobody else until the
 * owner says otherwise. That makes the DEFAULT the security-relevant half of this
 * file — an account row written before this feature existed has no
 * `profileVisibility` attribute at all, and it must read as private rather than as
 * "no preference, so show everything".
 *
 * Kept in one module because two places have to agree: the controller that writes
 * the setting (`profileController`) and the service that enforces it
 * (`publicProfile`). A second copy of the string 'public' is how a gate stops
 * matching its own setting.
 */

const PROFILE_VISIBILITY = {
    PUBLIC: 'public',
    PRIVATE: 'private',
};

/** Absent or unrecognised ⇒ private. */
const DEFAULT_PROFILE_VISIBILITY = PROFILE_VISIBILITY.PRIVATE;

const isProfileVisibility = (value) =>
    value === PROFILE_VISIBILITY.PUBLIC || value === PROFILE_VISIBILITY.PRIVATE;

/** Anything that is not exactly `public` is private — never the other way round. */
const normalizeProfileVisibility = (value) =>
    (isProfileVisibility(value) ? value : DEFAULT_PROFILE_VISIBILITY);

module.exports = {
    PROFILE_VISIBILITY,
    DEFAULT_PROFILE_VISIBILITY,
    isProfileVisibility,
    normalizeProfileVisibility,
};
