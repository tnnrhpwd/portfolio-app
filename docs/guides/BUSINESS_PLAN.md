# Business Plan (Concise)

## The one-sentence version

**Simple gives non-technical Windows users a personal agent that watches what they do on their PC and does the repetitive parts for them — without writing a single line of code or automation script.**

---

## What you are actually providing customers

Strip away the pricing tiers and infrastructure talk — here is the actual value, in plain terms:

### Time back, not "automation software"
Customers aren't buying "automation" as an abstract feature. They're buying **relief from doing the same boring clicks/keystrokes/data-entry over and over**. The product's job is to notice a repeated pattern (or take a plain-English instruction) and carry it out reliably, so the person doesn't have to.

### Automation without technical skill
Traditional automation tools (AutoHotkey, Power Automate, Zapier, macros) require the user to think like a programmer — write scripts, define triggers, debug logic. Simple's differentiation is that **the user can just describe the goal in plain English (or let the agent watch and learn), and it figures out the steps.** That's the real product: removing the technical barrier, not the automation itself.

### A second set of eyes/hands on their own machine
Because Simple perceives screen, input, and (optionally) audio, it can act as a live assistant — not just a script runner. Practical value: "watch for this and alert me," "do this thing while I'm away," "remember how I did this task and repeat it." This is closer to hiring a very literal personal assistant for your computer than to installing a utility.

### A conversational AI chat that's actually wired into your machine
Most AI chat tools can only talk. The AI chat here is tied to the same agent that can act — so the differentiation from generic ChatGPT-style tools is that the customer can ask it to *do* something on their PC, not just explain how.

### Their data stays theirs, with straightforward cloud sync/storage
Cloud storage isn't the product — it's a supporting feature so the customer's automations, chat history, and settings follow them and aren't lost if their PC dies. The value is continuity and peace of mind, not storage as a commodity.

---

## Who the customer actually is

Be specific — "everyone with a Windows PC" is not a customer segment. Realistic early segments, based on what the product does well:

| Segment | Their pain today | Why Simple helps |
|---|---|---|
| Non-technical power users (e.g. small business owners, admins) doing repetitive desktop tasks (data entry, report generation, file organizing) | They know *what* they want automated but can't code a macro or Power Automate flow | Plain-English instruction → agent executes, no scripting required |
| Solo professionals/freelancers with repetitive multi-step workflows (invoicing, client follow-ups, screen recording for tutorials) | Existing automation tools have too steep a learning curve for one person to justify learning | Fast time-to-value: describe the task once, it runs |
| Enthusiasts/tinkerers who like AI agents and want to test/build in this space | Curiosity about agentic AI, want a hands-on tool that "does things," not just chats | Live, tangible demonstration of an AI agent acting on their own PC |

Pick **one** of these to focus your messaging, onboarding, and first outreach on — trying to speak to all three dilutes the message. Given the product's current audience (portfolio site visitors, engineers, hobbyists), the **enthusiast/tinkerer** segment is probably your fastest path to your first 100 real paying users, with the **solo professional** segment as the segment to grow into once the product is more polished/reliable.

---

## Monetization strategies (realistic)

An earlier draft was too aspirational — it listed enterprise SLAs, marketplaces, and developer API licensing that assume a scale this project doesn't have yet. This section focuses on **what's actually achievable right now** for a solo/small-team product with a real but modest user base, using infrastructure that already exists (Stripe subscriptions via `Pay.jsx`/`CheckoutForm.jsx`, usage-metered plans in `Pricing.jsx`, the Simple desktop addon, AI chat, and cloud storage).

Ground rules for "realistic":
- No new revenue idea should require hiring, a sales team, or building an entirely new product category.
- Prefer ideas that extend code you already have (Stripe checkout, usage tracking, storage limits) over ones requiring new infrastructure.
- Only charge for things that cost you real, measurable money (LLM tokens, storage, compute, bandwidth) or that solve a specific, validated pain point a user already told you about.
- Validate demand cheaply (a waitlist button, a "would you pay for this?" prompt, a support-channel request) before building anything big.

This is why Tier 1 below (perfecting the free→pro funnel) matters more than inventing new revenue streams: the entire business model depends on the free experience being good enough to convince someone the paid ceiling is worth removing.

### Tier 1 — Do these first (low effort, uses existing infrastructure)

#### Keep perfecting the core Free → Pro upgrade path
This is already your main revenue mechanism and it's the most realistic lever you have. The highest-leverage move isn't inventing new tiers — it's making the existing $15/mo Pro plan convert better:
- Show a usage meter in-app for storage (e.g. "82 MB/100 MB used") so users *see* the ceiling before they hit it — this is honest and drives upgrades far better than a surprise limit. (Automation commands are not gated per the cost-based tiering below — see note there.)
- Add a "you're at 90% of your daily limit — upgrade or wait until tomorrow" banner instead of a hard block. Never silently fail a request.
- A/B test the Pro price itself. $15 may be under- or over-priced for what it delivers — you won't know until you try $9 or $19 with new signups for a month each.

**Why realistic:** zero new features required, just UX/pricing tuning on code that already exists.

#### Annual billing discount
Offer "$15/mo or $144/yr (2 months free)" — a standard, well-understood, ethical incentive that improves cash flow and retention with about a day of Stripe + `CheckoutForm.jsx` work.

**Why realistic:** Stripe supports this natively; it's a pricing/config change, not new product work.

#### Storage top-up packs (one-time, not subscription)
For users who are 90% happy on Free but occasionally need more storage (e.g. a busy week), let them buy a one-time top-up ($3 for +5GB for the month) instead of committing to a full Pro subscription. (Not command top-ups — per *Growth and conversion levers* below, automation commands aren't gated since running them locally costs nothing.)
- Captures revenue from price-sensitive users who'd otherwise churn away rather than subscribe.
- Needs one new Stripe one-time-payment flow. You already have subscription checkout in `CheckoutForm.jsx` — adding a one-time SKU is a smaller lift than it sounds.

**Why realistic:** small, well-scoped engineering task; directly tied to real infra cost (compute/storage).

### Tier 2 — Do these next (moderate effort, validate demand first)

#### A genuinely useful one-time "Pro feature" for non-subscribers
Some users just dislike recurring billing. Pick **one** feature existing Pro users value most (ask them which feature they'd miss most) and offer it as a one-time lifetime unlock (e.g. "$39 once: live phone screen viewing, forever").
- Validate first: survey your current paying users — "would you rather pay $39 once for X than $15/mo?" If nobody says yes, skip this entirely.

**Why realistic:** low build cost if #3's one-time payment flow already exists; only build if you get real signal, not because it sounds clever.

#### Scheduled/background automation reminders (small paid add-on)
Simple runs locally today. A genuinely differentiated paid feature: let a user schedule an automation to run at a specific time, starting with the cheapest possible version — a scheduled notification/email reminder ("time to run your automation") — before ever building actual remote/cloud execution.
- Only invest in full server-side execution (a real, ongoing infra cost) once you have paying demand for the lightweight reminder version.

**Why realistic:** staged approach — cheap version first, expensive version only if validated by real usage.

#### "Supporter" tier priced honestly as patronage
A $3-5/mo tier with a small non-functional perk (badge, name on a credits page, early access to a beta toggle) for users who like the product and want to support it, independent of needing more automation commands.
- Only pursue this if you already see qualitative signs of goodwill (support emails, reviews, community messages thanking you) — it will not perform for a product without an emotionally engaged niche audience.

**Why realistic:** cheap to build (a Stripe price + a small profile badge), but only worth doing with real evidence of user goodwill first.

---

## Monetization — 🟡 provider-boundary credit gate shipped (UX copy + full integration matrix remain)

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](../implementation/agent.md)). Section names are the reference
> here — no chapter numbers.


Freemium, gated at one seam (the LLM provider interface, `LLM_PROVIDERS.md`) — not scattered
through feature code. Downgrade/expiry falls back to the free path without
breaking an installed skill's core replay.


### Decided tier model

| What | Free | Pro |
|---|---|---|
| Price | $0 | $15/mo (or $144/yr) |
| AI chat — cheapest configured cloud model (today DeepSeek-V3; Claude Haiku 4.5 also available), metered | $0.50/mo credit | $10/mo credit |
| OCR — platform-funded, metered | same credit allowance | same credit allowance |
| Local automation & addon | Unlimited (fair use) | Unlimited (fair use) |
| Cloud storage | 100 MB | 50 GB |
| Live phone viewing | — | Included |
| Support | Community | Email |

Locked decisions: **no BYOK** (all cloud AI is operator-funded and metered);
**OCR platform-funded**; **cancellation deferred to period end**; **annual billing**;
**no automation command cap**. (The admin `Special` flag can grant a specific user
unlimited credits — see [`special-user-flag.md`](../implementation/special-user-flag.md); it's an admin
tool, not a documented tier.)


### Monetization checklist — 🟡 partially implemented (provider-boundary gate shipped)

The meter already lived in `backend/utils/apiUsageTracker.js`
(`MEMBERSHIP_LIMITS` / `getMembershipLimit` / `canMakeApiCall` / `trackApiUsage`).
The gap was **enforcement at the provider boundary** — `agent-chat`/`agent-vision`
invoked Bedrock without checking it. That gate now exists.

- ✅ Enforce the credit limit at the provider boundary only — `agentChatProxy` /
  `agentVisionProxy` (`backend/controllers/workspaceController.js`) call
  `canMakeApiCall` before Bedrock, return a structured 402 (`planRequired`,
  `membership`, `limit`, `creditsRemaining`, `upgradeUrl`) when blocked, then
  `trackApiUsage` with the real token counts after success.
- ✅ Per-tier limits in one config table — `MEMBERSHIP_LIMITS` (Free $0.50 / Pro
  $10) in `backend/utils/apiUsageTracker.js`; local automation stays unmetered.
- 🟡 Downgrade immediately reflects in the limit — `getMembershipLimit(userRank)`
  resolves the rank from Stripe per call, so a downgrade/cancel drops the
  allowance on the next cloud-LLM call. (Grace-period copy and the local-path
  fallback for chat remain.)
- ✅ Blocked-call UX copy — `SimpleChat.jsx` already renders an "Usage Limit
  Reached → Upgrade" message for 402/credit/limit errors in both chat paths
  (and `dataService.js` shows upgrade toasts). The structured fields
  (`planRequired`/`membership`/`limit`/`creditsRemaining`/`upgradeUrl`) now also
  flow through `workspace-client.js` for richer copy later.
- 🟡 Integration tests — route gate covered in
  `backend/controllers/workspaceAgentGate.test.js`; the free/paid/expired/
  grace state machine now has unit coverage in
  `backend/utils/apiUsageTracker.test.js` (`getMembershipLimit`,
  `needsMonthlyReset`, `performMonthlyReset`). A full route-layer pass against
  real DynamoDB/Stripe fixtures remains.


### Example marketable use cases

Concrete "show don't tell" scenarios for marketing/onboarding — each a plausible
single-demo recording in plain language with the payoff up front.

1. **Never organize your downloads again** — show it once; every messy file sorts itself forever.
2. **Grind your video game while you live your life** — show it the repetitive part; it keeps playing.
3. **Fill out the same form a hundred times** — it repeats your exact answers.
4. **Turn 10,000 photos into an organized album overnight** — it renames your collection.
5. **Copy information between programs** — it does the rest of your list.
6. **Get your daily report before you sit down** — it builds, saves, and emails it.
7. **Post once, appear everywhere** — it shares to all your accounts.
8. **Wake up to a clean inbox** — it keeps email tidy around the clock.
9. **Turn a shoebox of receipts into a budget** — it reads and totals them.
10. **Keep your game character stocked 24/7** — it handles shopping/crafting/cleanup.
11. **Make a folder of photos look professional** — it applies your edit to every photo.
12. **Never miss a sold-out item** — it watches and grabs it on restock.
13. **Turn messy notes into something you'd send** — it hands back a clean summary.
14. **Set up a new computer in minutes** — it repeats your setup.
15. **A tireless assistant for your files** — it flags what needs attention.
16. **Keep your media collection organized** — new downloads sort themselves.
17. **Apply to dozens of jobs while you do something else** — it repeats your info.
18. **Never build an expense report again** — it gathers, sorts, submits.
19. **Back up what matters, automatically** — copies on a schedule.
20. **Run your livestream like a one-person crew** — it switches scenes and saves clips.


### Growth & conversion levers — ⬜ planned (from [`BUSINESS_PLAN.md`](../guides/BUSINESS_PLAN.md))

The biggest revenue lever is converting the existing Free → Pro funnel, not
inventing new tiers. Ordered by effort/risk.

**Tier 1 — do first (extends existing Stripe + usage-tracking code):**

- ⬜ In-app usage meter for storage ("82 MB/100 MB used") so free users see the
  ceiling before they hit it, plus a "you're at 90% of your daily limit —
  upgrade or wait" banner instead of a hard block. **Never silently fail a request.**
- ⬜ Annual billing discount — "$15/mo or $144/yr (2 months free)".
- ⬜ One-time storage top-up packs (~$3 for +5 GB/month) for users who are 90%
  happy on Free but occasionally need more — captures price-sensitive churn
  without a full subscription. (Automation commands stay ungated: local runs
  cost nothing.)

**Tier 2 — validate demand first, then build:**

- ⬜ One-time lifetime unlock of *one* Pro feature (e.g. "live phone viewing,
  $39 once") for users who dislike recurring billing — survey current Pro users
  first; skip if there's no signal.
- ⬜ Scheduled automation — start with a local reminder ("time to run your
  automation"), graduate to real background/remote execution only when paying
  demand for the cheap version exists.
- ⬜ "Supporter" tier ($3–5/mo patronage: badge, credits page, beta toggle) —
  only pursue with real goodwill signals (support mail, reviews, community).

