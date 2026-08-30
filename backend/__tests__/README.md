# Backend Test Suite

This directory contains all backend tests organized by type and purpose.

## Directory Structure

```
__tests__/
├── run-all-tests.js          # Main test runner
├── unit/                     # Unit tests for individual components
│   ├── bedrockService.test.js       # Bedrock Converse API unit tests
│   ├── conversationMerge.test.js    # Conversation merge logic
│   ├── goalAgentService.test.js     # Goal agent service
│   └── guestLogin.test.js           # Guest login
├── integration/             # Integration tests for system components
│   ├── test-ocr.js         # OCR functionality integration test
│   ├── test-referer-tracking.js    # Referer tracking system test
│   ├── test-referer-fixes.js       # Referer tracking fixes test
│   └── test-specific-issues.js     # Specific reported issues test
├── helpers/                 # Test helper utilities (future)
└── back.test.js            # Original backend test file
```

## Running Tests

### Run All Tests
```bash
cd backend
node __tests__/run-all-tests.js
```

### Run Individual Tests
```bash
# Unit tests
node __tests__/unit/bedrockService.test.js
node __tests__/unit/conversationMerge.test.js
node __tests__/unit/goalAgentService.test.js
node __tests__/unit/guestLogin.test.js

# Integration tests  
node __tests__/integration/test-ocr.js
node __tests__/integration/test-referer-tracking.js
node __tests__/integration/test-referer-fixes.js
node __tests__/integration/test-specific-issues.js
```

## Test Categories

### Unit Tests
- **bedrockService.test.js**: Bedrock Converse API unit tests
- **conversationMerge.test.js**: Conversation history merge logic
- **goalAgentService.test.js**: Goal agent provider routing
- **guestLogin.test.js**: Guest account login

### Integration Tests  
- **test-ocr.js**: Tests the complete OCR workflow with mock image data
- **test-referer-tracking.js**: Tests referer categorization and database storage
- **test-referer-fixes.js**: Tests specific fixes for referer tracking issues
- **test-specific-issues.js**: Tests solutions to specific reported problems

## Prerequisites

Before running tests, ensure:
1. All environment variables are set in `.env` file
2. Required dependencies are installed (`npm install`)
3. Database connections are available (for integration tests)
4. API keys are valid (AWS, DeepSeek, etc.)

## Test Development

When adding new tests:
1. Place unit tests in `__tests__/unit/`
2. Place integration tests in `__tests__/integration/`
3. Use descriptive filenames starting with `test-`
4. Update this README with new test descriptions
5. Add new tests to the test runner if needed

## Notes

- Tests use mock data where possible to avoid API costs
- Some integration tests may require valid API keys
- Tests are designed to be safe and not modify production data
- Use `console.log` liberally for debugging test issues