---
description: 'How to run tests in portfolio-app: which runner to use, how to scope a run to one file, and how to triage failures. Use when running tests or interpreting test output.'
applyTo: 'backend/**, frontend/**, simple-addon/**'
---

# Testing in portfolio-app

**Default to a scoped run.** Run the tests for the files you changed, not the whole
suite. Policy and failure-triage rule: `.github/copilot-instructions.md`.

## The three runners (they are independent)

| Tree            | Runner                              | Scoped run (verified)                                                                                     |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `frontend/`     | Jest **from the repo root** (jsdom) | `node node_modules/jest/bin/jest.js --config package.json --ci frontend/src/path/to/thing.test.js` → ~3 s |
| `backend/`      | Jest (`node` env)                   | `npm --prefix backend test -- --ci __tests__/unit/thing.test.js` → ~6 s                                   |
| `simple-addon/` | plain Node scripts, **no Jest**     | `node simple-addon/server/automation/path/to/thing.test.js` → ~0.1 s                                      |

Notes that save a detour:

- **Frontend: never run from `frontend/`.** That cwd resolves to `frontend/package.json`,
  which has no `testEnvironment`, so Jest defaults to `node` and every DOM suite dies
  with `ReferenceError: document is not defined`. The same file passes under the root
  config. Wrong runner, not a real failure.
- **Backend:** use `npm --prefix backend test -- <path>`; the `--` is required to pass the
  path through. The suite needs no live AWS keys.
- **Addon: do not use `npm --prefix simple-addon test`** — `test` chains `test:unit` _and_
  the `eval` scenario suite (~36 node scripts + scenarios). Call the one file you need.
  Addon tests print their own `file.test: N/M PASS` summary, not Jest's format.

## Mapping a change to its tests

1. Test file next to the source (`foo.js` → `foo.test.js`) — the common case.
2. Else the directory's suite: `frontend/src/pages/Fit/*` → `Fit.test.jsx` and friends.
3. Else `backend/__tests__/unit/<name>.test.js` for backend services/controllers/utils.
4. No test covers it? Say so in one line. **Do not** write a test for a colour/copy
   change just to have something green, and do not run the suite to "see if anything
   breaks".

## Full sweep — merge/publish time only

```bash
node node_modules/jest/bin/jest.js --config package.json frontend/src
npm --prefix backend test
npm --prefix simple-addon run test:unit
```

## Reading output

- **Jest:** the tally lines (`Test Suites:`, `Tests:`) are the verdict. React Router v7
  future-flag `console.warn`s flood stdout (~20 KB) and are not failures. For a big run,
  `--json --outputFile="$env:TEMP\jest.json"` and read the JSON.
- **Exit code is the verdict** for scoped runs; a non-zero code with only `warn` lines is
  still green.

## Known false alarms (do not chase these)

| Symptom                                                                                                                 | Reality                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ReferenceError: document is not defined` / `localStorage is not defined`                                               | Wrong runner — you ran from `frontend/`. Re-run through the root config.                                               |
| `SyntaxError: Unexpected token 'export'` at `@aws-sdk/core/...browser.js`, or `Cannot find module '<file that exists>'` | Stale Jest cache. Re-run once with `--no-cache`; it is not a code bug and needs no mock.                               |
| `node`/`npx` "not recognized" mid-session on Windows                                                                    | Shell PATH flakiness on this machine. Use an absolute path (`& "C:\Program Files\nodejs\node.exe"`) or `npm --prefix`. |

Anything else that fails in a file you did not touch: report one line
(`unrelated: <suite> — <error>`) and move on. Do not debug it.
