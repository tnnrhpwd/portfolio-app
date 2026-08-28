# DeepSeek API Integration (AWS Secrets Manager)

This app can now use **DeepSeek** as an LLM provider for:

- **Net chat** (`/net` → Simple Chat): select `DeepSeek-V3 Chat` or `DeepSeek-R1 Reasoner` in the cloud model picker.
- **OCR post-processing**: choose **DeepSeek** as the "LLM Provider" in the *Extract Rich Action Data* controls.

The DeepSeek key is stored in **AWS Secrets Manager** and loaded by the backend at
startup. Usage is metered against the existing per-tier AI credit allowance.

## How it works

- `backend/utils/llmProviders.js` registers a `deepseek` provider (OpenAI-compatible,
  `baseURL: https://api.deepseek.com`).
- `backend/utils/awsSecrets.js` fetches the key from Secrets Manager on boot and sets
  `process.env.DEEPSEEK_API_KEY` **before** routes (and the LLM provider layer) load.
- The backend reads the key in this order:
  1. `DEEPSEEK_API_KEY` environment variable (local `.env`, Render env var, etc.)
  2. AWS Secrets Manager (`DEEPSEEK_API_KEY_SECRET_ID`, default `portfolio-app/deepseek`)

## Step 1 — Store the key in AWS Secrets Manager

Run this with the AWS CLI (using the same account/credentials the backend already
uses for DynamoDB/S3/SES):

```bash
aws secretsmanager create-secret \
  --name portfolio-app/deepseek \
  --description "DeepSeek API key for portfolio-app backend" \
  --secret-string '{"DEEPSEEK_API_KEY":"sk-YOUR_DEEPSEEK_KEY_HERE"}'
```

> A plain-string secret also works, but the JSON shape above is recommended so the
> loader can find the key unambiguously.

To **update** it later:

```bash
aws secretsmanager put-secret-value \
  --secret-id portfolio-app/deepseek \
  --secret-string '{"DEEPSEEK_API_KEY":"sk-NEW_KEY"}'
```

To use a different secret name, set `DEEPSEEK_API_KEY_SECRET_ID` in the backend env
(Render) — the default is `portfolio-app/deepseek`.

## Step 2 — Grant the backend IAM user access

The backend already authenticates to AWS with `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` (the same user that touches DynamoDB/S3/SES). That IAM user
(or role) needs permission to read this one secret:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:<region>:<account-id>:secret:portfolio-app/deepseek-*"
    }
  ]
}
```

Attach this as an inline policy on the backend's IAM user/role (adjust region and
account id).

## Step 3 — Local development (optional, no AWS needed)

Add the key straight to `backend/.env` (see `backend/.env.example`):

```bash
DEEPSEEK_API_KEY=sk-YOUR_DEEPSEEK_KEY_HERE
```

When this is set, the Secrets Manager lookup is skipped entirely.

## Step 4 — Verify

Start the backend, then confirm the provider is reported:

```bash
curl http://localhost:5000/api/data/llm-providers
```

`deepseek` should appear alongside `bedrock`, with models `deepseek-chat` and
`deepseek-reasoner`.

## Cost tracking

DeepSeek usage is metered like other server-paid providers:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
| --- | --- | --- |
| `deepseek-chat` | $0.27 | $1.10 |
| `deepseek-reasoner` | $0.55 | $2.19 |

These rates live in `backend/utils/apiUsageTracker.js` (`API_COSTS.deepseek`) and are
deducted from each user's monthly AI credit balance.
