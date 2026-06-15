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
