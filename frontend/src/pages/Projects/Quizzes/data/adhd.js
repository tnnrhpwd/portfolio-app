/**
 * ADHD Self-Report Scale — 18 symptom statements in the ASRS shape: a short
 * six-item screener first, then the remaining twelve.
 *
 * Because the parts are meaningful, this quiz sets `shuffle: false` and is
 * presented in a fixed order (the screener first). Everything else about the
 * item order would be fine shuffled; this one is not.
 *
 * This is NOT the WHO Adult ADHD Self-Report Scale. The wording is original;
 * only the two-part structure and the frequency scale are borrowed. It cannot
 * diagnose ADHD, and the page says so in three places.
 */
import { quizBySlug } from '../meta';
import { bandFor, traitRows } from '../quizEngine';

const DOMAINS = [
  {
    key: 'attention',
    name: 'Attention',
    note: 'Sustaining focus, organising, remembering, finishing.',
    high: 'Staying with something that is not intrinsically interesting is the hard part — you can focus intensely on what grips you and lose the thread of what does not. Starting tends to be harder than finishing, and the last 10% of a task is the expensive part.',
    low: 'You can hold your attention on a task you do not enjoy, and you generally keep track of the details and commitments in front of you.',
  },
  {
    key: 'energy',
    name: 'Hyperactivity & Impulsivity',
    note: 'Restlessness, waiting, speaking before thinking.',
    high: 'There is a restlessness underneath that does not always show on the outside: sitting still costs effort, waiting is genuinely uncomfortable, and you speak before the thought has finished forming more often than you would like.',
    low: 'You can sit with boredom and wait your turn without much strain, and you usually get a thought fully formed before you say it.',
  },
];

const BANDS = [
  { min: 0, max: 24, label: 'Few indications', body: 'Your answers gave little signal in the areas this questionnaire looks at. That is not proof of anything either way — self-report is a blunt instrument, and it misses as much as it finds.' },
  { min: 25, max: 44, label: 'Some indications', body: 'You endorsed some of these statements. Most people endorse a few. The useful question is whether the ones you endorsed are things you have had to build workarounds for, or just things that are true of you.' },
  { min: 45, max: 64, label: 'Moderate indications', body: 'A fair number of these statements were marked often or very often. Patterns like this are worth taking seriously enough to read about, and worth mentioning to a doctor if they have been a theme across your life rather than something new.' },
  { min: 65, max: 100, label: 'Strong indications', body: 'You marked a large share of these statements as frequent. Screening questionnaires at this level are normally treated as a prompt to seek a proper assessment rather than as an answer. If this describes a long-standing pattern, it is worth taking these results to a GP or psychiatrist — what you would get is a real assessment, not this.' },
];

const meta = quizBySlug('adhd');

export default {
  ...meta,
  // The six Part A items are `core`, so every length asks the whole screener
  // and the result's "Part A elevated: x / 6" stays true. Short IS Part A.
  lengths: {
    short: { label: 'Screener', count: 6, blurb: '~2 min' },
    standard: { label: 'Standard', count: 12, blurb: '~3 min' },
    full: { label: 'Full', count: null, blurb: '~5 min' },
  },
  defaultLength: 'standard',
  seoTitle: 'ADHD Self-Report Scale (ASRS Style)',
  seoDescription:
    'A free 18-statement ADHD self-report questionnaire in the ASRS style — a six-item screener plus twelve more across attention and hyperactivity/impulsivity, with clear non-diagnostic results.',
  intro:
    'This is a screening questionnaire, not a diagnosis. It follows the shape of the ASRS: a six-item '
    + 'screener first, then further statements, scored across attention and hyperactivity/impulsivity. It '
    + 'is written for adults, and it is most useful if you answer for how you have been throughout your '
    + 'life rather than how you have been this month.',
  pills: [
    { emoji: '🎯', label: '6-question screener' },
    { emoji: '🧠', label: 'Attention' },
    { emoji: '⚡', label: 'Hyperactivity & impulsivity' },
  ],
  hint:
    'Never-to-very-often frequency scale, in a fixed order — every length starts with the six-item '
    + 'screener. There is no skip: every statement needs an answer for the totals to mean anything.',
  scale: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
  shuffle: false,
  allowSkip: false,
  disclaimer:
    'Not a diagnosis. This is an original questionnaire inspired by the ASRS — it is not the WHO Adult '
    + 'ADHD Self-Report Scale, and no self-report questionnaire can diagnose ADHD. Diagnosis is made by a '
    + 'clinician, taking in your history, your school years and the impact on your daily life. If these '
    + 'questions resonate, that is a reason to look into it properly, not a result.',

  items: [
    // ── Part A: the six-item screener ──
    // `core: true` keeps all six in every length — see `lengths` above.
    { part: 'A', core: true, dim: 'attention', key: 1, text: 'How often do you find it hard to keep your attention on a task once it stops being interesting?' },
    { part: 'A', core: true, dim: 'attention', key: 1, text: 'How often do you put something off until the pressure becomes unavoidable?' },
    { part: 'A', core: true, dim: 'attention', key: 1, text: 'How often do you have trouble getting things in order when a task needs organising?' },
    { part: 'A', core: true, dim: 'energy', key: 1, text: 'How often do you fidget, tap or shift in your seat when you need to sit still?' },
    { part: 'A', core: true, dim: 'energy', key: 1, text: 'How often do you feel restless or wound up inside, even when you are sitting down?' },
    { part: 'A', core: true, dim: 'energy', key: 1, text: 'How often do you act on a decision before you have fully thought it through?' },

    // ── Part B: the remaining twelve ──
    { part: 'B', dim: 'attention', key: 1, text: 'How often do you finish the last steps of a project after the interesting part is over?' },
    { part: 'B', dim: 'attention', key: 1, text: 'How often do you forget appointments or obligations you had agreed to?' },
    { part: 'B', dim: 'attention', key: 1, text: 'How often do you avoid or delay starting a task that needs sustained thought?' },
    { part: 'B', dim: 'attention', key: 1, text: 'How often do you lose things you need for everyday tasks — keys, phone, wallet, paperwork?' },
    { part: 'B', dim: 'attention', key: 1, text: 'How often are you distracted by activity or noise going on around you?' },
    { part: 'B', dim: 'attention', key: 1, text: 'How often do you find your attention drifting during a conversation or a film?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you leave your seat when you are expected to stay put?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you have trouble doing quiet, still things in your downtime?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you find yourself talking more than the people around you?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you finish other people’s sentences or answer before they have finished asking?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you find it hard to wait your turn?' },
    { part: 'B', dim: 'energy', key: 1, text: 'How often do you interrupt or talk over other people without meaning to?' },
  ],

  partLabel: (item) => (item.part === 'A' ? 'Part A · Screener' : 'Part B'),

  interpret(scores, responses) {
    // "Elevated" mirrors how the real screeners are read: the count of items
    // answered Often or Very often matters more than the raw total.
    const elevated = responses.filter((r) => r.value !== null && r.value >= 3);
    const partAElevated = elevated.filter((r) => r.part === 'A').length;

    const total = Object.values(scores).reduce(
      (acc, bucket) => ({ points: acc.points + bucket.points, pointsMax: acc.pointsMax + bucket.pointsMax }),
      { points: 0, pointsMax: 0 }
    );
    const max = total.pointsMax || 1;
    const pct = Math.round((total.points / max) * 100);
    const band = bandFor(pct, BANDS);
    const rows = traitRows(scores, DOMAINS);

    return {
      headline: `${pct}%`,
      headlineSub: band?.label || 'Result',
      summary: band?.body || '',
      stats: [
        { val: `${elevated.length} / ${responses.length}`, lbl: 'Often or very often' },
        { val: `${partAElevated} / 6`, lbl: 'Part A elevated' },
        { val: `${total.points} / ${max}`, lbl: 'Total points' },
      ],
      barsTitle: 'Where the Score Came From',
      bars: rows.map((row) => ({
        label: row.name,
        pct: Math.round(row.pct),
        caption: row.note,
      })),
      blocks: [
        ...rows.map((row) => ({
          title: `${row.name} — ${Math.round(row.pct)}%`,
          body: `${row.note} ${row.pct >= 50 ? row.high : row.low}`,
        })),
        {
          title: 'What this result is, and is not',
          body: 'This is one questionnaire, filled in by you, about yourself. ADHD assessment looks at how '
            + 'long the pattern has been there — usually back into childhood — whether it shows up in more '
            + 'than one area of your life, and whether it is actually causing impairment. Sleep debt, '
            + 'anxiety, depression, burnout and plain overwork all produce answers that look like this one.',
        },
        {
          title: 'If this resonated',
          body: 'Talk to a GP or psychiatrist and describe the pattern across your life rather than this '
            + 'score. If you recognise the inattentive half of this far more than the restless half, say so '
            + '— inattentive presentations are missed routinely, especially in adults who learned early to '
            + 'mask them. It is also worth ruling out sleep and thyroid issues first; a decent clinician '
            + 'will want to.',
        },
      ],
      note:
        'Points are assigned per statement (0–4) and shown as a share of the maximum. The "often or very '
        + 'often" count above is the figure the real screeners lean on, because frequency — not intensity — '
        + 'is what separates a trait from a problem.',
    };
  },
};
