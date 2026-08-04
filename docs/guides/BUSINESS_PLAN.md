# Business Plan (Concise)

## The one-sentence version

**Simple gives non-technical Windows users a personal agent that watches what they do on their PC and does the repetitive parts for them — without writing a single line of code or automation script.**

---

## What you are actually providing customers

Strip away the pricing tiers and infrastructure talk — here is the actual value, in plain terms:

### 1. Time back, not "automation software"
Customers aren't buying "automation" as an abstract feature. They're buying **relief from doing the same boring clicks/keystrokes/data-entry over and over**. The product's job is to notice a repeated pattern (or take a plain-English instruction) and carry it out reliably, so the person doesn't have to.

### 2. Automation without technical skill
Traditional automation tools (AutoHotkey, Power Automate, Zapier, macros) require the user to think like a programmer — write scripts, define triggers, debug logic. Simple's differentiation is that **the user can just describe the goal in plain English (or let the agent watch and learn), and it figures out the steps.** That's the real product: removing the technical barrier, not the automation itself.

### 3. A second set of eyes/hands on their own machine
Because Simple perceives screen, input, and (optionally) audio, it can act as a live assistant — not just a script runner. Practical value: "watch for this and alert me," "do this thing while I'm away," "remember how I did this task and repeat it." This is closer to hiring a very literal personal assistant for your computer than to installing a utility.

### 4. A conversational AI chat that's actually wired into your machine
Most AI chat tools can only talk. The AI chat here is tied to the same agent that can act — so the differentiation from generic ChatGPT-style tools is that the customer can ask it to *do* something on their PC, not just explain how.

### 5. Their data stays theirs, with straightforward cloud sync/storage
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

## Why someone would pay (the actual value exchange)

- **Free tier** exists to let people experience "it actually works" firsthand — with their own AI API key so it costs you nothing, and a daily automation cap that's generous enough to solve a real small task.
- **Pro tier ($15/mo)** is worth paying once someone hits the free daily automation cap regularly — i.e., once the tool has already proven it saves them real time, they pay to remove the ceiling. This is the honest reason people upgrade: **proven value first, payment second.** Concretely, per the current [pricing config](/c:/Users/tanne/Documents/Github/portfolio-app/frontend/src/constants/pricing.js), Pro raises the daily automation limit (50 → 5,000/day), raises cloud storage (100 MB → 50 GB), adds live screen viewing from your phone, and adds email support — it does not add more AI capability, since AI chat is bring-your-own-key on both tiers.
- This is why Tier 1 of the [monetization strategies doc](./ETHICAL_MONETIZATION_STRATEGIES.md) (perfecting the free→pro funnel) matters more than inventing new revenue streams: the entire business model depends on the free experience being good enough to convince someone the paid ceiling is worth removing.

---

## What you are NOT providing (keep this clear so messaging doesn't drift)

- Not a course or tutorial product — you are not teaching automation, you're doing it for the user.
- Not a general-purpose chatbot — the chat's value is that it's connected to real actions on the user's PC.
- Not enterprise RPA software (like UiPath) — you're not competing on compliance/governance features for large orgs; you're competing on **ease of use for one person on one PC.**

---

## The realistic path to a sustainable business

1. **Prove the core loop works reliably** for one well-defined use case (e.g. "watch this repeated task and replay it on command") before broadening scope. Reliability is the actual product risk right now, not pricing.
2. **Get free-tier users to a real "aha" moment fast** — the free plan's job is to convert skepticism ("can an AI really do this on my PC?") into trust within the first session.
3. **Let the Pro upgrade be a natural consequence of hitting a real, felt limit** (the daily command cap), not a forced paywall on core value.
4. **Talk to your first paying customers directly** — a handful of 1:1 conversations with actual Pro subscribers will tell you more about what to build next than any speculative feature list.
