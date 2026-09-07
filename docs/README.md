# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup, usage, and business guides (current)
│   ├── ACTION_PLAN.md                # Consolidated next-steps plan (start here)
│   ├── FRONTEND_UI_STANDARD.md       # How every page should look/behave
│   ├── AWS_SETUP_GUIDE.md            # AWS S3 + CloudFront configuration
│   ├── STATIC_ASSETS_GUIDE.md        # Static asset management
│   ├── AI_IMAGE_GENERATOR_GUIDE.md   # Generate images via AWS Bedrock
│   ├── DEEPSEEK_SETUP.md             # DeepSeek API setup
│   ├── SECRETS_MANAGEMENT.md         # Single source of truth for secrets
│   ├── ENV_BACKUP_GUIDE.md           # Encrypted .env backup/restore
│   ├── REFERER_TRACKING_README.md    # Analytics and tracking setup
│   ├── BUSINESS_PLAN.md              # What value the product provides
│   └── ETHICAL_MONETIZATION_STRATEGIES.md # Ad-free revenue ideas
├── implementation/                    # Architecture + feature plans (current)
│   ├── AUTONOMOUS_WINDOWS_AGENT_PLAN.md # Simple agent architecture plan
│   ├── OBSERVE-ORIENT-GOAL-PLAN-ACTION.md # Continuous agent loop — implementation plan
│   ├── AUTOMATION_ROADMAP.md         # Automation feature roadmap
│   ├── AUTOMATION_SECURITY.md        # Automation security model
│   ├── SIMPLE_MARKETPLACE_PLAN.md    # Marketplace & skill generalization plan
│   ├── SUPPORT_TICKETS.md            # Support tickets & bug reports system
│   ├── special-user-flag.md          # Admin "Special" unlimited-credits flag
│   └── simple-agent-prompt.md        # Agent system prompt reference
├── coliseum/                          # Coliseum game design + art pipeline
│   ├── README.md                     # Index + reading order
│   ├── COLISEUM-SPEC.md              # Implementation-ready functional spec
│   ├── sands-of-the-coliseum-gameplay.md # Detailed gameplay design
│   ├── COLISEUM_2026_REBUILD_PROMPT.md # Phased rebuild plan
│   ├── ASSET-LICENSES.md             # Asset provenance + budget
│   ├── Coliseum-Sprite-Pipeline.md   # 3D→2D sprite pipeline
│   ├── Coliseum-Blender-Authoring.md # Blender authoring checklist
│   └── Paperdoll.md                  # AI modular paperdoll rigging idea
├── archive/                           # Historical / superseded docs (reference only)
│   ├── README.md                     # What each archived doc covered
│   ├── API_USAGE_IMPLEMENTATION.md
│   ├── IMPLEMENTATION_STATUS.md
│   ├── LLM_IMPLEMENTATION_SUMMARY.md
│   └── S3_INTEGRATION_SUMMARY.md
├── debugging/                         # Troubleshooting guides
│   └── debug-ocr.md                  # OCR debugging guide
└── images/                            # Referenced images (UI + Coliseum assets)
```

## 🚀 Quick Links

### Getting Started
- [Frontend UI Standard](./guides/FRONTEND_UI_STANDARD.md) - **Read before building pages.** Theming, responsive sizing, and the canonical page template
- [AWS Setup Guide](./guides/AWS_SETUP_GUIDE.md) - Set up S3 and CloudFront
- [Static Assets Guide](./guides/STATIC_ASSETS_GUIDE.md) - Manage images and files
- [AI Image Generator Guide](./guides/AI_IMAGE_GENERATOR_GUIDE.md) - Generate images via AWS Bedrock and use them as repo assets
- [Env Backup Guide](./guides/ENV_BACKUP_GUIDE.md) - Back up/restore `.env` secrets without ever exposing them in the repo
- [Secrets Management](./guides/SECRETS_MANAGEMENT.md) - Single source of truth for secrets (AWS Secrets Manager)

### Business
- [Action Plan](./guides/ACTION_PLAN.md) - **Start here.** Consolidated next steps: messaging, payment page accuracy, and funnel tuning
- [Business Plan](./guides/BUSINESS_PLAN.md) - What value the product provides customers, and why they pay
- [Ethical Monetization Strategies](./guides/ETHICAL_MONETIZATION_STRATEGIES.md) - Ad-free, course-free ways to provide value and generate revenue

### Features
- [Autonomous Windows Agent Plan](./implementation/AUTONOMOUS_WINDOWS_AGENT_PLAN.md) - Simple's perceive→act agent architecture
- [Observe → Orient → Goal → Plan → Action](./implementation/OBSERVE-ORIENT-GOAL-PLAN-ACTION.md) - Implementation plan for the continuous agent loop
- [Automation Roadmap](./implementation/AUTOMATION_ROADMAP.md) - Automation feature roadmap
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Automation security model
- [Simple Marketplace Plan](./implementation/SIMPLE_MARKETPLACE_PLAN.md) - Marketplace & skill generalization plan (includes cost-based Free/Pro gating consistent with the Action Plan)
- [Support Tickets](./implementation/SUPPORT_TICKETS.md) - Bug reports, `/net` support tickets & contact messages; the `pull-support-tickets` export script, and the future-state plan for autonomous agent-driven fixes
- [Special User Flag](./implementation/special-user-flag.md) - Admin "Special" unlimited-credits flag (distinct from admin)
- [DeepSeek Setup](./guides/DEEPSEEK_SETUP.md) - DeepSeek API configuration

### Coliseum game
- [Coliseum index](./coliseum/README.md) - **Start here** — reading order + all Coliseum docs
- [Coliseum Spec](./coliseum/COLISEUM-SPEC.md) - Implementation-ready functional spec

### Historical (reference only)
- [Archive index](./archive/README.md) - Superseded docs (old LLM/S3/usage/status summaries)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
