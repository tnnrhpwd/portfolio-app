# Backend Test Suite

Backend tests run with **Jest** (config in `backend/package.json`). The canonical
command is `npm test` (or `npx jest`) from `backend/`.

## Running Tests

```bash
cd backend
npm test                 # run the whole backend suite
npx jest path/to/test.js # run one file
```

The suite is also run by CI (`.github/workflows/ci.yml` → `test-backend`).

## Layout

Jest's default `testMatch` picks up two groups:

- `__tests__/unit/*.test.js` — pure unit tests (services, controllers, helpers)
- `__tests__/integration/*.js` — integration tests (OCR, referer tracking, specific issues)
- `__tests__/back.test.js` — original backend smoke test
- Co-located `*.test.js` next to source — e.g. `services/marketplaceRanking.test.js`,
  `controllers/marketplaceController.test.js`, `utils/homeTitleRules.test.js`

## Notable suites

- `unit/pricingSync.test.js` — drift guard between backend and frontend pricing constants.
- `unit/goalAgentService.test.js` / `unit/goalAgentController.test.js` — goal-agent logic.
- `unit/bedrockService.test.js` — Bedrock Converse request/response translation.
- `integration/test-ocr.js` — OCR workflow with mocked image data.

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