# Quizzes (`/quizzes`)

The quiz family lives here. Every quiz has **its own route and its own lazily
loaded bundle**, and they all share one engine — so adding a quiz means writing
a config file, not a page.

```
Quizzes/
  meta.js              catalogue (slug, path, name, emoji, tagline, minutes, accent)
  QuizPage.jsx         the single-person engine: start → questions → results → review
  QuizPage.css         shared styles (.quiz-*)
  CoupleQuizPage.jsx   the two-person engine (compare + prompt modes)
  CoupleQuizPage.css   styles for the two-person extras (.quiz-duo-*)
  quizEngine.js        pure scoring helpers (unit-tested)
  Quizzes.jsx/.css     the /quizzes hub that lists the catalogue
  data/<slug>.js       one config per quiz (items + a formatter)
  pages/<Name>.jsx     a ~10-line wrapper: <QuizPage quiz={config} />
```

## Adding a quiz

1. Add an entry to `QUIZZES` in `meta.js`.
2. Create `data/<slug>.js` — see `data/mbti.js`, which is the annotated
   reference. It needs: `...quizBySlug('<slug>')`, SEO copy, `intro`, `pills`,
   `hint`, `scale`, `items`, `disclaimer`, and `interpret(scores, responses)`.
3. Create `pages/<Name>.jsx`:
   ```jsx
   import QuizPage from '../QuizPage';
   import config from '../data/<slug>';
   export default function Name() { return <QuizPage quiz={config} />; }
   ```
4. Lazy-import it and add its route in `frontend/src/App.js`.
5. Run `node node_modules/jest/bin/jest.js --config package.json frontend/src/pages/Projects/Quizzes`
   — `quizzes.test.js` picks the new config up automatically and checks it
   against the right mode's contract.
6. Optional: add a Bedrock prompt for its card art in
   `backend/scripts/generate-project-art.js` and run it with the slug.

## Length presets

Every quiz offers the same three lengths the IQ Test does — short, standard,
full — declared in the config:

```js
lengths: {
  short:    { label: 'Short',   count: 10, minutes: 3 },
  standard: { label: 'Standard', count: 20, minutes: 5 },
  full:     { label: 'Full',    count: 30, minutes: 7 },
},
defaultLength: 'standard',
```

A length is just a **count**; the labels and minutes are only display copy.

### A subset must be balanced, not a slice

`selectItemIndices(items, count)` in `quizEngine.js` picks which items to ask.
It never takes the first *N*, and never samples at random, because these quizzes
are built from small deliberately-balanced groups (4 dichotomies, 5 traits, 3
sets, …) — a slice or a random pick would silently drop whole areas from the
result. Instead it:

1. keeps every item marked `core: true`, and counts those against the budget;
2. allocates the remainder across groups (by `dim`, else `set`) in proportion
   to group size, using largest-remainder so the total always lands exactly on
   `count`, then spreads each group's picks evenly rather than clustering them;
3. prefers an even mix of forward- and reverse-keyed items, so a short run
   isn't systematically skewed by acquiescence.

It is deterministic, so the same length always produces the same quiz. Callers
must **not** re-shuffle the result out of order for prompt-mode quizzes — see
below.

`core: true` is how ADHD keeps its six-item ASRS screener in every length, and
why that quiz's shortest option is a "Screener" rather than a smaller balanced
set. Use it sparingly: core items are taken off the top of the budget, so a
large `core` set makes the shorter lengths less representative, not more.

### The other copy has to stay honest

`intro`, `hint`, and `disclaimer` describe the **full** quiz and must not
contradict the picker. In practice that means do not restate item counts or
per-group counts in `hint` ("30 statements, six per trait") — the picker sits
directly above it and owns that number. Describe the scale and the answering
rules instead, and let the picker say how long it is. `QuizPage` and
`CoupleQuizPage` render one shared explanatory line under the picker covering
what shortening does.

## The three modes

`mode` selects both the config shape and the page component.

| `mode` | Component | Formatter | Used by |
| --- | --- | --- | --- |
| `solo` (default) | `QuizPage` | `interpret(scores, responses)` | MBTI, Big Five, Enneagram, autism, ADHD, attachment, love languages |
| `compare` | `CoupleQuizPage` | `formatComparison(comparison, ctx)` | Values & Future Alignment |
| `prompt` | `CoupleQuizPage` | `formatSession({ names, ratings })` | The 36 Questions |

### compare

Both partners answer the same scored items — one at a time, behind a handoff
screen — and `compareResponses()` (quizEngine) scores how close the two answers
were per item. `formatComparison` gets `{ overallPct, byDim, items }` plus
`{ names, scale }`, and may return a `gaps` array (the biggest differences,
first) on top of the normal result shape. Each item carries a `discuss` prompt
that the gaps list attaches to the relevant difference.

### prompt

Nothing is scored: there is no `scale` and no `interpret`. The questions are
read aloud in three escalating sets, and the only recorded values are each
partner's private closeness rating at the end. `formatSession` returns the usual
shape minus `bars` — the shared assertion in the test file allows that.

Neither two-person mode writes to quiz history, on purpose: a record would put
one partner's answers into the other's account, and a comparison is about one
sitting rather than a score to track. Do not add it back without thinking about
that.

## Two rules the engine depends on

- **`scale` must run from least to most.** Index 0 is the lowest agreement /
  frequency, the last index is the highest. `quizEngine.scoreTraits` assumes a
  higher index means "more of the trait", which is what lets reverse-keyed items
  work by flipping the value.
- **Items are shuffled at runtime** unless the config sets `shuffle: false`.
  Part-based instruments (the ADHD screener) must opt out, or their parts stop
  being parts.

## Item shape

```js
{ dim: 'EI', key: -1, text: '…' }
```

`dim` is the dimension the item feeds; `key` says which way agreement points
(`+1` = toward the dimension's high pole, `-1` = away from it). Reverse-keyed
items are what stop a quiz measuring "how positively do you describe yourself".

## Scoring

`scoreTraits(answers, scaleMax)` returns per-dimension `pct` (0–100 toward the
high pole, comparable across dimensions with different item counts) and
`points` (raw symptom points, for the screening quizzes). A skipped item counts
as neutral, never as disagreement, and never adds points.

`interpret(scores, responses)` turns that into what the page renders:

```js
{
  headline, headlineSub, summary,
  stats:  [{ val, lbl }],
  bars:   [{ label, pct, caption, note }],   // caption renders under the bar
  blocks: [{ title, body }],
  note,
}
```

`bars` is optional for the `prompt` mode and required for the other two.

Headlines must not contain `|` — they are written into a pipe-delimited history
record.

## Content and disclaimers

Every quiz is an **original questionnaire in the style of** a well-known
instrument, never a copy of one — MBTI, the Enneagram, the AQ/RAADS-R and the
ASRS are all trademarked, copyrighted or licensed, and their items are not
reproduced here. The same goes for the two couple exercises: "The Five Love
Languages" is a trademarked book and the 36 Questions are published text, so the
questions on this site are written for it, not lifted. Each config therefore
carries a disclaimer saying so, and the screening quizzes carry the stronger
one: a self-report score is a reason to seek a real assessment, not a result.
Please keep that distinction if you edit the copy.

The IQ Test is **not** part of this family — it has its own page and its own
implementation at `/iq`, and its own stylesheet. It is listed on the hub via
`STANDALONE_QUIZZES` (see below) rather than `QUIZZES`, and the catalogue tests
iterate `QUIZZES`, so a standalone entry never has to pretend to have a config.

## Colour schemes

These pages follow the visitor's colour scheme (`utils/scheme.js`,
`--scheme-*` in `index.css`) through an alias block at the top of `QuizPage.css`
and `Quizzes.css` — the same trick `Home.css`, `Profile.css`, `Pricing.css` and
`Support.css` use. It re-points the four raw `--fg-*` / `--bg-*` families at the
scheme's two roles, so **no rule below it had to change**.

Two things are load-bearing and easy to break:

- **A ramp must never be built from `--quiz-accent`.** Ramps read the aliased
  families (`--fg-blue` → accent, `--fg-mint` → primary), which is always a real
  two-hue ramp. `--quiz-accent` is the _per-quiz_ role and is only for
  single-hue highlights (option border, focus ring, question badge). Using it in
  a ramp collapses that ramp to a flat fill on any quiz whose own role matches
  the ramp's first stop — which is exactly what happened first time round, and
  it is why the button fill was verified in the browser rather than assumed.
- **Full-bleed backgrounds take `--scheme-backdrop-*`, not `--scheme-*-bg`.**
  `-bg` is calibrated as a small tint; over a whole page it is too light in dark
  mode for muted text to keep its contrast. `index.css` documents this at
  length.

`accentRole` in `meta.js` is `'accent'` or `'primary'`, never a colour — a fixed
hue there would silently opt that quiz out of the scheme. Neighbouring quizzes
alternate roles so the hub does not read as one hue.

⚠️ The IQ Test's eight category badges deliberately do **not** follow the scheme:
they are a legend of eight distinguishable hues, and the scheme offers two. They
read their own `--iq-legend-*` tokens, which the alias block does not touch.
