// Shared constants + helpers for the Admin section.

// The only user ID allowed to open /admin/* pages (client-side gate).
// The backend independently enforces ADMIN_USER_ID on every admin endpoint.
export const ADMIN_USER_ID = "6770a067c725cbceab958619";

export const fmt = (n) => Number(n).toLocaleString();
export const pct = (n) => `${n}%`;

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
