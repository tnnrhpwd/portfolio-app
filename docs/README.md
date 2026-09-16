# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup, usage, and business guides (current)
│   ├── FRONTEND_UI_STANDARD.md       # How every page should look/behave + the design records
│   ├── AWS_SETUP_GUIDE.md            # AWS: S3/CloudFront setup + static assets + AI image generation
│   ├── STATIC_ASSETS_AND_IMAGE_GENERATION.md # S3/CloudFront assets, image generation, sprite + audio pipelines, uploads
│   ├── GAME_GUIDE.md                 # Building a canvas/Phaser game: layout, testing, save + leaderboards
│   ├── SECRETS_MANAGEMENT.md         # Secrets Manager + .env backup + provider keys (e.g. DeepSeek)
│   ├── DEPLOYMENT.md                 # Netlify + Render deployment topology
│   ├── REFERER_TRACKING_README.md    # Analytics and tracking setup
│   ├── SALES_FUNNEL.md               # Visitor → Pro subscriber funnel map
│   └── BUSINESS_PLAN.md              # Value proposition + monetization strategies
├── implementation/                    # Architecture + feature plans (current)
│   ├── agent.md                      # Simple platform, repo map & the doc index (START HERE)
│   ├── BACKLOG.md                    # Everything still to do, in priority order
│   ├── Simple_Loop_Behaviour.md       # What the loop ACTUALLY does at runtime
│   ├── AUTOMATION_SECURITY.md        # Threat model, safety surfaces + the audit passes
│   ├── MARKETPLACE.md                # Published skills & shared goals
│   ├── LLM_PROVIDERS.md              # Provider seam, model catalogue, the default model
│   ├── NET_CHAT.md                   # /net chat — routing, the repo agent, people in the rail
│   ├── GOALS.md                      # Goals — dream board, map, horizon, review, console, vision boards
│   ├── TALK.md                       # Member messaging + editing your own review
│   ├── PROFILES.md                   # Member pages, visibility, blocking
│   ├── PAGES.md                      # Routing manifest, /all, the header dropper
│   ├── SUPPORT_TICKETS.md            # Support tickets & bug reports system
│   └── special-user-flag.md          # Admin "Special" unlimited-credits flag
├── archive/                           # Historical / archived (reference only)
│   ├── README.md                     # What each archived doc covered (incl. removed ones)
│   ├── SIMPLE_MARKETPLACE_PLAN.md    # Superseded marketplace plan (pre-implementation)
│   └── coliseum/                     # Coliseum game design + art pipeline (archived)
│       ├── README.md                 # Index + reading order
│       ├── COLISEUM-SPEC.md          # Implementation-ready functional spec
│       ├── sands-of-the-coliseum-gameplay.md # Detailed gameplay design
│       ├── COLISEUM_2026_REBUILD_PROMPT.md # Phased rebuild plan
│       ├── ASSET-LICENSES.md         # Asset provenance + budget
│       ├── Coliseum-Sprite-Pipeline.md # 3D→2D sprite pipeline
│       ├── Coliseum-Blender-Authoring.md # Blender authoring checklist
│       └── Paperdoll.md              # AI modular paperdoll rigging idea
├── debugging/                         # Troubleshooting guides
│   └── debug-ocr.md                  # OCR debugging guide
└── images/                            # Referenced images (Coliseum UI reference + icons)
```

## 🚀 Quick Links

### The Simple platform (start here)
- [Platform & repo orientation](./implementation/agent.md) - **Start here.** What Simple is, how the repo is laid out, and which doc owns which subject. It carries no to-dos and no roadmaps by design — it is the map.
- [Backlog](./implementation/BACKLOG.md) - **The only place work items live.** Readiness gates, the roadmap, P0-P2, future capabilities, and the agreed epics, in priority order.
- [Simple Loop Behaviour](./implementation/Simple_Loop_Behaviour.md) - **Read before changing the loop.** What the loop actually does at runtime: real control flow, every exit condition, how to decode a `/simple` console log, and where the run diverges from the design.
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Threat model, trust boundaries, permissions, the consumer-facing safety surfaces, and the dated backend/data/script audit passes.
- [Support Tickets](./implementation/SUPPORT_TICKETS.md) - Bug reports, `/net` support tickets & contact messages.
- [Special User Flag](./implementation/special-user-flag.md) - Admin "Special" unlimited-credits flag, plus the four read-only admin views it grants.

### Feature records (the design history behind the plan)
A code comment cites the doc that owns the subject, never a chapter number — [`agent.md`](./implementation/agent.md) → *Where things live* is the map.
- [Marketplace](./implementation/MARKETPLACE.md) - Published skills and shared goals: namespace, versioning, trust ranking, `/market`.
- [LLM Providers](./implementation/LLM_PROVIDERS.md) - The provider seam, the catalogue the pickers use, and which model is the default.
- [Net Chat](./implementation/NET_CHAT.md) - How a `/net` message is routed, the repo agent that can change this repo, and the one-app pass that put people in the same pane.
- [Goals](./implementation/GOALS.md) - The Dream board, goal map, optional horizon, the review pass and live console, and vision boards.
- [Talk](./implementation/TALK.md) - The messenger: storage, encryption (not end-to-end), limits, avatars, unread counts.
- [Profiles](./implementation/PROFILES.md) - `/u/<username>`, private-by-default visibility, and blocking without telling them.
- [Pages](./implementation/PAGES.md) - `constants/pages.js` as the single routing table, `/all`, and the header dropper.

### Getting Started
- [Frontend UI Standard](./guides/FRONTEND_UI_STANDARD.md) - **Read before building pages.** Theming, responsive sizing, and the canonical page template
- [AWS Setup & Assets Guide](./guides/AWS_SETUP_GUIDE.md) - S3/CloudFront setup (Part 1), static asset management (Part 2), and AI image generation via Bedrock (Part 3)
- [Static Assets & Asset Pipelines](./guides/STATIC_ASSETS_AND_IMAGE_GENERATION.md) - S3/CloudFront workflow, Bedrock image generation, the sprite and audio pipelines, and the app's own upload path
- [Secrets Management](./guides/SECRETS_MANAGEMENT.md) - AWS Secrets Manager (Part 1) + encrypted `.env` backup (Part 2) + provider-key worked example (Part 3)
- [Deployment Topology](./guides/DEPLOYMENT.md) - How Netlify (frontend + keep-warm) and Render (backend) fit together

### Games (canvas / Phaser)
- [Game Guide](./guides/GAME_GUIDE.md) - **Read before building or changing a canvas game.** Architecture, the two-layout portrait/landscape system, how to test a game in the browser, the gotchas that cost real time, and how saved progress + a public leaderboard ride the generic `/api/data` routes. Rocket is the reference implementation.

### Business
- [Sales Funnel](./guides/SALES_FUNNEL.md) - Visitor → Pro subscriber funnel map (Discovery → Understanding → Buying)
- [Business Plan](./guides/BUSINESS_PLAN.md) - What value the product provides, who the customer is, and realistic monetization strategies

### Historical (reference only)
- [Archive index](./archive/README.md) - Superseded docs (incl. the superseded marketplace plan)
- [Coliseum index](./archive/coliseum/README.md) - Coliseum game design + art pipeline (archived)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
