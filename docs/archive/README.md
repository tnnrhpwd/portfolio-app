# Archive — Historical / Superseded Docs

These documents describe work that is **done and superseded**. They are kept for
reference (commit archaeology, why-did-we-do-X questions) but are no longer the
source of truth. Current architecture and pricing live elsewhere — see
[../guides/ACTION_PLAN.md](../guides/ACTION_PLAN.md) and
[../guides/SECRETS_MANAGEMENT.md](../guides/SECRETS_MANAGEMENT.md).

| File | What it covered | Superseded by |
|------|-----------------|---------------|
| `API_USAGE_IMPLEMENTATION.md` | Per-user AI usage metering (old fixed tiers) | Metered cloud credits — `backend/constants/pricing.js` + `guides/ACTION_PLAN.md` |
| `LLM_IMPLEMENTATION_SUMMARY.md` | LLM provider integration (early pass) | `guides/DEEPSEEK_SETUP.md` + `backend/services/bedrockService.js` |
| `S3_INTEGRATION_SUMMARY.md` | S3 file-upload integration | `guides/AWS_SETUP_GUIDE.md` (Parts 1–2) |
| `IMPLEMENTATION_STATUS.md` | Point-in-time feature status | Live code + `guides/ACTION_PLAN.md` |
