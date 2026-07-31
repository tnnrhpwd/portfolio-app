# IQ Test — Improvement Ideas

A backlog of potential improvements for the IQ Test feature, informed by common
practices in real psychometric instruments (WAIS-IV, Raven's Progressive
Matrices, CHC theory, IRT-based adaptive testing). This is a brainstorm list,
not a committed roadmap — pick items off as priorities allow.

## 1. Results & reporting
- [ ] **Export results to PDF** — full report with IQ score, percentile, category
      breakdown, radar/bar chart, time taken, and disclaimer. Use `jspdf` +
      `html2canvas` (or `react-to-print`) client-side, no backend needed.
- [ ] Shareable results card/image (PNG) sized for social sharing, with a link
      back to retake the test.
- [ ] Historical results tracking for logged-in users — save past attempts via
      the existing backend and show a progress-over-time chart.
- [ ] Downloadable CSV of raw answers for self-analysis.
- [ ] Printable certificate-style one-pager, distinct from the detailed PDF.

## 2. Psychometric rigor (industry-standard practices)
- [ ] Norm-referenced scoring via IRT (Item Response Theory) instead of a
      simple difficulty-weighted average — each question gets a
      discrimination/difficulty parameter, ability (θ) is estimated via a
      logistic model, then mapped to IQ.
- [ ] Computerized Adaptive Testing (CAT) — next question difficulty adjusts
      based on prior answer correctness, converging on ability faster with
      fewer items (like modern GRE/WAIS-style adaptive tests).
- [ ] Split into timed subtests mirroring WAIS-IV index scores (Verbal
      Comprehension, Perceptual Reasoning, Working Memory, Processing Speed)
      instead of one flat total — report a composite plus per-index scores.
- [ ] Add a working-memory / processing-speed component (e.g., digit span
      recall, symbol-matching speed tasks) — core to real IQ batteries but
      missing today.
- [ ] Add visual-spatial / matrix-reasoning items (Raven's-style abstract
      pattern matrices with images/SVGs) — more culture-fair than
      verbal-heavy logic items.
- [ ] Show a confidence interval on the IQ score (e.g., "115 ± 6") rather than
      a bare point estimate, reflecting standard error of measurement.
- [ ] Add an untimed, unscored practice/calibration question before the real
      test starts so users understand the format.

## 3. Test content & question bank
- [x] Expand the question pool significantly to reduce repeat-question
      fatigue and support future adaptive selection.
- [ ] Track "seen" questions per user/session to avoid immediate repeats.
- [ ] Add image-based / non-verbal reasoning items (pattern completion,
      odd-one-out shapes) to reduce language/cultural bias.
- [ ] Tag items with richer IRT-style metadata: discrimination index,
      expected pass-rate — not just a 1–3 difficulty bucket.
- [ ] Randomize category order and interleave questions rather than block by
      category, to reduce within-category fatigue/practice effects.
- [ ] Calibrate item difficulty from real aggregate user data over time.

## 4. Test administration / UX
- [ ] Standardized timer per question or per section, with an optional
      "untimed practice mode" vs. "standard timed mode" scored differently.
- [ ] Progress auto-save (localStorage/sessionStorage) so a refresh mid-test
      doesn't lose answers.
- [ ] Decide explicitly whether back-navigation/answer-changing is allowed
      (most standardized tests don't allow revisiting).
- [ ] Distraction-free full-screen quiz mode.
- [ ] Mobile-friendly touch targets and swipe navigation.
- [ ] Countdown/warning before time expires, if a time limit is added.
- [ ] Explain scoring methodology upfront on the start screen for
      transparency.

## 5. Accessibility & inclusivity
- [ ] Screen-reader support: ARIA live regions for timer/progress updates.
- [ ] Keyboard navigation (number keys 1–4 to select, Enter to continue).
- [ ] Font-size / high-contrast / dyslexia-friendly font toggle.
- [ ] Text-to-speech read-aloud for questions/passages.
- [ ] Localization for the English/reading sections, or a clear note that
      they are English-specific and not culture-fair.

## 6. Statistical/reporting improvements
- [ ] Show z-score and standard error alongside the IQ number.
- [ ] Population comparison chart — bell curve with the user's score plotted.
- [ ] Category-level standard scores (mean 100, SD 15) instead of raw
      correct/total counts.
- [ ] Distinguish speed vs. accuracy per category (e.g., flag "correct but
      slow" patterns).

## 7. Anti-gaming / integrity
- [ ] Soft warning on tab-switching / copy-paste detection (not enforced,
      just a caveat since this is for fun).
- [ ] Continue randomizing both question and option order; consider rotating
      distractor phrasing occasionally.
- [ ] Note or rate-limit repeated retakes, since practice effects inflate
      scores on standardized re-testing.

## 8. Engagement / gamification
- [ ] Badges/achievements (e.g., "Logic Master" for 5/5 in a category).
- [ ] Compare with friends via a shareable, privacy-conscious link/leaderboard.
- [ ] "Retake weak category only" mode to drill specific areas.
- [ ] Daily/weekly challenge question separate from the full test.

## 9. Technical/architecture
- [ ] Move the question bank to backend/DB so it can grow without a redeploy,
      and to support server-side adaptive selection.
- [ ] Unit tests for `computeIQ`/`probit` in
      [iqStats.js](iqStats.js) — cover edge cases (0%, 100%, NaN).
- [ ] Analytics on per-question pass rates to catch miscalibrated or broken
      items.

---
*This is an entertainment feature, not a clinically validated psychometric
instrument. Any improvements should keep that disclaimer prominent.*
