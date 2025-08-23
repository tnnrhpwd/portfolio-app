# Portfolio App - Enhanced Full-Stack React & Node.js Application

A professional portfolio application with React frontend and Node.js backend, featuring enhanced security, performance, and maintainability improvements.

## 🚀 Recent Improvements

### 🔒 Security Enhancements
- **Rate Limiting**: Protection against brute force attacks and API abuse
- **Input Validation**: Comprehensive validation using express-validator
- **Security Headers**: Helmet.js integration with CSP, HSTS, and other security headers
- **Input Sanitization**: XSS protection through input sanitization
- **Enhanced Authentication**: Improved JWT handling with automatic token cleanup
- **Request Logging**: Security event tracking and monitoring

### ⚡ Performance Optimizations
- **Caching System**: In-memory caching for frequently accessed data
- **Database Optimization**: Improved DynamoDB queries with batch operations
- **Compression**: Gzip compression for reduced payload sizes
- **Optimized File Uploads**: Enhanced multer configuration with file type validation
- **Bundle Optimization**: Better webpack configuration for smaller bundle sizes

### 🏗️ Code Quality & Maintainability
- **Error Boundaries**: React error boundaries for graceful error handling
- **Improved Logging**: Winston-based logging with different log levels
- **ESLint & Prettier**: Consistent code formatting and linting
- **Enhanced Error Handling**: Better error messages and user feedback
- **Loading States**: Improved UX with skeleton loaders and spinners

### 🛠️ Development Experience
- **Docker Support**: Complete containerization with docker-compose
- **Health Checks**: Automated service health monitoring
- **Environment Templates**: Clear environment variable documentation
- **Enhanced Testing**: Better test structure and coverage tools
- **Development Scripts**: Improved npm scripts for common tasks

## Getting Started

To run this project locally:

1. Clone the repository:

    ```bash
    git clone https://github.com/tnnrhpwd/portfolio-app.git
    ```

2. Navigate into the project directory:

    ```bash
    cd portfolio-app
    ```

3. Install the dependencies:

    ```bash
        npm install
        cd frontend
        npm install
        cd ..
        cd backend
        npm install
        cd ..
    ```

4. Start the development server:

    ```bash
    npm start
    ```

    ![alt text](image.png)
    
    ![alt text](image-1.png)

The application will start on http://localhost:3000.

Contributing
While this project is primarily a personal portfolio, contributions are welcome. If you find a bug or think of a new feature, please feel free to create an issue or a pull request.

License
This project is open source and available under the MIT License.
