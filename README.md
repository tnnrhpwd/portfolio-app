# Portfolio App - Enhanced Full-Stack React & Node.js Application

[![CI](https://github.com/tnnrhpwd/portfolio-app/actions/workflows/ci.yml/badge.svg)](https://github.com/tnnrhpwd/portfolio-app/actions/workflows/ci.yml)
[![Security Scan](https://github.com/tnnrhpwd/portfolio-app/actions/workflows/security.yml/badge.svg)](https://github.com/tnnrhpwd/portfolio-app/actions/workflows/security.yml)

A professional portfolio application with React frontend and Node.js backend, featuring enhanced security, performance, and maintainability improvements.

## 📚 Documentation

See the [`/docs`](./docs) folder for detailed documentation:
- **[Guides](./docs/guides/)** - Setup and configuration guides
- **[Implementation](./docs/implementation/)** - Technical implementation details
- **[Debugging](./docs/debugging/)** - Troubleshooting guides

## 🚀 Recent Improvements

### 🔒 Security Enhancements
- **Rate Limiting**: Protection against brute force attacks and API abuse
- **Input Validation**: Comprehensive validation using express-validator
- **Security Headers**: Helmet.js integration with CSP, HSTS, and other security headers
- **Input Sanitization**: XSS protection through input sanitization
- **Enhanced Authentication**: Improved JWT handling with caching and efficient DB lookups
- **Request Logging**: Security event tracking and monitoring
- **Automated Security**: Dependabot for dependency updates, CodeQL scanning

### ⚡ Performance Optimizations
- **Caching System**: In-memory caching for frequently accessed data
- **Database Optimization**: Improved DynamoDB queries with GetCommand instead of Scan
- **Compression**: Gzip compression for reduced payload sizes
- **Optimized File Uploads**: Enhanced multer configuration with file type validation
- **Bundle Optimization**: Better webpack configuration for smaller bundle sizes

### 🏗️ Code Quality & Maintainability
- **Error Boundaries**: React error boundaries for graceful error handling
- **Improved Logging**: Winston-based logging with different log levels
- **ESLint & Prettier**: Consistent code formatting and linting
- **Enhanced Error Handling**: Better error messages and user feedback
- **Loading States**: Improved UX with skeleton loaders and spinners
- **CI/CD Pipelines**: Automated testing and security scanning

### 🛠️ Development Experience
- **Health Checks**: Automated service health monitoring
- **Environment Templates**: Clear environment variable documentation (`.env.example`)
- **Enhanced Testing**: Better test structure and coverage tools
- **Development Scripts**: Improved npm scripts for common tasks

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm 9+
- AWS account (for DynamoDB and S3)

### Quick Start

1. Clone the repository:
    ```bash
    git clone https://github.com/tnnrhpwd/portfolio-app.git
    cd portfolio-app
    ```

2. Set up environment variables:
    ```bash
    cp .env.example .env
    # Edit .env with your values
    ```

3. Install dependencies:
    ```bash
    npm run install-all
    # Or manually:
    npm install && cd frontend && npm install && cd ../backend && npm install
    ```

4. Start the development server:
    ```bash
    npm start
    ```

The application will start on http://localhost:3000.

## ☁️ Deployment & Cloud Architecture

The application is split across multiple hosting providers, with AWS handling data, storage, and email infrastructure.

| Layer | Service | Role |
| --- | --- | --- |
| **Frontend** | [Netlify](https://www.netlify.com/) | Builds the Vite/React app (`frontend/build`) via `netlify.toml`, serves it from Netlify's global CDN, manages security headers, sitemap, and `/api/*` proxy redirects to the backend. |
| **Backend API** | [Render](https://render.com/) | Hosts the Node.js/Express server (`backend/server.js`) at `mern-plan-web-service.onrender.com`. Handles auth, business logic, Stripe webhooks, and all AWS SDK calls. |
| **Database** | **AWS DynamoDB** | Primary NoSQL datastore for users, generic data records, memory/personality entries, and analytics. Accessed via `@aws-sdk/lib-dynamodb` in [`backend/services/dataService.js`](backend/services/dataService.js). |
| **File Storage** | **AWS S3** | Stores user uploads (images, OCR documents, attachments) via [`backend/services/s3Service.js`](backend/services/s3Service.js). Files larger than DynamoDB's 400KB limit are offloaded here. |
| **CDN for Assets** | **AWS CloudFront** | Fronts the S3 bucket (`AWS_CLOUDFRONT_DOMAIN`) to deliver user-uploaded media with low latency and cacheable URLs. |
| **Email** | AWS SES / SMTP (Nodemailer) | Transactional email (password resets, notifications) sent from [`backend/services/emailService.js`](backend/services/emailService.js). |
| **Payments** | Stripe | Subscription billing and webhooks handled in [`backend/services/stripeService.js`](backend/services/stripeService.js). |
| **CI/CD** | GitHub Actions | Runs tests, security scans (CodeQL), and triggers Netlify/Render deploys on push to `master`. |

**Request flow:** Browser → Netlify CDN (static assets + `/api/*` proxy) → Render-hosted Express API → AWS DynamoDB (data) / S3 + CloudFront (files) / SES (email) / Stripe (payments).

The desktop companion ([`simple-addon/`](simple-addon/)) is an Electron app that ships independently and talks to the same Render backend.

## � Environment Variables & Secrets

Environment variables are never committed to this repository.

- **Templates** — `backend/.env.example` (and `backend/config/.env.example`) document every supported variable with safe placeholder values. `backend/.env` is the live, git-ignored file.
- **Encrypted backups** — `backend/.env` is encrypted with [age](https://github.com/FiloSottile/age) and pushed to the **private** [`tnnrhpwd/portfolio-app-secrets`](https://github.com/tnnrhpwd/portfolio-app-secrets) repo as `backend.env.age`. Only holders of an authorized SSH/age private key can decrypt it.

  ```bash
  npm run env:backup     # encrypt local .env files and push ciphertext to the secrets repo
  npm run env:restore    # decrypt and restore .env files from the secrets repo
  ```

- **Recipients** — authorized keys live in `scripts/env-backup/recipients.txt`; the file mapping lives in `scripts/env-backup/manifest.json`. To authorize a new device:

  ```bash
  npm run env:add-recipient -- -PublicKey "C:\path\to\new-device_id_ed25519.pub"
  ```

- **Source of truth (AWS Secrets Manager)** — all secrets *and app config* (Stripe, JWT, DeepSeek, `GITHUB_TOKEN`, S3 bucket, `FROM_EMAIL`, `ADMIN_USER_ID`, …) live in one JSON secret (`portfolio-app/production`) and are hydrated into `process.env` at boot by `backend/utils/awsSecrets.js`. Set or rotate any value with:

  ```bash
  npm run secret:put -- -Name STRIPE_KEY -Value "sk_live_..."
  ```

- **Is `.env` still used? Yes — 2 lines.** `backend/.env` holds just the AWS access key pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) needed to reach Secrets Manager. On Render, `.env` is not read — Render injects the same bootstrap creds plus runtime config (`AWS_REGION`, `NODE_ENV`, `PORT`, `FRONTEND_URL`).

- **Production (Render)** — Render only needs the AWS bootstrap credentials plus runtime config; every secret and app-config value comes from the secret above. See [docs/guides/SECRETS_MANAGEMENT.md](docs/guides/SECRETS_MANAGEMENT.md).

## �🔐 Security

Found a security vulnerability? Please see our [Security Policy](./.github/SECURITY.md) for responsible disclosure guidelines.

## Contributing

While this project is primarily a personal portfolio, contributions are welcome. If you find a bug or think of a new feature, please feel free to create an issue or a pull request.

## License

This project is open source and available under the MIT License.
