# Automation Eval Harness

Replays scripted scenarios against the live tool registry and reports
pass/fail. The harness is **headless** — it does not invoke the LLM agent loop;
it executes a deterministic recipe of tool calls and asserts on the results.

This is the regression net the roadmap calls for. Run it before/after any
change to a tool, the permission gate, or the registry plumbing.

## Run

```powershell
# Run every scenario in ./scenarios/
node csimple-addon/server/automation/eval/cli.js

# Run a single scenario file
node csimple-addon/server/automation/eval/cli.js csimple-addon/server/automation/eval/scenarios/01-shell-smoke.json

# Force every step into dry-run (no side effects)
node csimple-addon/server/automation/eval/cli.js --dry
```

Exit code is `0` if every scenario passes or is skipped, `1` if any failed,
`2` on internal errors.

## Scenario format

YAML or JSON. The shape:

```yaml
name: "shell echoes hello"
description: "Smoke test for shell_run."
require:                            # optional: skip if not satisfied
  platform: "win32"                 # require Windows; prefix '!' to invert
  env: { CI: "1" }                  # require env vars
permissions:                        # optional: override perms during the run
  dryRunMode: false
  categories: { shell: "allow" }
steps:
  - tool: shell_run
    args: { command: "Write-Output 'csimple-eval-ok'" }
    expect:
      ok: true                      # success/failure assertion
      resultPath: "stdout"          # dotted path into the result object
      resultContains: "csimple-eval-ok"
      resultEquals: { ... }         # optional deep-equal check
      resultMatches: "^csimple"     # optional regex check
      durationMsLte: 15000          # latency budget
```

Each step calls one tool. The runner records `{ ok, error, durationMs, mode }`
for every step and runs the assertions in `expect` against the result.

## HTTP scenarios

A scenario may supply an `http` block instead of `steps` to exercise an
actual addon HTTP route end-to-end, over the network stack, against a real
(ephemeral, localhost-only) Express server booted from the same
`mountAutomation()` used in production (see `./http-app.js`). This is useful
for routes that aren't simple tool-registry calls — e.g. `/api/skill/*`,
`/api/voice/*`, `/api/perception/*`, `/api/predictor/*`, `/api/agents/*`.

```json
{
  "name": "Capability summary — POST /api/skill/capabilities",
  "require": { "env": { "EVAL_ALLOW_LLM": "1" } },
  "http": {
    "method": "POST",
    "path": "/api/skill/capabilities",
    "body": { "skill": { "name": "demo", "steps": [] } },
    "headers": { "X-Extra": "optional" }
  },
  "expect": {
    "status": 200,
    "ok": true,
    "summary": { "minLength": 1 },
    "stats.enabled": true,
    "items": { "type": "array" }
  }
}
```

- `http.method`/`http.path`/`http.body`/`http.headers` describe the request.
  `body` values go through the same `${VAR}` env-interpolation as tool `args`.
- `expect.status` checks the HTTP status code.
- `expect.ok` checks `body.ok` is truthy/falsy.
- Every other `expect` key is a **field assertion** resolved via a dotted
  path into the JSON body (e.g. `"stats.enabled"` reaches `body.stats.enabled`).
  Field assertions support:
  - a bare value → deep-equality shorthand (`"count": 3`)
  - `{ "equals": ... }` → deep-equality
  - `{ "contains": "text" }` → substring/array-membership-ish check via `String(...).includes`
  - `{ "matches": "regex" }` → regex test against `String(actual)`
  - `{ "minLength": n }` / `{ "maxLength": n }` → array/string length bounds
  - `{ "type": "array"|"string"|"number"|"boolean"|"object" }` → `typeof`/`Array.isArray` check
  - `{ "exists": true|false }` → presence check
- The ephemeral server is a **lazy singleton** — the first HTTP scenario in a
  run boots it, subsequent scenarios reuse it. `cli.js` closes it after the
  full directory run completes.
- Routes that need a real LLM/network call (e.g. `nl-compiler`'s
  `/api/skill/compile-natural`) should be gated behind `require.env` (see
  `12-nl-compile.json`'s `EVAL_ALLOW_LLM` gate) so they're skipped by default
  in CI and only run when a real GitHub Models token is available.
- Scenarios 18-20 are the three **perturbed-UI axis** regression scenarios
  called for in `docs/new/csimple-agent-prompt.md` §5.5 — all three named
  axes now have offline (`http`-mode, no-LLM) coverage against
  `POST /api/skill/infer-params`:
  - `18-skill-infer-params-perturbed-position.json` — **position shift**:
    two demos with different click coordinates (simulating a moved window)
    assert pixel `x`/`y` stay un-promoted while varying typed text IS
    parameterized.
  - `19-skill-infer-params-perturbed-label-rename.json` — **label rename**:
    two demos where a `uia_invoke` target's `name` (on-screen label) changed
    but its `automationId` didn't; asserts the renamed label IS promoted to
    a param (relabeling doesn't hard-fail inference) while the stable
    `automationId` stays a literal.
  - `20-skill-infer-params-perturbed-timing.json` — **timing variance**:
    two demos where a `wait` step's `ms` duration differs by 4x; asserts
    the timing field stays un-promoted (never baked in as a required param)
    while constant click coordinates and varying typed text behave as
    expected.

## Adding a scenario

1. Drop a `.json` or `.yml` file under `scenarios/`.
2. Use `require.platform` to gate platform-specific tests.
3. If the scenario needs unusual permissions, set them in the `permissions`
   block — the runner restores the original config in a `finally` block.
4. Keep scenarios independent — each one is responsible for any setup it needs.

## Env-var interpolation

String fields in `args` are scanned for `${VAR_NAME}` references and replaced
with the matching `process.env` value before the tool is called. Example:

```json
{ "tool": "fs_list", "args": { "path": "${USERPROFILE}\\Documents" } }
```

Missing variables expand to an empty string.

## YAML support

YAML scenarios need either `yaml` or `js-yaml` installed in the addon's
`node_modules/`. If neither is present, the runner falls back to JSON only
and throws a clear error when asked to parse YAML.
