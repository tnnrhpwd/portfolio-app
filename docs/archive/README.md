# Archive — Historical / Superseded Docs

These documents describe work that is **done and superseded**. Current
architecture and pricing live elsewhere — see
[../implementation/simple-agent-prompt.md](../implementation/simple-agent-prompt.md) and
[../guides/SECRETS_MANAGEMENT.md](../guides/SECRETS_MANAGEMENT.md).

## Still here

| File | What it covered | Superseded by |
|------|-----------------|---------------|
| `SIMPLE_MARKETPLACE_PLAN.md` | Marketplace & skill-generalization plan (pre-implementation) | `implementation/simple-agent-prompt.md` §4 + §5 |
| `coliseum/` | Coliseum game design + art pipeline | see `coliseum/README.md` |

## Removed (kept in git history)

These were point-in-time summaries that duplicated current docs, so the files
were deleted. The full text lives in git history if ever needed:

| File | What it covered | Superseded by |
|------|-----------------|---------------|
| `API_USAGE_IMPLEMENTATION.md` | Per-user AI usage metering (old fixed tiers) | `backend/constants/pricing.js` + `implementation/simple-agent-prompt.md` |
| `LLM_IMPLEMENTATION_SUMMARY.md` | LLM provider integration (early pass) | `guides/SECRETS_MANAGEMENT.md` (Part 3) + `backend/services/bedrockService.js` |
| `S3_INTEGRATION_SUMMARY.md` | S3 file-upload integration | `guides/AWS_SETUP_GUIDE.md` (Parts 1–2) |
| `IMPLEMENTATION_STATUS.md` | Point-in-time feature status | Live code + `implementation/simple-agent-prompt.md` |
