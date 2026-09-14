# portfolio-app — agent instructions

## Verification: scope it to the change

Run **only the tests that cover the files you changed**. This repo has 133 test files
across three independent runners; sweeping all of them for an edit is waste, and for a
CSS tweak it is pure waste — a stylesheet has no unit test that can fail.

| You changed                                                     | Verify with                                                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS / styles / layout / colour                                  | **No jest run.** Check it in the browser: overflow sweep 320→1920px, both themes, contrast. Method in `docs/implementation/agent.md` §13.12–13.17. |
| Copy, text, images/assets, docs, comments, formatting           | Nothing. Do not run tests.                                                                                                                         |
| One component / util / service / controller                     | Only the test file(s) named after or colocated with it.                                                                                            |
| Shared helper, build config, pricing constants, dependency bump | The tests of its direct consumers — still scoped, just a wider named set.                                                                          |
| A test file                                                     | Just that file.                                                                                                                                    |

If a change is genuinely cross-cutting and you cannot name its consumers, say so and
ask before expanding the run. "I'm not sure what this touches" is a reason to ask, not
a reason to sweep.

## Do not debug failures you didn't cause

If a run fails in a file you did not touch, and nothing in your change plausibly
reaches it:

1. Do **not** investigate it, mock it, "fix" it, or go read the source to reason about it.
2. Report it in **one line**: `unrelated: <suite> — <error message>`.
3. Move on.

Only a failure in a file you changed — or in a direct consumer of what you changed — is
yours to chase. Pre-existing red is not a blocker for a colour change, and time spent on
the rest is the exact waste this file exists to prevent. Same rule for a failure that
reproduces identically before and after your change.

## Never run the frontend suite from inside `frontend/`

`cd frontend && npm test` fails every DOM suite with
`ReferenceError: document is not defined`, because `frontend/package.json` has no
`testEnvironment` so Jest defaults to `node`. That is ~30 phantom failures and a
guaranteed detour — it is a wrong-runner symptom, not a broken repo. The **root** jest
config is the canonical frontend runner. Commands: `.github/instructions/testing.instructions.md`.

## The full sweep (merge/publish time only)

```bash
node node_modules/jest/bin/jest.js --config package.json frontend/src   # frontend
npm --prefix backend test                                              # backend
npm --prefix simple-addon run test:unit                                # addon
```

Run this when merging into the base branch or before a publish — never while iterating.
CI (`.github/workflows/ci.yml`) runs all three on every PR anyway.
