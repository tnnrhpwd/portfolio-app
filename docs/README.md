# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup, usage, and business guides (current)
│   ├── FRONTEND_UI_STANDARD.md        # UI hub: the goal, theming, sizing, page template, checklist
│   ├── UI_LAYOUT.md                   # §5 — layout & motion, incl. §5.7 service pages
│   ├── UI_COMPONENTS.md               # §6–§9 — component recipes, page anatomy, do's and don'ts
│   ├── UI_DESIGN_RECORDS.md           # §11.x — dated design records (responsive + colour passes)
│   ├── LOGO_SYSTEM.md                 # The brand mark: geometry, colours, usage
│   ├── ASSETS.md                      # S3/CloudFront, image generation, sprite + audio pipelines, uploads
│   ├── OPERATIONS.md                  # Deployment topology, secrets & config, traffic analytics
│   ├── BUSINESS.md                    # Value proposition, tiers, monetization, the funnel
│   └── GAME_GUIDE.md                  # Building a canvas/Phaser game: layout, testing, save + leaderboards
├── implementation/                    # Architecture + feature plans (current)
│   ├── agent.md                       # Simple platform, repo map & the doc index (START HERE)
│   ├── BACKLOG.md                     # Everything still to do, in priority order
│   ├── Simple_Loop_Behaviour.md       # What the loop ACTUALLY does at runtime
│   ├── ADDON_TASK_FLOW.md             # Chat sentence → tool calls; testing the pieces without releasing
│   ├── ADDON_CHAT.md                  # The addon's own chat window — a mirror of /net's conversation
│   ├── AUTOMATION_SECURITY.md         # Threat model, safety surfaces, the Special tag + audit passes
│   ├── MARKETPLACE.md                 # Published skills & shared goals
│   ├── LLM_PROVIDERS.md               # Provider seam, model catalogue, the default model
│   ├── NET_CHAT.md                    # /net chat — routing, the repo agent, people in the rail
│   ├── NET_HARNESS_PLAN.md            # /net as an agent harness — gaps, ADRs, the P0..P7 plan
│   ├── GOALS.md                       # Goals — dream board, map, horizon, review, console, vision boards
│   ├── TALK.md                        # Member messaging + editing your own review
│   ├── PROFILES.md                    # Member pages, visibility, blocking
│   ├── PAGES.md                       # Routing manifest, /all, the header dropper
│   └── SUPPORT_TICKETS.md             # Support tickets & bug reports system
├── archive/                           # Historical / archived (reference only)
│   ├── README.md                      # What each archived doc covered (incl. removed ones)
│   ├── SIMPLE_MARKETPLACE_PLAN.md     # Superseded marketplace plan (pre-implementation)
│   └── coliseum/                      # Coliseum game design + art pipeline (archived)
│       ├── README.md                  # Index + reading order
│       ├── COLISEUM-SPEC.md           # Implementation-ready functional spec
│       ├── COLISEUM-ART.md            # Art: sprite pipeline, Blender spec, licenses, paperdoll
│       ├── COLISEUM_2026_REBUILD_PROMPT.md # Phased rebuild plan
│       └── sands-of-the-coliseum-gameplay.md # Detailed gameplay design
├── debugging/                         # Troubleshooting guides
│   └── debug-ocr.md                   # OCR debugging guide
└── images/                            # Referenced images (Coliseum UI reference + icons)
```

## 🚀 Quick Links

### The Simple platform (start here)
- [Platform & repo orientation](./implementation/agent.md) - **Start here.** What Simple is, how the repo is laid out, and which doc owns which subject. It carries no to-dos and no roadmaps by design — it is the map.
- [Backlog](./implementation/BACKLOG.md) - **The only place work items live.** Readiness gates, the roadmap, P0-P2, future capabilities, and the agreed epics, in priority order.
- [Simple Loop Behaviour](./implementation/Simple_Loop_Behaviour.md) - **Read before changing the loop.** What the loop actually does at runtime: real control flow, every exit condition, how to decode a `/simple` console log, and where the run diverges from the design.
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Threat model, trust boundaries, permissions, the admin "Special" tag and the four read-only views it grants, the consumer-facing safety surfaces, and the dated backend/data/script audit passes.
- [Support Tickets](./implementation/SUPPORT_TICKETS.md) - Bug reports, `/net` support tickets & contact messages.

### Feature records (the design history behind the plan)
A code comment cites the doc that owns the subject, never a chapter number — [`agent.md`](./implementation/agent.md) → *Where things live* is the map.
- [Marketplace](./implementation/MARKETPLACE.md) - Published skills and shared goals: namespace, versioning, trust ranking, `/market`.
- [LLM Providers](./implementation/LLM_PROVIDERS.md) - The provider seam, the catalogue the pickers use, and which model is the default.
- [Net Chat](./implementation/NET_CHAT.md) - How a `/net` message is routed, the repo agent that can change this repo, and the one-app pass that put people in the same pane.
- [Addon Chat](./implementation/ADDON_CHAT.md) - The addon's own chat window: the same conversation, the same cloud store and the same wording as `/net`, driven by the local agent loop.
- [Goals](./implementation/GOALS.md) - The Dream board, goal map, optional horizon, the review pass and live console, and vision boards.
- [Talk](./implementation/TALK.md) - The messenger: storage, encryption (not end-to-end), limits, avatars, unread counts.
- [Profiles](./implementation/PROFILES.md) - `/u/<username>`, private-by-default visibility, and blocking without telling them.
- [Pages](./implementation/PAGES.md) - `constants/pages.js` as the single routing table, `/all`, and the header dropper.

### Getting Started (look, assets, deployment)
- [Frontend UI Standard](./guides/FRONTEND_UI_STANDARD.md) - **Read before building pages.** The goal, how theming works, responsive sizing, the canonical page template, and the pre-merge checklist. The rest of the standard sits beside it, with its section numbers unchanged: [layout & motion](./guides/UI_LAYOUT.md) (§5), [components & page anatomy](./guides/UI_COMPONENTS.md) (§6–§9), [design records](./guides/UI_DESIGN_RECORDS.md) (§11.x).
- [Brand mark](./guides/LOGO_SYSTEM.md) - The logo's geometry, colours and usage.
- [Assets & Asset Pipelines](./guides/ASSETS.md) - S3/CloudFront provisioning and day-to-day asset workflow, Bedrock image generation, the sprite and audio pipelines, and the app's own upload path.
- [Operations](./guides/OPERATIONS.md) - How Netlify (frontend + keep-warm) and Render (backend) fit together, where secrets and config come from, and the referer-traffic analytics.

### Games (canvas / Phaser)
- [Game Guide](./guides/GAME_GUIDE.md) - **Read before building or changing a canvas game.** Architecture, the two-layout portrait/landscape system, how to test a game in the browser, the gotchas that cost real time, and how saved progress + a public leaderboard ride the generic `/api/data` routes. Rocket is the reference implementation.

### Business
- [Business](./guides/BUSINESS.md) - What the product is worth, who the customer is, what each tier buys, the monetization levers, and the funnel as built (Discovery → Understanding → Buying, with the per-page contract and CTA policy).

### Historical (reference only)
- [Archive index](./archive/README.md) - Superseded docs (incl. the superseded marketplace plan)
- [Coliseum index](./archive/coliseum/README.md) - Coliseum game design + art pipeline (archived)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
