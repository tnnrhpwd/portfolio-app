# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup, usage, and business guides (current)
│   ├── ACTION_PLAN.md                # Consolidated next-steps plan (start here)
│   ├── SALES_FUNNEL.md               # Visitor → Pro subscriber funnel map
│   ├── FRONTEND_UI_STANDARD.md       # How every page should look/behave
│   ├── AWS_SETUP_GUIDE.md            # AWS: S3/CloudFront setup + static assets + AI image generation
│   ├── DEEPSEEK_SETUP.md             # DeepSeek API setup
│   ├── SECRETS_MANAGEMENT.md         # Secrets Manager + local .env backup/restore
│   ├── REFERER_TRACKING_README.md    # Analytics and tracking setup
│   ├── DEPLOYMENT.md                 # Netlify + Render deployment topology
│   ├── BUSINESS_PLAN.md              # What value the product provides
│   └── ETHICAL_MONETIZATION_STRATEGIES.md # Ad-free revenue ideas
├── implementation/                    # Architecture + feature plans (current)
│   ├── simple-agent-prompt.md        # Platform brief — Simple automation vision & spec
│   ├── OBSERVE-ORIENT-GOAL-PLAN-ACTION.md # Continuous agent loop — implementation plan
│   ├── AUTOMATION_ROADMAP.md         # Automation roadmap + vision + future capabilities
│   ├── AUTOMATION_SECURITY.md        # Automation threat model & security
│   ├── SIMPLE_MARKETPLACE_PLAN.md    # Marketplace & skill generalization plan
│   ├── SUPPORT_TICKETS.md            # Support tickets & bug reports system
│   └── special-user-flag.md          # Admin "Special" unlimited-credits flag
├── archive/                           # Historical / archived (reference only)
│   ├── README.md                     # What each archived doc covered
│   ├── API_USAGE_IMPLEMENTATION.md
│   ├── IMPLEMENTATION_STATUS.md
│   ├── LLM_IMPLEMENTATION_SUMMARY.md
│   ├── S3_INTEGRATION_SUMMARY.md
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

### Getting Started
- [Frontend UI Standard](./guides/FRONTEND_UI_STANDARD.md) - **Read before building pages.** Theming, responsive sizing, and the canonical page template
- [AWS Setup & Assets Guide](./guides/AWS_SETUP_GUIDE.md) - S3/CloudFront setup (Part 1), static asset management (Part 2), and AI image generation via Bedrock (Part 3)
- [Env Backup & Secrets](./guides/SECRETS_MANAGEMENT.md) - AWS Secrets Manager (single source of truth) + encrypted `.env` backup/restore
- [Deployment Topology](./guides/DEPLOYMENT.md) - How Netlify (frontend + keep-warm) and Render (backend) fit together

### Business
- [Action Plan](./guides/ACTION_PLAN.md) - **Start here.** Consolidated next steps: messaging, payment page accuracy, and funnel tuning
- [Sales Funnel](./guides/SALES_FUNNEL.md) - Visitor → Pro subscriber funnel map (Discovery → Understanding → Buying)
- [Business Plan](./guides/BUSINESS_PLAN.md) - What value the product provides customers, and why they pay
- [Ethical Monetization Strategies](./guides/ETHICAL_MONETIZATION_STRATEGIES.md) - Ad-free, course-free ways to provide value and generate revenue

### Features
- [Platform Brief](./implementation/simple-agent-prompt.md) - Simple automation: vision, marketplace, skill generalization, monetization
- [Observe → Orient → Goal → Plan → Action](./implementation/OBSERVE-ORIENT-GOAL-PLAN-ACTION.md) - Implementation plan for the continuous agent loop
- [Automation Roadmap](./implementation/AUTOMATION_ROADMAP.md) - Roadmap + architecture + future capabilities (voice, NL compiler, predictor, …)
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Threat model, trust boundaries, and permissions
- [Simple Marketplace Plan](./implementation/SIMPLE_MARKETPLACE_PLAN.md) - Marketplace & skill generalization plan (includes cost-based Free/Pro gating consistent with the Action Plan)
- [Support Tickets](./implementation/SUPPORT_TICKETS.md) - Bug reports, `/net` support tickets & contact messages; the `pull-support-tickets` export script, and the future-state plan for autonomous agent-driven fixes
- [Special User Flag](./implementation/special-user-flag.md) - Admin "Special" unlimited-credits flag (distinct from admin)
- [DeepSeek Setup](./guides/DEEPSEEK_SETUP.md) - DeepSeek API configuration

### Historical (reference only)
- [Archive index](./archive/README.md) - Superseded docs (old LLM/S3/usage/status summaries)
- [Coliseum index](./archive/coliseum/README.md) - Coliseum game design + art pipeline (archived)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
