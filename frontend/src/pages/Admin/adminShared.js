// Shared constants + helpers for the Admin section.

// The only user ID allowed to open /admin/* pages (client-side gate).
// The backend independently enforces ADMIN_USER_ID on every admin endpoint.
export { ADMIN_USER_ID } from '../../constants/admin';

export const fmt = (n) => Number(n).toLocaleString();
export const pct = (n) => `${n}%`;

/**
 * A row's share of its list, as a CSS width for `.admin-share` (Admin.css).
 *
 * The 2% floor matters: a genuine-but-small share (1 of 200) rounding to 0%
 * would render as an empty track, which reads as "no data" rather than as a
 * small number. Callers pass the largest value in the list as `whole`, so the
 * top row is always full width and the rest are relative to it.
 */
export const sharePct = (value, whole) =>
  `${Math.max(2, Math.round((Number(value) / Math.max(Number(whole), 1)) * 100))}%`;

export const formatTimestamp = (v) => {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v || "";
  }
};

// Rule types available for the dynamic Home Title editor
export const HOME_TITLE_RULE_TYPES = [
  { value: "nickname", label: "Nickname contains", needsMatch: true, matchPlaceholder: "e.g. tanner" },
  { value: "email", label: "Email contains", needsMatch: true, matchPlaceholder: "e.g. @gmail.com" },
  { value: "plan", label: "Membership plan contains", needsMatch: true, matchPlaceholder: "e.g. Pro" },
  { value: "country", label: "Visitor IP country contains", needsMatch: true, matchPlaceholder: "e.g. Canada" },
  { value: "region", label: "Visitor IP region/state contains", needsMatch: true, matchPlaceholder: "e.g. Ontario" },
  { value: "city", label: "Visitor IP city contains", needsMatch: true, matchPlaceholder: "e.g. Toronto" },
  { value: "newUser", label: "New account (age ≤ N days)", needsMatch: true, matchPlaceholder: "e.g. 7" },
  { value: "loggedIn", label: "Any logged-in visitor", needsMatch: false },
  { value: "guest", label: "Guest (not logged in)", needsMatch: false },
];

export const homeTitleRuleTypeInfo = (type) =>
  HOME_TITLE_RULE_TYPES.find((t) => t.value === type) || HOME_TITLE_RULE_TYPES[0];
