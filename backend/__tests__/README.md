# Backend Test Suite

Backend tests run with **Jest** (config in `backend/package.json`). The canonical
command is `npm test` (or `npx jest`) from `backend/`.

## Running Tests

Run **only the tests covering what you changed** — the whole suite is for merge time.
See `.github/copilot-instructions.md`.

```bash
# from the repo root
npm --prefix backend test -- __tests__/unit/foo.test.js   # one file (scoped, ~6 s)
npm --prefix backend test                                # whole backend suite
```

The suite is also run by CI (`.github/workflows/ci.yml` → `test-backend`).

## Layout

Jest's default `testMatch` picks up two groups:

- `__tests__/unit/*.test.js` — pure unit tests (services, controllers, helpers)
- `__tests__/integration/*.js` — integration tests (OCR, referer tracking, specific issues)
- `__tests__/harness/*.test.js` — **harness scenarios**: the §0 properties of
  `NET_HARNESS_PLAN.md`, each driven end to end through the real
  `/net` streaming route with a scripted model. A scenario is the place to add a
  regression for anything that spans more than one module — a unit test cannot
  falsify a property that lives in the joins.
- `__tests__/back.test.js` — original backend smoke test
- Co-located `*.test.js` next to source — e.g. `services/marketplaceRanking.test.js`,
  `controllers/marketplaceController.test.js`, `utils/homeTitleRules.test.js`

## Notable suites

- `unit/pricingSync.test.js` — drift guard between backend and frontend pricing constants.
- `unit/goalAgentService.test.js` / `unit/goalAgentController.test.js` — goal-agent logic.
- `unit/bedrockService.test.js` — Bedrock Converse request/response translation.
- `unit/bedrockPromptCache.test.js` — the prompt-cache guards, and the transparent
  retry when Bedrock rejects a `cachePoint` (driven through the real adapter, since
  that is where the retry lives).
- `unit/toolLoop.test.js` — the ONE /net tool loop with fakes: sequence, the
  act-vs-answer nudge, `exhausted`, a throwing executor, cancellation, the approval
  gate, and the context governor (trims and continues / stops when it must).
- `unit/contextBudget.test.js` — compaction by size, in order of least loss. Pins
  the invariant that matters: an `assistant.tool_calls` message and its
  `role:'tool'` results are removed **together or not at all** (half a pair is a
  rejected request, not a degradation).
- `unit/toolOutcome.test.js` — the failure taxonomy. Every case is a string a real
  tool emits (copied from `netTools.js`, `repoAgentService.js`, `repoRunner.js`,
  `pcTools.js`), plus the signal ordering and the retry-safe allowlist. If you add
  a failure message to a tool, add its case here.
- `unit/pcToolsRefusal.test.js` — what the model is told when the user's PC says no.
  A refusal reaches the cloud as a token (`DENIED[<cause>]: …`) because the relay's
  transport is a string by construction, so this suite asserts the interpretation at
  the level of the CLASSIFICATION and not just the wording: the kill switch must be
  a decision rather than a fault, an expired prompt must not be `FATAL` (it was, and
  the model was told to give up on a step the user could be asked about again), and a
  hard stop must never be offered as re-askable. Half the file covers the legacy
  shape — an addon that sends no token — because that is what the field runs until
  every desktop updates.
- `unit/planSurface.test.js` — the plan the model publishes about its own work. The
  rule it protects is that a MALFORMED plan must never fail a turn: misspelled
  statuses, two steps marked current, an over-long list and prose in the wrong field
  all have to come out as a usable checklist plus a note.
- `unit/continuity.test.js` — what the NEXT turn is told about the last one. Mostly
  asserting *silence* (a clean turn, a chat turn, an all-done plan), because a note
  on every turn is a note the model skims past; plus the resume phrasing, the
  refusal instruction, the bounds, and malformed records.
- `unit/stepJournal.test.js` / `unit/turnControl.test.js` — the step journal and
  its redaction; cancel + approvals (module-level maps ⇒ single-instance only).
- `unit/llmServiceStreamingTools.test.js` — the real streaming route end to end:
  deny, approve, cancel mid-turn, disconnect.
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