# Action Plan (Single Source of Truth)

This is the one doc to work from going forward. It consolidates the reasoning from [BUSINESS_PLAN.md](./BUSINESS_PLAN.md) (what we're actually selling) and [ETHICAL_MONETIZATION_STRATEGIES.md](./ETHICAL_MONETIZATION_STRATEGIES.md) (how to monetize it honestly) into a concrete, ordered list of next steps. Those two docs remain as background/rationale — this doc is what you actually execute against.

## The premise, restated in one place

CSimple is an AI agent that perceives what a user does on their Windows PC and acts on their behalf, described in plain English instead of scripts. AI chat and cloud storage support that core loop. The Free tier's job is to let someone try it and see for themselves whether it's useful; Pro removes the daily ceiling once someone has already felt real value. Every action below either (a) fixes/validates that the core product actually works, (b) states plainly what the product does without oversell, (c) makes the payment moment honestly reflect what's being bought, or (d) makes the free→paid conversion more natural — none of it is about pushing harder on marketing.

## How to use this document

This is a **living checklist, not a one-time script.** A large part of it — especially Phase 0 — depends directly on the addon's real implementation state, which changes as you work on it. Treat it accordingly:
- Check items off (`- [x]`) as they're actually done, and add new checklist items as new gaps are found — don't let the doc drift out of sync with reality the way the old pricing docs did.
- Phase 0 (below) should be revisited and re-edited every time you make real progress on the addon — add newly-discovered broken features, remove ones that are now fixed, and be specific (which feature, what fails, roughly why) rather than leaving stale generic entries.
- Phases 1, 3, and 5 (copy, payment page, funnel) are largely **blocked by Phase 0** in spirit — there's limited point polishing descriptions or pricing for features that don't work yet. Feel free to do small, low-effort parts of them opportunistically, but don't treat them as urgent until Phase 0 items are actually resolved.

## A note on tone

This plan deliberately avoids marketing-speak, urgency, and persuasion tactics. The intent is **word of mouth, not advertising**: people who try it and find it genuinely useful will tell others. The site's job is to describe plainly and honestly what the product does, get out of the way, and let the product itself do the convincing. Concretely, that means:
- Prefer plain, factual descriptions over hype adjectives ("does X" instead of "revolutionary," "powerful," "game-changing").
- No fabricated urgency, no growth-hacking prompts, no aggressive upsell nudges.
- It's fine — good, even — if the homepage stays understated. The goal of copy changes below is *clarity*, not *persuasion*.

---

## Phase 0 — Fix the actually-broken core, and don't sell it until it works

This is the real top priority, ahead of everything else in this document. As of this writing, key parts of the core perceive→act loop are reported broken, not just unreliable:
- **Key simulation** — many parts of simulated keyboard/mouse input are not functional.
- **Perception loop (action perception)** — totally broken.
- **Auto action execution** — totally broken.

There's no honest way to describe, price, or word-of-mouth-market a product whose core loop doesn't work. Every other phase in this doc assumes a working core to be honest *about* — so until Phase 0 is resolved, treat Phases 1/3/5 as optional/opportunistic, not urgent.

### Update this section as you go

This list will be wrong the moment it's written, on purpose — it should track today's real state, not a fixed plan. Each time you fix, partially fix, or discover a new broken piece:
- Move fixed items to a `Fixed` note (or just delete the line) instead of leaving stale checkboxes.
- Add newly-discovered gaps as their own line, naming the specific feature/file and what breaks, not a vague restatement.
- Don't round up — if something "mostly" works, say what fails and when, not just "done."

- [ ] **Key simulation**: identify why simulated key/mouse input fails (relevant code: [action-service.js](/c:/Users/tanne/Documents/Github/portfolio-app/csimple-addon/server/action-service.js), [action-bridge.js](/c:/Users/tanne/Documents/Github/portfolio-app/csimple-addon/server/action-bridge.js), [automation/tools/input.js](/c:/Users/tanne/Documents/Github/portfolio-app/csimple-addon/server/automation/tools/input.js)) — get basic keystrokes and clicks working reliably before anything downstream that depends on them.
- [ ] **Perception loop**: get action perception (detecting what the user actually did) working end-to-end for at least one simple, well-defined case, before claiming it handles the general "perceives what you do" case anywhere in copy.
- [ ] **Auto action execution**: get automatic playback/execution of a captured action sequence working reliably for that same simple case.
- [ ] **(Add new gaps here as they're found.)**

### Gate: hide and disable purchasing until a real readiness bar is met

Until the above is fixed, the app should not be selling something that doesn't work. Concretely:

- [x] **Disable the ability to purchase Pro** (checkout/payment flow) while Phase 0 is unresolved — an admin-only "Purchase Gate" toggle now exists on the Admin page ([Admin.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Admin/Admin.jsx)). Turning it off instantly blocks new/upgraded Pro subscriptions server-side ([postHashData.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/controllers/postHashData.js) `subscribeCustomer`, enforced via [purchaseGateController.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/controllers/purchaseGateController.js)) — downgrading to Free always still works, so nobody gets stuck.
- [x] **Hide or clearly caveat CSimple mentions and entry points** — while the gate is paused, upgrade/"Choose Pro" CTAs are disabled with a "Not available yet" label and a caveat banner on [Pricing.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Pricing/Pricing.jsx), and upgrade buttons/prompts are hidden on [Profile.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Profile/Profile.jsx), [UsageMeter.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/components/CSimple/UsageMeter.jsx), and [CSimpleChat.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/components/CSimple/CSimpleChat.jsx). Pricing/plan info itself is left visible (still honest), only the buy action is gated.
- [ ] **Existing Pro subscribers**, if any, should be told plainly what does and doesn't work rather than silently left with a broken paid feature — handle this directly and honestly if it applies.

**Readiness bar for turning purchasing/visibility back on** (a metric worth having, even a rough one, so "ready" isn't just a feeling):
1. **Hard gate — each of these works at all**, tested manually across at least two different common apps: key simulation executes keystrokes/clicks reliably; the perception loop detects and logs user actions without crashing; auto-execution successfully replays at least one captured sequence end-to-end.
2. **Reliability gate — once (1) is true**, define ~5-10 representative recorded automations (e.g. "open app X and type Y," "click through a short repeated sequence") and re-run each one repeatedly. Require roughly a **90%+ success rate** across those runs before re-enabling purchases and public-facing mentions. If a scenario consistently fails, fix it and re-test rather than lowering the bar.
3. Re-run this same check after any significant change to the perception/action pipeline — reliability regressions are easy to introduce silently.

## Phase 1 — Describe what it does, plainly (messaging/copy)

The goal here is not to "sell harder" — it's that a visitor currently can't tell what the product does at all. Being humble doesn't require being unclear. State the facts plainly and let people decide for themselves.

- [ ] **Add a plain, factual description of CSimple somewhere on the homepage** in [Home.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Home/Home.jsx). This doesn't need to be a hero banner or a pitch — a single understated paragraph is enough: what it does, in plain terms, with no adjectives doing the selling. The personal-portfolio framing ("Steven Tanner Hopwood") can stay exactly as it is; this is about *adding* a clear, factual mention of the project, not replacing your identity with a sales pitch.
- [ ] **Rewrite the Pricing page taglines** in [Pricing.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Pricing/Pricing.jsx) for clarity, not persuasion. Current taglines ("Get started with the basics") are vague rather than promotional, so the fix is simply to state plainly what each tier actually includes and what changes between them — no calls to urgency, no "unlock the full power" language.
- [ ] **Add one concrete, factual example of what it does** near the top of the Pricing/CSimple pages — e.g. "You show it once how you rename and file invoices. After that, saying 'do the invoices' repeats those steps." Stated flatly, as a description, not a promise or a pitch.
- [ ] **Leave the About page as-is.** [About.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Simple/About/About.jsx) is your personal bio and that's a reasonable, honest thing for a personal site to lead with. No need to force it into product marketing.

## Phase 2 — Streamline download, install, and update

Right now getting the addon running takes several manual steps: find the GitHub Releases page ([AddonInstallPrompt.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/components/CSimple/AddonInstallPrompt.jsx) links straight to `github.com/tnnrhpwd/portfolio-app/releases`), pick the right asset, install it, trust a self-signed certificate, and separately notice and act on update banners ([useAddonDetection.js](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/hooks/csimple/useAddonDetection.js) checks GitHub tags and compares semver). For a word-of-mouth product, this first-run friction matters more than any copy: a friend telling a friend "just try it" only works if trying it is actually easy. None of this needs marketing — it needs to be simple.

- [ ] **Give the download link a clear, direct destination.** Linking to the full GitHub Releases list (`/releases`) makes a new user pick the right asset themselves. Point the Download/Update buttons in `AddonInstallPrompt.jsx` at the latest release asset directly (e.g. GitHub's `/releases/latest/download/<asset-name>` redirect), so clicking "Download" just downloads the right file — no picking through release notes or assets.
- [ ] **Reduce the cert-trust step, or explain it in one plain sentence at the moment it's needed.** `addonNeedsCertTrust`/`addonNeedsOptIn` in `useAddonDetection.js` indicate the addon uses a self-signed cert that the browser flags. If a proper certificate isn't practical, at minimum show one clear, plain-language explanation of why the browser warning appears and exactly what to click — right where the user hits it, not in separate docs.
- [ ] **Add an in-app auto-update check inside the addon itself**, not just a website banner. Today, detecting an outdated version depends on the user visiting the website while the addon happens to be running (`isOutdated` compares `addonStatus.version` to the latest GitHub tag). If the addon can check for and prompt/apply updates on its own (or self-update silently), users stay current without needing to come back to the site at all.
- [ ] **Consider a single installer instead of "download, then trust a cert, then configure."** If there are multiple manual setup steps today, look at consolidating them into one installer flow (standard Windows installer/MSI, or a setup wizard) so "download and run one file" is the entire experience.
- [ ] **Keep the install/update banner copy plain and factual**, consistent with Phase 1's tone — e.g. "This adds local automation and voice control, running on your PC" rather than "Enhance with C-Simple Addon" styled as a pitch. State what it does and let the person decide.
- [ ] **Make uninstalling/opting out just as easy as installing.** A product that's easy to remove is more trustworthy to install in the first place — check that a standard Windows uninstall entry exists and that opting out of the browser-side integration (`setAddonOptIn`) is clearly reachable from settings, not just a dismiss button on a banner.

## Phase 3 — Make the payment page say what's actually being bought

The current checkout (`Pricing.jsx` → `Pay.jsx` → `CheckoutForm.jsx` → `MembershipPlans.jsx`) presents plans as a features-list comparison. The goal of changes here is accuracy and transparency, not persuasion — a customer should be able to tell exactly what they get and why the price is what it is.

### Guiding principle for what's allowed to differ between tiers

**Only gate functionality that costs real, ongoing money (or your finite personal time) to provide.** Anything that runs entirely on the user's own PC with no server involvement should be free and unrestricted — restricting it anyway is artificial scarcity, which is both less ethical and a worse word-of-mouth story ("it's free but crippled" vs. "the core thing is basically free, we only charge for what actually costs us money").

### What each tier provides today, and what should change

Checked against [backend/constants/pricing.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/constants/pricing.js): `STORAGE_LIMITS` is a real, enforced byte value tied to actual S3 cost. `QUOTAS` (the 50/5,000 commands-per-day figures) is **display text only** — no backend code was found that actually meters or enforces it. So today's comparison is:

| | Free | Pro ($15/mo) | Costs real money? | Verdict |
|---|---|---|---|---|
| AI chat | Yes, your own API key (BYOK) | Same — no platform AI credit added | No — user's own key either way | Correctly free on both already ✅ |
| CSimple addon, local execution | "Download & run locally" | "Full addon access" | No — runs entirely on the user's PC | **Should not be gated at all.** The Free/Pro distinction here isn't justified by any cost difference — remove it. |
| Automation commands/day | 50/day (fair use) | 5,000/day (fair use) | No — currently unenforced, and even if enforced, a locally-run command costs nothing whether it's the 1st or 5,000th | **Drop this cap as a paid gate.** Automation should be unlimited on Free too, unless a specific step genuinely round-trips through your servers (see caveat below). |
| Cloud storage | 100 MB | 50 GB | **Yes** — real, linear S3 cost | Keep gating this — it's the model done right. |
| Live screen viewing from phone | Not included | Included | **Yes** — needs a cloud relay (server + bandwidth) to get video from PC to phone | Keep gating this — real ongoing infra cost. |
| Support | Community/self-serve | Email support | Costs your time, a real finite resource | Reasonable to keep as a Pro perk. |

**Caveat to check before finalizing:** if any part of the automation loop genuinely calls your own servers (not just the user's local addon or their own BYOK LLM calls), a quota tied to *that specific server-touching step* would still be legitimate under the "costs real money" principle — but it should be scoped narrowly to that step, not applied as a blanket cap on all local commands.

**Good news: a version of this already exists elsewhere in the docs.** [CSIMPLE_MARKETPLACE_PLAN.md](/c:/Users/tanne/Documents/Github/portfolio-app/docs/implementation/CSIMPLE_MARKETPLACE_PLAN.md) §4 ("Monetization gates") already proposes exactly this pattern for planned marketplace features: record/replay, hotkeys, and browsing/downloading skills stay free for everyone (they're local/no server cost), while LLM re-derivation, parameter inference, and vision-repair fallback are Pro-gated specifically because those steps call the backend's LLM. That's the caveat above, already applied correctly — use it as the template when correcting the current command-quota framing. (One item in that same table, "publish skills to marketplace: 1/day free vs. unlimited Pro," is worth revisiting under this same principle when that work is built — publishing costs a small, roughly fixed amount of storage/moderation, so a shared anti-abuse rate limit may fit better than a paid gate.)

- [ ] **Remove the "Full addon access" vs. "download & run locally" distinction** in [pricing.js](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/constants/pricing.js) (frontend) and [pricing.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/constants/pricing.js) (backend) — Free should state plainly that it includes the complete local addon, with no partial/full split.
- [ ] **Remove or replace the daily automation command cap** as a paid-tier gate. First confirm there's genuinely no server-side cost per command (per the caveat above); if confirmed, drop `QUOTAS`/`QUOTA_SHORT` from the tier comparison entirely, or keep a single, generous, identical-for-everyone technical safety limit (framed as an anti-abuse rail, not a purchased unlock) rather than a Free-vs-Pro difference.
- [ ] **Rewrite the Pro tier description to reflect only what genuinely differs**: more storage, live phone screen viewing, and email support — nothing else, once the above two items are corrected.
- [ ] **Show the user's real usage before they consider upgrading.** In [Pricing.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Pricing/Pricing.jsx) or [Pay.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/pages/Simple/Pay/Pay.jsx), if the visiting user is logged in, show their actual recent usage (e.g. storage used) as plain information above the plan cards — informational, not framed as a nudge to upgrade.
- [ ] **Make `MembershipPlans.jsx` feature lists plainly describe what each remaining difference means.** Check [MembershipPlans.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/components/Checkout/MembershipPlans.jsx) — the plan `tagline`/`features` currently come straight from the pricing config; once the config reflects only cost-justified differences, the copy just needs to state them plainly.
- [ ] **Verify `BillingDisclosure.jsx` and `LinkBenefits.jsx` are accurate and not generic Stripe boilerplate.** Read through both components referenced in `CheckoutForm.jsx` and confirm the disclosure language matches what's actually billed (subscription cadence, cancellation terms) — this is simply about accuracy and trust.
- [ ] **Add an annual billing option** directly into `MembershipPlans.jsx` / the Stripe price config — a plain, optional alternative for people who prefer to pay once a year, not a discount pushed with urgency.
- [ ] **Confirm the free tier's "bring your own API key" option is clearly explained at the point of choosing Free**, not buried in docs. State it factually (free forever, no bait-and-switch) rather than promoting it as a special deal.

### A real gap found while auditing the docs: OCR isn't BYOK, isn't gated, and isn't mentioned in the tier comparison at all

Tracing the code (not just the docs) turned up something worth acting on: [backend/services/ocrService.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/services/ocrService.js) uses the platform's own `OPENAI_KEY` (`process.env.OPENAI_KEY`) for OCR image-to-text extraction *and* its optional LLM post-processing step — this is a genuinely different situation from AI chat, which is BYOK. `apiUsageTracker.js`'s `canMakeApiCall` check has been updated to a "BYOK model — allowing call" stance that effectively never blocks this call, even though this specific call is **not** BYOK — it's billed to your own OpenAI account, for every user, on every tier, with only a generic anti-abuse rate limiter (`ocrLimiter` in `rateLimiter.js`) and no cost-based ceiling.

This is exactly the kind of thing the "only gate what costs real money" principle should catch, and today it doesn't:
- [ ] **Decide OCR's model deliberately**: either (a) make OCR BYOK too (user supplies their own key, consistent with chat), or (b) keep it platform-funded but add an actual cost-based fair-use limit (the way storage is limited today) so it isn't an unbounded, tier-blind expense, or (c) make generous platform-funded OCR a deliberate, acknowledged Free perk if the volume/cost is genuinely small — any of these is fine, but it should be a conscious choice, not an accidental gap.
- [ ] **If OCR stays platform-funded, mention it explicitly in the tier comparison** so the Pricing/Payment page reflects the true cost picture — right now a real expense is invisible in the product's own pricing story.

### Expand BYOK beyond GitHub — don't become "just another LLM provider," but stop requiring a GitHub PAT specifically

Stated goal: avoid hosting/reselling LLM access yourself (no platform markup, no becoming a middleman provider) — rely on the big providers directly via bring-your-own-key. Today that intent is only half-realized:

- The backend chat path in [llmService.js](/c:/Users/tanne/Documents/Github/portfolio-app/backend/services/llmService.js:152) hard-rejects every provider except `'github'` — real BYOK today means *specifically* a GitHub Personal Access Token used against GitHub Models, which requires the user to have a GitHub account with Models/Copilot access. That's an artificial narrowing of "bring your own key" down to "bring your own GitHub token."
- Confusingly, the frontend's `llmProvider` option literally named **"Cloud (Portfolio)"** ([AIWorkflowSettings.jsx](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/components/CSimple/AIWorkflowSettings.jsx:38)) is not BYOK at all — it uses your own `OPENAI_KEY`, billed to you, for every user who picks it. It's effectively a second, undocumented instance of the same "unmetered platform cost" gap as the OCR finding above.
- The building blocks for broader BYOK already exist: [createCompletionWithKey](/c:/Users/tanne/Documents/Github/portfolio-app/backend/utils/llmProviders.js:174) already accepts an arbitrary caller-supplied key and an OpenAI-compatible `baseURL` — the same pattern used for the GitHub PAT today would work equally well for a user-supplied OpenAI, Anthropic, or xAI key.

- [ ] **Add user-supplied key fields for OpenAI/Anthropic/xAI (in addition to GitHub PAT)**, reusing the existing `perUserKey`/`createCompletionWithKey` pattern in `llmProviders.js`, so someone without GitHub Models access can still bring their own key from a provider they already use.
- [ ] **Rename or remove the "Cloud (Portfolio)" option**, or turn it into what its name implies it should be — a clearly-labeled, deliberately rate-limited free trial/demo path funded by you, not something indistinguishable from real BYOK. Right now the label and the reality (platform-funded, unmetered) don't match.
- [ ] **State the actual BYOK principle plainly wherever AI is described** (Pricing page, Terms, Settings): "you bring a key from a major provider you already trust — GitHub, OpenAI, Anthropic, or xAI — we never see your usage or mark it up." This is a genuinely good, honest story once the GitHub-only limitation is lifted; it's worth saying plainly rather than leaving implicit.

## Phase 4 — Keep proving reliability with real users (after Phase 0's bar is met)

Per the business plan, reliability of the core perceive→act loop is the actual product risk, not pricing structure. Phase 0 covers getting the core to a working, gate-passing state before it's sold at all; this phase is what continues once that's true and purchasing/visibility is back on.

- [ ] **Keep the same narrow, well-defined scenarios from Phase 0's readiness bar as an ongoing regression check** — re-run them periodically, not just once, so a later change doesn't silently break what you validated.
- [ ] **Instrument success/failure of automation runs** in real usage (if not already tracked) so you know the real-world reliability rate, not just the rate from your own test scenarios — this number should directly inform what you're comfortable stating on the pricing/product pages. Don't describe more than the current reliability rate supports.
- [ ] **Listen to the first real Pro subscribers.** A handful of direct, low-key conversations ("what made this useful for you? what's missing?") should feed back into Phase 1/2/3 copy — this is about listening, not soliciting testimonials for marketing.

## Phase 5 — Let the free→paid path be honest and low-pressure

- [ ] Add an in-app usage meter for **storage** (the one real, cost-based limit), e.g. "82 MB / 100 MB used," so it's visible ahead of time rather than discovered as a surprise block. (No meter needed for automation commands once that cap is removed per Phase 3.)
- [ ] Replace any hard block at the storage limit with a plain, factual notice ("You've used all of your free storage — you can free up space or upgrade for more") — informational, not an upsell prompt.
- [ ] If you want to sanity-check the $15/mo Pro price is reasonable, it's fine to quietly compare a couple of price points across separate signup cohorts — but treat it as a fairness/affordability check, not a persuasion experiment, and don't let it drive aggressive framing.
- [ ] Only after the above: revisit Tier 2/3 ideas from [ETHICAL_MONETIZATION_STRATEGIES.md](./ETHICAL_MONETIZATION_STRATEGIES.md) (one-time top-ups, lifetime unlocks, supporter tier) — each still needs its own validation step (survey/support-request signal) before building, and each should stay low-key and optional rather than promoted hard. Note: a "storage top-up pack" remains a legitimate cost-based idea; a "command top-up pack" no longer fits once commands aren't gated.

---

## Suggested order of execution

0. **Phase 0 comes first, full stop.** Purchasing and public CSimple visibility stay off/caveated until its readiness bar is met — nothing else in this list matters to a customer if the core doesn't work.
1. Phase 1 (plain description) and Phase 3 (payment page accuracy) can be done in parallel once Phase 0 is resolved — both are copy/UX changes with no new backend work beyond usage-display (Phase 3's first item). Small, low-effort pieces can happen opportunistically even before Phase 0 finishes.
2. Phase 2 (install/update streamlining) can start any time — it's independent of the website copy work and arguably matters most for word-of-mouth, since a referred friend's first impression depends on it directly. Note it's still downstream of Phase 0 in effect: a smooth install of a broken core isn't much of a win yet.
3. Phase 4 (ongoing reliability validation) runs continuously after Phase 0's bar is met and purchasing is re-enabled — its findings should keep the Phase 1 description honest as real usage accumulates.
4. Phase 5 (funnel honesty) comes after 1, 3, and 4 have shipped, so any price check happens against accurate, settled copy.

## What "done" looks like

- Purchasing and public CSimple mentions are off (or plainly caveated as early/unfinished) until the Phase 0 readiness bar is genuinely met — nothing is sold that doesn't work.
- Key simulation, the perception loop, and auto-execution all work reliably for at least a defined set of real scenarios, with a known, honest success rate behind that claim.
- A new visitor can tell what CSimple does from a plain, factual description — no hype required, no confusion either.
- Downloading, installing, and staying up to date takes as few manual steps as possible, and each remaining step is explained in plain language exactly when it's needed.
- Free vs. Pro differ **only** on things that cost real money or time to provide (storage, phone relay, support) — nothing is gated just to create an upgrade incentive.
- A user considering Pro can see their own real usage and a clear, honest statement of what changes with the upgrade — informational, not persuasive.
- You have a documented, honest reliability rate for the core automation loop, and nothing on the site claims more than that.
- Growth continues to come primarily from people who tried it and told others, not from marketing pressure on the site itself.
