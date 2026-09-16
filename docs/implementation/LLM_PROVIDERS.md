# Cloud models — the provider seam, the catalogue, and which model is the default

One place for "which model runs this": the provider interface every caller goes through, the catalogue the pickers are built from,
and the rule that chooses a default for a user who never picked one.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## LLM provider seam — ✅ implemented


## Which cloud models the UI offers — one source of truth (2026-09-14)

The backend has served **two** cloud providers since DeepSeek landed (`7890f23`), and
`/net` still offered **one**: the sidebar rendered the resolved *current* model as
static text ("Claude Haiku 4.5"). Nothing was broken server-side — the chat would
have used DeepSeek if asked — but there was no way to ask from the surface the chat
user actually looks at. Advanced Settings had a real picker; the rail did not.

The lesson is that *sharing the data wasn't enough*: the list was already central
(`buildCloudModelList`), and a surface still showed a subset by rendering it
differently. So the fix has three layers, in the order they matter:

| Layer | Owns | File |
|---|---|---|
| Server | which providers/models exist at all | `backend/utils/llmProviders.js` `PROVIDERS` → `GET /api/data/llm-providers` |
| Data | payload → option list, labels, fallback | `frontend/src/utils/llmProviderOptions.js` |
| Rendering | the `<select>` itself | `frontend/src/components/SimpleAddon/CloudModelSelect.jsx` |

- **`cloudModelOptions(payload)`** is the option list: everything the live payload
  reports, or the always-on default when it is empty (before the fetch lands, or if
  it failed) — a picker is never empty and never a stale id.
- **`cloudProviderSummary(payload)`** is the provider label
  ("☁️ Cloud (AWS Bedrock + DeepSeek)"). The option used to read
  `providerLabel(DEFAULT_CLOUD_PROVIDER)`, i.e. it named one vendor while a second
  one was answering. The always-on provider leads, so the label doesn't reorder
  itself with the server's JSON key order.
- **`CloudModelSelect`** renders them and is used by *both* surfaces that offer a
  cloud model — the `/net` rail and `AIWorkflowSettings` (Advanced Settings **and**
  `/settings`, one component). Options are provider-qualified, because two providers
  can serve models whose plain names collide.

**Guards, so this cannot silently regress** (the point of the exercise):

- `frontend/src/utils/llmProviderOptions.test.js` — the payload→options mapping,
  plus two source-level checks: **no file outside the two allowed ones builds its
  own cloud model list**, and both surfaces render `<CloudModelSelect>`. A future
  surface that hand-rolls a subset fails the suite rather than shipping.
- `frontend/src/components/SimpleAddon/CloudModelSelect.test.jsx` — a payload with
  two providers offers every model from both, provider-qualified; the control is
  never empty; a retired stored id is never shown as selected.
- `backend/__tests__/unit/llmModelSync.test.js` — a drift guard on the same pattern
  as `pricingSync.test.js`: it reads the real `PROVIDERS`, so **adding a provider
  server-side fails the build until the frontend is triaged** (allowlist it, or
  list it in `NON_CLOUD_PROVIDERS` with a reason in the test), and it catches
  `MODEL_LABELS` entries for models the backend no longer serves — the exact class
  of stale name that survived the GitHub Models → Bedrock migration.

Verified live on `/net` with both providers configured: the rail and the Advanced
Settings modal each list DeepSeek-V3 (Chat), DeepSeek-R1 (Reasoner) and Claude
Haiku 4.5, and selecting one updates the stored `portfolioModel`. Both chat paths
honour it — `makeLLMCall`/`streamLLMCall` route a non-Bedrock provider through the
OpenAI-compatible `createCompletion`/`streamCompletion`, and
`parseCompressionRequest` honours `provider: 'deepseek'` when the server has a key.


## The default model is the cheapest one, until the user picks (2026-09-14)

With two providers live, "the default model" stopped being a fact and became a
policy. It used to mean Bedrock's Claude Haiku 4.5 *by construction* — the only
model the app had — so adding DeepSeek (cheaper on both input **and** output)
left every user who never opened the picker on the dearest model. The policy is
now explicit: **the default is the cheapest cloud model the server is configured
to serve.**

| Where | What it decides | File |
|---|---|---|
| Server | which model is cheapest, and therefore default | `utils/llmProviders.js` `getDefaultModel()` |
| Payload | flags it (`isDefault`) + numeric `inputRate`/`outputRate` | `getAvailableProviders()` |
| Request | a body that names no model uses it | `llmService.parseCompressionRequest` |
| Client | pre-selects it for a user who hasn't chosen | `utils/llmProviderOptions.js` `defaultCloudModel()` |

- **Ranked on cost, from the metering table** (`API_COSTS`, input + output per
  1M), not on a hand-written order: `deepseek-chat` $0.27/$1.10 beats
  `deepseek-reasoner` $0.55/$2.19 beats Claude Haiku 4.5 $1.00/$5.00. Unknown
  models rank last (`Infinity`), so an unpriceable one can never win. Ties break
  on provider then model id, so a deployment always resolves to the same model.
  Today that means **DeepSeek-V3 (Chat)**; with no DeepSeek key the cheapest
  configured model is Claude, and nothing needs changing.
- **`parseCompressionRequest` got the general rule** instead of a second special
  case: a client-requested provider/model is honoured when the server can serve
  it, and anything else (retired `github`, unknown id, provider without
  credentials) resolves to the default. The old code hardcoded
  `bedrock`/`BEDROCK_MODEL_ID` and special-cased DeepSeek, which would have
  ignored an explicit Bedrock request once the default moved.
- **The request layer stopped naming a model it hadn't resolved.** `dataService`
  and `Net.jsx`'s handlers used to default to `bedrock` + `DEFAULT_CLOUD_MODEL_ID`;
  sending that would override the server's default and bill the dearer provider.
  They now omit both unless the chat resolved them.

**"Unless a user changes it" needed a record of the choice.** A stored model id
cannot say whether it is a preference or the app's own default — and every
existing account holds the old default (Claude). So the picker writes the model
**and** `portfolioModelChosen` together (`cloudModelChoicePatch`), and resolution
is:

1. the recorded choice, while the server still offers it;
2. otherwise a stored id that is *not* a legacy default
   (`LEGACY_DEFAULT_CLOUD_MODEL_IDS`) — a pick made before the record existed;
3. otherwise the cheapest configured model.

A stored copy of a legacy default therefore reads as "never chosen", which is
correct for every account in existence: while that id was the default it was
either the only option in the picker or the value the app seeded settings with,
so it cannot carry a preference. A user who picks it *now* records a real choice
and keeps it. `portfolioModelChosen` syncs like any other setting (registered in
`/settings`' cloud pull list — where new keys have to be).

Verified live on `/net` with both providers configured: the rail — which holds the
old Claude id and no choice record — now pre-selects **DeepSeek-V3 (Chat)** and
shows `☁️ Cloud (AWS Bedrock + DeepSeek)`, with `Claude Haiku 4.5` one click away.
**Trade-off, deliberately taken:** the default model is also the model that runs
`/net`'s repo-agent tool loop, and Claude 4.5 is the stronger one at long tool
sequences. DeepSeek does support `tools`/`tool_choice` through the
OpenAI-compatible path (`createCompletion` forwards both), so the workflow still
functions — picking Claude in the rail restores the previous behaviour.

Tests: `backend/__tests__/unit/llmModelSync.test.js` holds the ranking to the real
`API_COSTS` table, asserts the payload flags exactly that one model, and — the one
that matters most — asserts the **frontend resolves the same default from the real
payload**, so the two languages cannot drift. It also covers the request rule
(nameless → default, servable → honoured, retired → default). The client side is
covered in `utils/llmProviderOptions.test.js` and `CloudModelSelect.test.jsx`
(never-chosen → cheapest, legacy default → cheapest, recorded choice → kept).

---

