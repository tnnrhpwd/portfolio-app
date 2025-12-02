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
- **Docker Support**: Complete containerization with docker-compose
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

### Docker Setup

```bash
# Build and run with Docker
npm run docker:build
npm run docker:up

# View logs
npm run docker:logs

# Stop containers
npm run docker:down
```

## 🔐 Security

Found a security vulnerability? Please see our [Security Policy](./.github/SECURITY.md) for responsible disclosure guidelines.

## Contributing

While this project is primarily a personal portfolio, contributions are welcome. If you find a bug or think of a new feature, please feel free to create an issue or a pull request.

## License

This project is open source and available under the MIT License.
