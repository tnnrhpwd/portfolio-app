# Admin "Special" user flag (unlimited AI credits + paid-tier bypass)

A per-user, admin-only escape hatch that grants unlimited AI credits and
bypasses paid (Pro) requirements without changing the user's Free/Pro rank.
Special is **distinct from admin** — only `ADMIN_USER_ID` can open the admin
page; `Special:true` never grants admin access.

## What it is

- A `Special:true` field on a user's `text` record in DynamoDB.
- Read by `isSpecialUser()` in `backend/utils/apiUsageTracker.js` (regex
  `/(?:^|\|)Special:true/i`).
- When set, the user is treated as paid-equivalent for feature gates:
  - `canMakeApiCall()` and `trackApiUsage()` treat the user like an admin:
    unlimited access, no credit deduction — usage is still logged.
  - `getUserStorageUsage()` (via `storageTracker.js`) applies the Pro storage
    allowance (50 GB) and reports `membership: 'Pro'`, so both display and
    write-capacity enforcement use the Pro limit.
  - `validateModelTierAccess()` (`llmService.js`) skips model-tier gates.

## How to set / clear it

- Toggled from the Admin user-management table (frontend `Admin.jsx` →
  backend `adminController.js`). No direct DB edit is needed.
- It is a **rank-independent override**: a Free user with `Special:true` gets
  Pro-level AI credits and storage while their underlying `Rank` stays Free.
  It does not create a real Stripe subscription and does not grant admin
  page access.

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
