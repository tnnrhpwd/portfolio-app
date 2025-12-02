# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of this project seriously. If you discover a security vulnerability, please follow these steps:

### 1. Do NOT Create a Public Issue

Security vulnerabilities should not be reported through public GitHub issues, as this could expose the vulnerability to malicious actors.

### 2. Report Privately

Please report security vulnerabilities by emailing:
- **Email**: steven.t.hopwood@gmail.com
- **Subject**: [SECURITY] Portfolio App Vulnerability Report

### 3. Include the Following Information

- Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
- Location of the affected source code (file path, line number if known)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact assessment and potential attack scenarios

### 4. Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days (depending on severity)

### 5. What to Expect

- Acknowledgment of your report
- Regular updates on the progress
- Credit in the security advisory (if desired)
- Notification when the issue is resolved

## Security Best Practices Implemented

This application implements several security measures:

### Authentication & Authorization
- JWT-based authentication with secure token handling
- Password hashing with bcrypt
- Rate limiting on authentication endpoints

### Input Validation
- Server-side validation with express-validator
- Input sanitization to prevent XSS attacks
- File upload validation (type, size, naming)

### Security Headers
- Helmet.js for HTTP security headers
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)

### API Security
- Rate limiting per endpoint type
- CORS configuration for production
- Request logging for audit trails

### Data Protection
- Environment variables for sensitive data
- Secure AWS credential handling
- No secrets in source code

## Security Checklist for Contributors

When contributing, please ensure:

- [ ] No secrets or API keys in code
- [ ] Input validation on all user inputs
- [ ] Proper error handling (no sensitive data in errors)
- [ ] Dependencies are up to date
- [ ] No known vulnerabilities in dependencies

## Dependency Updates

We use automated tools to monitor dependencies:

- Dependabot for automatic security updates
- Regular `npm audit` checks
- Security patch reviews

## Contact

For general security questions (not vulnerabilities), feel free to open a GitHub Discussion.
