# Action Plan (Single Source of Truth)

This is the working plan for Simple. Background and full rationale live in [BUSINESS_PLAN.md](./BUSINESS_PLAN.md) and [ETHICAL_MONETIZATION_STRATEGIES.md](./ETHICAL_MONETIZATION_STRATEGIES.md); this doc is what actually gets executed. It's a living checklist — check items off as they land, and add new gaps as they're found rather than letting it drift.

**The premise:** Simple is an AI agent that perceives what a user does on their Windows PC and acts on their behalf, described in plain English. AI chat and cloud storage support that core loop. The Free tier is for trying it and seeing whether it's useful; Pro removes the cloud-usage ceiling. Growth is word of mouth, not marketing — the site describes the product plainly and lets the product do the convincing.

---

## Phase 0 — Fix the core, and don't sell it until it works

This is the top priority. Purchasing stays off and Simple visibility caveated until the readiness gate below is met.

### Current status

- **Hard gate met (2026-08-21):** all 8 non-skipped validation scenarios pass individually and together — the core perceive→act loop works at least once for the tested cases.
- **Reliability gate not yet met:** no 10-run/multi-day tally has been accumulated, and two scenarios are still only skipped. Don't re-enable purchasing until the tally clears 90%+ per scenario.
- The full root-cause history of the fixes (PowerShell-runner timeouts, `uia.js` stdin-vs-file transport, SendKeys/JSON escaping, dialog focus, WinUI popup-window matching, etc.) lives in git history and the `eval/live-results/` logs — no longer retold here.

### Remaining work

- [ ] **Perception loop** — scenario 5 (detect human-typed input) still needs one real `--interactive` run with a human at the keyboard.
- [ ] **Auto action execution** — scenario 8 (planner-driven NL execution) still needs one real signed-in run (all LLM calls proxy through the backend).
- [ ] **Scenario 11 (workspace profiles)** — added 2026-09-04; needs a live desktop run before it counts toward the tally.
- [ ] **`input_hold`** — held keys/buttons still lack a real-desktop regression test; add one.
- [ ] **Reliability tally** — run each scenario ≥10 times across different sessions/days and require 90%+ per scenario (see the gate below).

### Gate: keep purchasing off until the readiness bar is met

- [x] Purchase-gate toggle (admin) blocks new/upgraded Pro subscriptions server-side; downgrade to Free always works.
- [x] Upgrade CTAs disabled/caveated on Pricing, Profile, UsageMeter, and SimpleChat; plan info itself stays visible.
- [ ] **Existing Pro subscribers** — tell them plainly what works and what doesn't; don't leave them silently on a broken paid feature.
- [ ] **Account/transactional email plumbing** — verify end-to-end with a real email account before re-enabling purchasing:
  - Purchase confirmation (`subscriptionCreated`/`subscriptionUpdated`/`subscriptionCancelled`) actually arrives, inbox not spam.
  - Forgot/reset-password loop works for a real user, and the new password actually logs them in afterward.

**Readiness bar for turning purchasing/visibility back on:**
1. **Hard gate** — key simulation, perception, and auto-execution each work at all in ≥2 common apps. *(Met for the tested scenarios as of 2026-08-21.)*
2. **Reliability gate** — each of the 11 scenarios passes 9/10 across different sessions/days; on any consistent failure, fix and restart from zero.
3. **Account plumbing gate** — purchase confirmation and password reset confirmed working end-to-end with a real account.
4. Re-run the whole check after any significant change to the perception/action pipeline.

### The validation scenarios

Executable definitions live in [validate-core-functionality.js](../../simple-addon/server/automation/eval/validate-core-functionality.js) — a standalone script, deliberately **not** part of `npm test`/`npm run eval`, since it drives the real desktop. From `simple-addon/`:

```
npm run validate:core:list      # list the scenarios without running
npm run validate:core            # run all once (skips 5 unless --interactive; 8 without an LLM token)
npm run validate:core -- --only=1,2,4
npm run validate:core -- --runs=10
npm run validate:core -- --interactive
```

Each run prints a pass/fail/skip per scenario and writes JSON logs to `simple-addon/server/automation/eval/live-results/` — tally those for the 90%+ figure.

| # | Scenario | Passes when… |
|---|---|---|
| 1 | Type + save a note in Notepad | the saved file matches the typed string byte-for-byte |
| 2 | Calculator arithmetic by clicking | the displayed result is `19` |
| 3 | Rename a file in File Explorer | old name gone, new name exists, content/size intact |
| 4 | Alt-Tab between two open windows | foreground window is the expected one (both directions) |
| 5 | Detect human-typed input (interactive) | logged events reconstruct the sentence the human typed |
| 6 | Read UI state via perception | reported toggle states match ground truth |
| 7 | Record → compile → auto-replay | replay reproduces the same end state with no manual input |
| 8 | Planner-driven NL execution | final state matches the instruction's intent |
| 9 | Drag-and-drop with a moving path | the file/slider actually moved, not a click in place |
| 10 | Held input releases on focus loss | the key actually released after the focus switch |
| 11 | Workspace profile save → move → restore | window returns to its saved position/size |

Keep a running tally (date, pass/fail, failing step + observed vs expected) per scenario — that's the raw material for the 90%+ figure and for Phase 4.

---

## Phase 1 — Describe it plainly ✅ Done

Plain, factual homepage description, de-hyped Pricing taglines, and one concrete example ("show it once how you rename and file invoices…") are all shipped.

## Phase 2 — Streamline download, install, and update

- [x] Direct download link (`ADDON_DOWNLOAD_URL` → fixed, version-free portable asset name).
- [x] In-addon auto-update (`auto-updater.js`, periodic checks + install-on-quit).
- [x] Plain install/cert-trust copy in the live banner and Settings.
- [x] Easy opt-out toggle + documented portable removal.
- [ ] **Consider a single installer** — consolidate "download, trust cert, configure" into one flow if feasible.

## Phase 3 — Make the payment page honest

### Decided tier model

Only gate what costs real money (or finite personal time). Final model:

| What | Free | Pro |
|---|---|---|
| Price | $0 | $15/mo (or $144/yr) |
| AI chat — Bedrock Claude Haiku 4.5, metered | $0.50/mo credit | $10/mo credit |
| OCR — platform-funded, metered | same credit allowance | same credit allowance |
| Local automation & addon | Unlimited (fair use) | Unlimited (fair use) |
| Cloud storage | 100 MB | 50 GB |
| Live phone viewing | — | Included |
| Support | Community | Email |

Locked decisions: **no BYOK** (all cloud AI is operator-funded and metered); **OCR platform-funded**; **cancellation deferred to period end**; **annual billing** added; **no automation command cap**. (The admin `Special` flag can grant a specific user unlimited credits — see [special-user-flag.md](../../docs/implementation/special-user-flag.md); it's an admin tool, not a documented tier.)

### Remaining cleanup (from the 2026-09-07 pricing audit)

- [ ] Delete or rewrite `frontend/src/pages/Simple/Simple/Simple.jsx` (dead, hype-heavy, contradicts current pricing).
- [ ] Fix `stripeHelpers.js` `getPlanDisplayName` fallback `"(Full automation)"` wording.
- [ ] Fix `Net.jsx` plan chips — it reads a bare array but Redux stores `{ success, data }`.
- [ ] Update `emailTemplates.js` `subscriptionCancelledTemplate` to match deferred cancellation.
- [ ] Make `BillingDisclosure.jsx` cadence-aware (mention annual when selected).
- [ ] Remove vestigial custom-pricing plumbing in `checkoutUtils.js`/`useCheckoutState.js`/`useCheckoutHandlers.js`.
- [ ] Surface the $144/yr annual option in Terms §3.2 / Pricing once it's live in Stripe.
- [ ] Fix Terms §11.2 "DeepSeek" wording → Bedrock/Claude Haiku 4.5.
- [ ] Align `llmService.js` `injectMembershipContext` "priority support" → "Email support".
- [ ] Note the `backend/reports/support-tickets-*.json` GitHub-Models answer is historical.

## Phase 4 — Keep proving reliability (ongoing)

- [ ] Re-run the Phase 0 scenarios periodically as a regression check.
- [ ] Instrument real automation success/failure so the real-world rate (not just the test-scenario rate) is known — never claim more than it supports.
- [ ] Talk to the first real Pro subscribers (listen, not testimonials).

## Phase 5 — Honest, low-pressure free→paid path

- [x] Storage usage meters (Profile, Sidebar, Pricing), plain over-limit notices, and real 413 storage-limit enforcement on the authenticated save path.
- [ ] Sanity-check the $15/mo price across cohorts as a fairness check, not a persuasion experiment.
- [ ] Only then revisit the Tier 2/3 ideas (top-ups, lifetime, supporter) from the ethics doc — each validated before building; storage top-ups stay cost-justified, command top-ups don't.

## Phase 6 — In-addon dashboard ✅ Done (pending manual verification)

All tabs shipped (Status, Agent, Recorder & Skills, Workspace Profiles, Permissions, Eye Tracking, Updates, Triggers, Voice, Perception); tray trimmed to essentials; legacy popups deleted; nav dropdown + one-click web-app access added. The release pipeline now guards against re-publishing an existing version (CI check + `builtAt`/`releaseDate` stale-version detection).

- [ ] Still needs one deliberate manual pass of every tab in a running Electron session.

## Suggested order of execution

1. **Phase 0 first** — finish the reliability tally and the account-email gate before re-enabling purchasing.
2. Phase 3 cleanup items and Phase 4 are the ongoing work once the core is proven.
3. Phase 2's installer idea and Phase 6's manual verification can happen any time — they don't claim the core works.

## What "done" looks like

- Purchasing/visibility stays off until the Phase 0 readiness bar (hard + reliability + email) is genuinely met.
- Key simulation, perception, and auto-execution work reliably with a documented, honest success rate.
- Purchase confirmation and password reset are verified end-to-end with a real account.
- A visitor can tell what Simple does, plainly, with no hype.
- Download/install/update is as few steps as possible, each explained when needed.
- One lightweight dashboard for local controls; the webapp stays home to account/cloud features.
- Free vs Pro differ only on things that cost real money or time.
- Pro prospects see their real usage and an honest statement of what changes.
- Growth comes from word of mouth, not marketing pressure.
