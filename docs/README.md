# Documentation

This folder contains all documentation for the Portfolio App.

## 📁 Folder Structure

```
docs/
├── README.md                          # This file
├── guides/                            # Setup and usage guides
│   ├── AWS_SETUP_GUIDE.md            # AWS S3 + CloudFront configuration
│   ├── STATIC_ASSETS_GUIDE.md        # Static asset management
│   ├── REFERER_TRACKING_README.md    # Analytics and tracking setup
│   ├── ACTION_PLAN.md                # Consolidated next-steps plan (start here)
│   ├── BUSINESS_PLAN.md              # What value the product provides customers
│   └── ETHICAL_MONETIZATION_STRATEGIES.md # Ethical, ad-free revenue ideas
├── implementation/                    # Technical implementation details
│   ├── API_USAGE_IMPLEMENTATION.md   # ⚠️ Historical — superseded by BYOK, see current pricing.js
│   ├── IMPLEMENTATION_STATUS.md      # Feature implementation status
│   ├── LLM_IMPLEMENTATION_SUMMARY.md # LLM provider integration
│   ├── S3_INTEGRATION_SUMMARY.md     # S3 file upload integration
│   ├── AUTONOMOUS_WINDOWS_AGENT_PLAN.md # Simple agent architecture plan
│   ├── AUTOMATION_ROADMAP.md         # Automation feature roadmap
│   ├── AUTOMATION_SECURITY.md        # Automation security model
│   ├── SIMPLE_MARKETPLACE_PLAN.md   # Marketplace & skill generalization plan
│   └── simple-agent-prompt.md       # Agent system prompt reference
└── debugging/                         # Troubleshooting guides
    └── debug-ocr.md                  # OCR debugging guide
```

## 🚀 Quick Links

### Getting Started
- [AWS Setup Guide](./guides/AWS_SETUP_GUIDE.md) - Set up S3 and CloudFront
- [Static Assets Guide](./guides/STATIC_ASSETS_GUIDE.md) - Manage images and files

### Business
- [Action Plan](./guides/ACTION_PLAN.md) - **Start here.** Consolidated next steps: messaging, payment page accuracy, and funnel tuning
- [Business Plan](./guides/BUSINESS_PLAN.md) - What value the product provides customers, and why they pay
- [Ethical Monetization Strategies](./guides/ETHICAL_MONETIZATION_STRATEGIES.md) - Ad-free, course-free ways to provide value and generate revenue

### Features
- [LLM Implementation](./implementation/LLM_IMPLEMENTATION_SUMMARY.md) - OpenAI/XAI integration
- [S3 Integration](./implementation/S3_INTEGRATION_SUMMARY.md) - File upload system
- [Autonomous Windows Agent Plan](./implementation/AUTONOMOUS_WINDOWS_AGENT_PLAN.md) - Simple's perceive→act agent architecture
- [Automation Roadmap](./implementation/AUTOMATION_ROADMAP.md) - Automation feature roadmap
- [Automation Security](./implementation/AUTOMATION_SECURITY.md) - Automation security model
- [Simple Marketplace Plan](./implementation/SIMPLE_MARKETPLACE_PLAN.md) - Marketplace & skill generalization plan (includes cost-based Free/Pro gating consistent with the Action Plan)
- [API Usage Tracking](./implementation/API_USAGE_IMPLEMENTATION.md) - ⚠️ Historical document; current model is BYOK (see Action Plan)

### Troubleshooting
- [OCR Debugging](./debugging/debug-ocr.md) - Fix OCR issues
