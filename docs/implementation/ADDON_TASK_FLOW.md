# From a chat sentence to tool calls — and how to test the pieces

This doc answers two questions:

1. **What actually happens** when this goes into `/simple` chat:

   > `OPEN EDGE, GO TO GOOGLE MESSAGES. SELECT DAKOTA. CLICK "RCS MESSAGE"
   > TYPE I LOVE YOU. PRESS ENTER`

2. **How to test the pieces without releasing the addon fifty times.**

The runtime behaviour of the loop itself (observe → orient → plan → act, the stall
detector, the repeat guard, the step budget) is documented in
[`Simple_Loop_Behaviour.md`](./Simple_Loop_Behaviour.md). This file is the map
*around* that loop: routing, the tools a sentence like this needs, and the
verification workflow.

---

## 1. The three testing lanes

Debugging this used to mean: edit a tool → release → update the installed app →
run the real task → read `main.log` → guess → repeat. One release per hypothesis,
and each real run exposes **one** failure at a time.

Three lanes break that cycle. They are not alternatives — they are an order.

| # | Lane | Command | Code that runs | Answers |
|---|------|---------|----------------|---------|
| 1 | **Prompt & decision** | `npm --prefix simple-addon run probe:prompt` | this repo, **offline**, nothing executed | Is the agent told the right thing? Are the acting tools even offered? |
| 2 | **Tool bodies** | `npm --prefix simple-addon run eval` (or a scenario file) | **this repo's** tool code, real desktop | Does *my fix to a tool* work on a real machine? |
| 3 | **The installed app** | `npm --prefix simple-addon run walk` (new — §4) | the **installed build**, real desktop, via its own HTTP API | Where does the real run break, and what did the tool actually return? |

The rule that makes this fast:

> **Lane 3 tells you *where* it breaks. Lanes 1–2 tell you *why*, and prove the
> fix. Only release when a lane-1/2 check can no longer answer your question.**

- Lane 1 is the cheapest and the most underused: the prompt is the largest single
  lever on whether the agent *acts* or just reads the screen forever, and
  `probe:prompt` prints it byte-for-byte without touching the desktop.
- Lane 2 runs the **repo's** tool modules in a plain node process, so a code
  change is testable before it is ever packaged.
- Lane 3 is the only lane that tells you about the build the user actually has.
  ⚠️ The addon runs from an **installed copy** — source edits in the repo do not
  reach it, and a running Electron app caches `require`s.

---

## 2. The flow, end to end

For an actionable sentence, with the addon connected locally:

| # | Hop | Where | Notes |
|---|-----|-------|-------|
| 1 | Message typed | `SimpleChat.jsx` → `sendMessage` | |
| 2 | **Routing decision** | `frontend/src/utils/simpleAddon/messageRouter.js` | Pure, jest-tested. With the addon in front of this machine and actionable text → `ROUTE_KINDS.AGENT`, reason `addon-reachable-logic-mode`. Cloud-only intents (image gen, explicit web search, questions about *cloud* data) skip the addon. |
| 3 | Dispatch to the desktop | `simpleAddonApi.runAgentMessage()` → `POST http://127.0.0.1:3001/api/agent/run` | Body `{description, context?, goalId?, forceAction?}`. A phone routes the same payload over the relay instead. |
| 4 | **Is it actionable at all?** | `automation/index.js` → `classifyActionable()` | Confident heuristic (`routing-lexicon.js`) with **no** model call, else one LLM verdict (`routing-classifier.js`), cached. A low-confidence *actionable* verdict stops and asks the user first (`forceAction` re-sends it). |
| 5 | Goal row created | `runGoalToCompletion()` → `wsClient.upsertGoal(slug, ...)` | The slug is derived from the message text — **repeating the same request reuses the same goal row**, which is why a second run can find a goal already `done`. |
| 6 | The loop starts | `agent-loop.js`, one loop per goal | O-O-G-P-A. `observe → orient → plan → act → reflect`, with a step budget (`maxSteps`, 60 here), a stall detector, and a repeat guard. |
| 7 | **Every tool call** | `tool-registry.js` → `executeTool(name, args, ctx)` | Permission gate first (category mode, kill switch, dry-run) → approval prompt if the mode is `ask` → then the tool. Returns `{ok, result, error, mode, durationMs}`. |
| 8 | Progress reaches the UI | `events.publish('tool.start' / 'tool.end')` → SSE `/api/agent/events` | The chat's "Step N — `<tool>`…" line comes from here, not from the status poll (a chat run lives on a *pooled* loop, whose `status()` describes a different loop). |
| 9 | Stop & report | `stop-reason.js` → `agentStopMessage.js` | `reason` is a sentence for the human, `status` a token for code. A stop with `steps === 0` means the run **never started** — a different problem from one that tried and gave up. |

---

## 3. Which tools that sentence actually needs

Left column = the user's words. Right = the only primitives that can honour them.

| Fragment | Tool(s) | Category | What "wrong" looks like |
|----------|---------|----------|-------------------------|
| OPEN EDGE | `open_app {name:'msedge', windowTitleContains:'Edge', waitMs}` | `system` | Launches, but the window is not focused → every later keystroke lands elsewhere |
| GO TO GOOGLE MESSAGES | select the existing tab (`uia_invoke` on its `TabItem`), or navigate: `input_tap {keys:['ctrl','t']}` → `text_type {text:url, pressEnterAfter:true}` | `system` | `window_focus {titleContains:'Google Messages'}` **before** the page is open — an Edge window is titled after its active tab, so that name does not exist yet |
| *(any page content)* | `screen_ocr {window:'<browser window>'}` (visible text **with coordinates**) | `safe-read` | Using `uia_find` on page content, which returns `count: 0` **forever** — a Chromium page exposes no accessibility tree. ⚠️ **Always pass `window`** (§5): an unscoped capture reads the whole monitor, including the chat window that contains the very words you are searching for |
| *(an already-open tab)* | `uia_snapshot {windowName:'Edge'}` → the tab strip IS exposed (`TabItem` per tab) → `uia_invoke {name:'<tab title>'}` | `safe-read`/`system` | `uia_find {controlType:'TabItem'}` on its own: it searches the **whole desktop**, so VS Code's tabs can fill the result |
| SELECT DAKOTA | `screen_ocr {window:...}` → text match → `click_at {x,y}` | `system` | Blind coordinate guessing; or `uia_find {name:'Dakota'}` returning 0 and being retried |
| CLICK "RCS MESSAGE" | `click_at` on the OCR coordinates (the page exposes no UIA element) | `system` | Clicking before the conversation has rendered; or expecting `screen_set_of_marks` to number page controls — it numbers UI Automation elements, which on a Chromium page means the chrome |
| TYPE I LOVE YOU | `text_type {text}` | `system` | Typing into whatever had focus (see `window_focus` below) |
| PRESS ENTER | `input_tap {keys:['enter']}`, or `text_type {pressEnterAfter:true}` | `system` | Sending **before** the confirmation gate |
| *(verify before sending)* | `user_confirm {what, details}` | `safe-read` | Reporting "sent" without `approved:true` |

Bringing a window forward is `window_focus {titleContains|processName|pid}`.
⚠️ Edge's real accessible title contains a zero-width space and is usually the
**tab** title, not "Microsoft Edge" — match on the text the user sees in the tab,
and read the "open windows right now" list a miss prints instead of retrying.

---

## 4. Lane 3 — the walkthrough runner

`simple-addon/server/automation/eval/walkthrough.js` drives the **installed**
addon through its own HTTP API (`POST /api/automation/execute`), one tool at a
time, so you can see what each call really returns. No rebuild, no release, no
reinstall.

```powershell
cd simple-addon

npm run walk -- --list        # the stage table, executes nothing
npm run walk -- --tools       # every tool the INSTALLED build offers, by category

npm run walk                  # stages 0-6 — nothing is sent
npm run walk -- --only 3      # just stage 3
npm run walk -- --from 1 --to 4 --pause
npm run walk -- --confirm     # + stage 7 (asks YOU)
npm run walk -- --send        # + stages 7 and 8 (presses Enter — really sends)
```

### Testing one tool in isolation

This is the primitive the whole file exists for:

```powershell
npm run walk -- --tool screen_ocr --raw
npm run walk -- --tool text_type                      # prints its argument SCHEMA, runs nothing
npm run walk -- --tool click_at --args '{\"x\":812,\"y\":233}'
npm run walk -- --log out.jsonl                       # JSONL of every call, for evidence
```

In PowerShell the inner quotes must be escaped (`'{\"x\":1}'`); the script says so
if it gets unparseable JSON. `--raw` disables the field clipping that keeps a
`uia_snapshot` from burying the one value you are looking at.

### The stages

| # | Stage | Settles |
|---|-------|---------|
| 0 | preflight | Is the addon up, which build, and does it have every tool the recipe needs? |
| 1 | open the browser **and the site** | Two clauses in one stage, because the order is forced: an Edge window is titled after its active tab, so there is nothing called "Google Messages" to focus until the page is open. Opens a **new tab** (Ctrl+T, never Ctrl+L) so the page already open in that window survives. **The most upstream failure.** |
| 2 | `uia_snapshot {windowName:'Edge'}` | That a Chromium page exposes browser chrome **and the tab strip** only — the fact that dictates `screen_ocr` |
| 3 | locate the contact | `uia_find` → 0, then `screen_ocr {window:'Messages'}` → a real coordinate. Passes `window` because an unscoped capture matches the agent's own chat text |
| 4 | click the located row | The coordinate from 3, as a click. Refuses to guess if 3 did not run |
| 5 | `screen_set_of_marks` | What UIA can number — chrome on a Chromium page, not the page |
| 6 | type, **no Enter** | Typing works, sending is a separate question |
| 7 | `user_confirm` | The gate. Off unless `--confirm` — it waits for you to answer in the addon UI |
| 8 | press Enter | ⚠️ Irreversible. Off unless `--send` |

### Behaviour worth knowing

- Stages 1-6 **move the real mouse and type**. Don't run them while using the machine.
  Stage 1 also **drives your browser**: it opens a new tab (Ctrl+T, never Ctrl+L, so
  nothing you already had open is replaced) and navigates it to Google Messages.
- The runner sets `safe-read` and `system` to `allow` for the run (otherwise every
  acting call blocks on a prompt it cannot answer) and **restores your permission
  config in a `finally`**. `--dry` uses dry-run mode instead; `--no-perms` leaves
  the config untouched.
- It measures the **installed** build. If a fix is not in an installed build yet,
  lanes 1-2 are how you test it — and the runner says so when it spots a known
  pre-fix shape (e.g. `screen_ocr` returning a char-spread with no `lines`).

---

## 5. Failure modes already diagnosed — check these before re-deriving them

Real runs on this recipe produced all of the following. Each one is fixed or
contained, so a repeat is evidence of something *new*.

| Symptom in the run | Cause | Where the fix lives |
|---|---|---|
| 20+ steps, every one a read (`uia_snapshot`, `perception_recent`) | "Look again" was never framed as *not progress* — and a truncated result looked like a missing one | Prompt rule 18; the cut result now says it was cut and cannot show more |
| Repeated identical call until the run stops | An always-`ok` tool (e.g. `screen_capture`) never moved the stall counter | Repeat guard: same `tool:args` 3× → notice in the result, counted as no progress |
| `window_focus` failed, then failed identically | "window not found" named neither the selector nor what *was* open | `windowFocusMissMessage()` lists the open windows and forbids a repeat |
| `uia_find {name:'Dakota'}` → 0, retried | `ok: true, count: 0` read as success | The zero-match result now explains the Chromium fact and names `screen_ocr` |
| No acting call in the whole run | The prompt pointed at a *second* browser (`browser_*`), not at the app the user is already signed into | Rules 12-14 are native-first; `browser_*` is for sites the user is *not* signed into |
| Refused the task ("I cannot send messages through web services") | The prompt's first line said the remit was "Windows" | Remit restated; rule 19 authorises acting on the user's behalf |
| Sent without asking | Nothing could block on *content* — `goal_ask_user` only leaves a question and returns | `user_confirm` blocks on the real approval prompt |
| "Agent stopped — stalled (stalled)" | `status` and `reason` were the same raw token | `stop-reason.js` owns the human sentence |
| 60 steps burned during an LLM outage | An LLM error spent a step and never reached the stall detector | Step refund + backoff + a cap; stops with `llm-unavailable` |
| `screen_ocr` returned **1.7 MB of `{"0":"{","1":"\"",…}`** and `ok:true` | `ConvertTo-Json` left 69 raw BEL chars in the payload → invalid JSON → `ps-runner` silently resolved the raw **string** → `{ ...out }` spread it, one key per character. OCR is the *only* way to read a Chromium page, so the agent had no working window on the page and no error saying so | **Fixed 2026-09-19** — `PS_CLEAN_TEXT` sanitises C0 controls before serialising, `assertOcrPayload` throws instead of spreading. `tools/ocr.test.js` pins both |
| A search of an OCR capture matched **the agent's own chat window** | A capture with no `window` covers the whole primary monitor, so it reads the other apps on it — and the words being searched for are displayed in the conversation that requested them. Measured: 4 matches for "Dakota", **all 4 in VS Code, none in the browser** | **Fixed 2026-09-19** — `screen_ocr {window:'<title substring>'}` captures only that window (resolved with the same `Get-CandidateWindows` the focus path uses, and captured in a DPI-aware process so the coordinates match `click_at`). Same screen, scoped: 39 lines instead of 367, 0 leaked, the real `"Dakota Jade"` row found at (5268, 427) |

**Evidence path for a bad run:** `%APPDATA%\simple-addon\logs\main.log` — one line
per step (`[agent] step N tool=X ok=true|false`) plus `loop exited: <reason>
(steps=N)`. `run-history.jsonl` is **not** written by the agent loop; don't look
for it.

---

## 6. Keeping it cheap

1. **Read the trace before believing the symptom.** A report of "stuck on
   `window_focus`" turned out to be an LLM outage; a report of "screen capture
   loop" was a separate cause. The log says which.
2. **One hypothesis per run.** Lanes 1-2 are for forming it; lane 3 is for
   confirming it against the real build.
3. **Don't release to test a prompt or a tool body.** Lane 1 or 2 answers it.
4. **A new failure must announce itself.** A tool that fails, or truncates output,
   and says neither, will be retried forever — that lesson is why results carry
   `HARNESS:` notes.
5. When you finally do release, do it **once**: `cd simple-addon; node release.js`
   (bumps the build, tags `addon-vX.Y.Z`, CI publishes, the auto-updater picks it up).
6. **Check the installed version against the newest tag before debugging anything.**
   `npm run walk -- --tools` lists what the build in front of the user actually offers;
   `git tag --list 'addon-v*' --sort=-v:refname` lists what has been released. A missing
   `hint`, a missing tool, or an old behaviour is often just an uninstalled release.

---

## 7. Walk log — 2026-09-19, the Google Messages sentence

Run end to end with the three lanes, against the then-installed **v1.0.66**. Recorded
because none of these failures were guessable from the source.

| Step | Result |
|---|---|
| `window_focus {titleContains:'Messages'}` **before** the site is open | ✗ correctly, and the message listed the 8 real windows. Good failure |
| `open_app {name:'msedge'}` | ✓ but it may add a tab to the existing window — it does not open a page |
| "GO TO GOOGLE MESSAGES" | not expressible as a focus. The window title *is* the active tab, so nothing called "Google Messages" exists until the page does. Two native routes work: select the existing `TabItem`, or navigate |
| navigate (Ctrl+T → URL → Enter) | ✓ title became `Google Messages for web: Conversations and 2 more pages` — the session is signed in. **Now stage 1 of the runner** |
| `uia_snapshot {windowName:'Edge'}` | ✓ chrome **+ tab strip**, no page content — rule 14 confirmed, and the strip is why an open tab can be selected |
| `uia_find {name:'Dakota'}` | ✗ `count: 0`. On v1.0.66 the explanatory `hint` is **absent** — it ships in the next release |
| `screen_ocr` | ✗✗ **the blocker**: char-spread object, `ok:true`. See §5 |
| `screen_ocr` again, repo code (lane 2) | ✓ `{text, lines: 365}`, 0 control characters, 1.5 s |
| search that capture for "Dakota" | ⚠️ 4 matches, **all of them the agent's own chat window and this doc** — an unscoped capture covers the whole primary monitor, other apps included. A match is not evidence until the capture is scoped |
| `screen_ocr {window:'Messages'}`, repo code | ✓ **39 lines, 0 leaked, the real `"Dakota Jade"` row at (5268, 427)** — a match a click can be trusted with |
| `click_at` with no derived coordinate | correctly **skipped** rather than guessing |
| the same run against the installed build | `screen_ocr {window:…}` came back as a **char-spread**: that build predates the fix and ignores `window`. The runner now says so, instead of reporting "no Dakota coordinate" and sending you hunting in the wrong place |

Both fixes are in the repo and are **not yet in an installed build** — everything above
marked "repo code (lane 2)" is what the next release changes for real.
