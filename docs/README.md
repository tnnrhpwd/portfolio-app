# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup, usage, and business guides (current)
│   ├── FRONTEND_UI_STANDARD.md       # How every page should look/behave
│   ├── AWS_SETUP_GUIDE.md            # AWS: S3/CloudFront setup + static assets + AI image generation
│   ├── STATIC_ASSETS_AND_IMAGE_GENERATION.md # Static assets (S3/CloudFront) + Bedrock image generation reference
│   ├── SECRETS_MANAGEMENT.md         # Secrets Manager + .env backup + provider keys (e.g. DeepSeek)
│   ├── DEPLOYMENT.md                 # Netlify + Render deployment topology
│   ├── REFERER_TRACKING_README.md    # Analytics and tracking setup
│   ├── SALES_FUNNEL.md               # Visitor → Pro subscriber funnel map
│   └── BUSINESS_PLAN.md              # Value proposition + monetization strategies
├── implementation/                    # Architecture + feature plans (current)
│   ├── simple-agent-prompt.md        # Simple platform plan & architecture (START HERE)
│   ├── AUTOMATION_SECURITY.md        # Automation threat model & security
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
- [Platform Plan & Architecture](./implementation/simple-agent-prompt.md) - **Start here.** Vision, architecture, the O-O-G-P-A agent loop, marketplace, skill generalization, monetization, roadmap, and the living to-do — all in one place.
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Threat model, trust boundaries, and permissions.
- [Support Tickets](./implementation/SUPPORT_TICKETS.md) - Bug reports, `/net` support tickets & contact messages.
- [Special User Flag](./implementation/special-user-flag.md) - Admin "Special" unlimited-credits flag.

### Getting Started
- [Frontend UI Standard](./guides/FRONTEND_UI_STANDARD.md) - **Read before building pages.** Theming, responsive sizing, and the canonical page template
- [AWS Setup & Assets Guide](./guides/AWS_SETUP_GUIDE.md) - S3/CloudFront setup (Part 1), static asset management (Part 2), and AI image generation via Bedrock (Part 3)
- [Static Assets & Image Generation](./guides/STATIC_ASSETS_AND_IMAGE_GENERATION.md) - Day-to-day S3/CloudFront asset workflow + Bedrock image generation reference
- [Secrets Management](./guides/SECRETS_MANAGEMENT.md) - AWS Secrets Manager (Part 1) + encrypted `.env` backup (Part 2) + provider-key worked example (Part 3)
- [Deployment Topology](./guides/DEPLOYMENT.md) - How Netlify (frontend + keep-warm) and Render (backend) fit together

### Games (canvas / Phaser)
- [Rocket Game Guide](./guides/Rocket-Game-Guide.md) - **Read before building or changing a canvas game.** Architecture, the two-layout portrait/landscape system, how to test a game in the browser, and the gotchas that cost real time
- [Rocket Asset Pipeline](./guides/Rocket-Asset-Pipeline.md) - Turning the AI-generated asset posters into 282 named transparent PNGs (`scripts/rocket/extract-sprites.js`)
- [Rocket Audio Pipeline](./guides/Rocket-Audio-Pipeline.md) - Music + SFX rendered offline from `scripts/rocket/audio.json` by a dependency-free chiptune engine (no subscriptions; why AI audio was ruled out)

### Business
- [Sales Funnel](./guides/SALES_FUNNEL.md) - Visitor → Pro subscriber funnel map (Discovery → Understanding → Buying)
- [Business Plan](./guides/BUSINESS_PLAN.md) - What value the product provides, who the customer is, and realistic monetization strategies

### Historical (reference only)
- [Archive index](./archive/README.md) - Superseded docs (incl. the superseded marketplace plan)
- [Coliseum index](./archive/coliseum/README.md) - Coliseum game design + art pipeline (archived)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
