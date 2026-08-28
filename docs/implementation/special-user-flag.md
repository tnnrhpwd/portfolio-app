# Admin "Special" user flag (unlimited AI credits)

A per-user, admin-only escape hatch that grants unlimited AI credits without
changing the user's Free/Pro rank.

## What it is

- A `Special:true` field on a user's `text` record in DynamoDB.
- Read by `isSpecialUser()` in `backend/utils/apiUsageTracker.js` (regex
  `/(?:^|\|)Special:true/i`).
- When set, `canMakeApiCall()` and `trackApiUsage()` treat the user like an
  admin: unlimited access, no credit deduction — usage is still logged.

## How to set / clear it

- Toggled from the Admin user-management table (frontend `Admin.jsx` →
  backend `adminController.js`). No direct DB edit is needed.
- It is a **rank-independent override**: a Free user with `Special:true` has
  unlimited credits but is still Free everywhere else (storage, phone relay,
  support).

## Why it must be documented

- It is invisible in the product itself — no tier, no pricing mention.
- The `41a31e6` credit-tracking bug was exactly this kind of quiet exception:
  a stale-cache write silently wiped a user's `Special` flag and, more
  seriously, briefly overwrote their password hash with a literal
  `'[redacted]'` string. The credit-write path in `apiUsageTracker.js` now
  rebuilds from the raw (unredacted) record via `getRawUserRecord` /
  `updateUserCredits` specifically to avoid that.

## Intended use

- Support, testing, and partner accounts.
- **Not** a documented tier. Do not reference it in pricing, Terms, or
  marketing copy.
