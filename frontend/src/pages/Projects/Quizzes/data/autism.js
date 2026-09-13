/**
 * Autism Spectrum Screening — 24 statements across four areas, in the style
 * of the brief self-report questionnaires (AQ / RAADS-R) that clinicians use
 * as a starting point rather than an answer.
 *
 * Scored with the 4-point "definitely disagree → definitely agree" scale the
 * real instruments use, so each item carries 0–3 points and the total is
 * reported both as points and as a share of the maximum.
 *
 * This is NOT the AQ, NOT the RAADS-R, and NOT a diagnostic tool. The item
 * wording is original; only the shape of the instrument is borrowed. That
 * distinction is stated on the page in the disclaimer and result note, and it
 * matters — a screening score is a reason to look into something, never a
 * conclusion about yourself.
 */
import { quizBySlug } from '../meta';
import { bandFor, traitRows } from '../quizEngine';

const AREAS = [
  {
    key: 'social',
    name: 'Social Interaction',
    note: 'Effort, energy and instinct in live social situations.',
    high: 'Social situations take deliberate effort: you are often working out the rules in real time rather than reading them automatically. That effort is why a busy day can be so flattening, and why one-to-one conversation is usually much easier than a group.',
    low: 'Reading a room and settling into a conversation is mostly automatic for you. Social situations still cost energy, but they do not require a running manual.',
  },
  {
    key: 'communication',
    name: 'Communication',
    note: 'Literal reading, tone, and knowing when it is your turn.',
    high: 'You tend toward the literal, and implication, sarcasm or figures of speech can need a second pass. Your own meaning also sometimes lands differently from how you intended it — which is why writing things down often works better than saying them.',
    low: 'You pick up implied meaning and tone without much conscious processing, and you adjust how you phrase things to fit who you are talking to.',
  },
  {
    key: 'flexibility',
    name: 'Flexibility & Change',
    note: 'Routines, expectations, and last-minute change.',
    high: 'Knowing what to expect makes a real difference to how comfortable you are, and a plan changed at short notice costs you more than it appears to cost the people around you. Routines are load-bearing rather than merely preferred.',
    low: 'You shift with a change of plan fairly easily, and you generally find an unexpected turn interesting rather than unsettling.',
  },
  {
    key: 'detail',
    name: 'Attention to Detail',
    note: 'Patterns, systems, and precision.',
    high: 'You register patterns, inconsistencies and small errors that pass most people by, and you like to understand how a system is put together. Precision is satisfying rather than fussy.',
    low: 'You work comfortably at a level of approximation, and you are happy to trade exactness for pace when the situation calls for it.',
  },
];

const BANDS = [
  { min: 0, max: 24, label: 'Few indications', body: 'Your answers gave little signal in the areas this questionnaire looks at. That is not proof of anything either way — self-report is a blunt instrument, and it misses as much as it finds.' },
  { min: 25, max: 44, label: 'Some indications', body: 'You endorsed some of these traits. Most people endorse a few — the useful question is whether the ones you endorsed describe something that is costing you, or just something that is true of you.' },
  { min: 45, max: 64, label: 'Moderate indications', body: 'A fair number of these statements resonated. That is worth taking seriously enough to read about, and probably enough to be worth mentioning to a doctor or a psychologist if these things have been a theme across your life rather than this month.' },
  { min: 65, max: 100, label: 'Many indications', body: 'You endorsed a large share of these statements. Screening questionnaires at this level are usually described as a signal to seek a proper assessment, not as an answer in themselves. If this is a long-standing pattern rather than a recent change, it is worth talking to a GP or clinical psychologist — you can bring these results with you, but what you will be offered is a real assessment, not this.' },
];

const meta = quizBySlug('autism');

export default {
  ...meta,
  seoTitle: 'Autism Spectrum Screening (AQ / RAADS-R Style)',
  seoDescription:
    'A free 24-statement autism spectrum screening questionnaire across social interaction, communication, flexibility and attention to detail — with instant, clearly non-diagnostic results.',
  intro:
    'This is a screening questionnaire, not a diagnosis. It asks 24 statements across four areas that '
    + 'autism-focused instruments like the AQ and RAADS-R look at: social interaction, communication, '
    + 'flexibility and change, and attention to detail. It is written for adults and it works best if you '
    + 'answer for how you have always been, not how you feel this week.',
  pills: [
    { emoji: '👥', label: 'Social interaction' },
    { emoji: '💬', label: 'Communication' },
    { emoji: '🔁', label: 'Flexibility & change' },
    { emoji: '🔍', label: 'Attention to detail' },
  ],
  hint:
    '24 statements, four-point disagree/agree scale, no skip and no time limit. Answer for your whole life, '
    + 'not just the last fortnight — a screening score is only as useful as the timescale behind it.',
  scale: ['Definitely disagree', 'Slightly disagree', 'Slightly agree', 'Definitely agree'],
  allowSkip: false,
  disclaimer:
    'Not a diagnosis. This is an original questionnaire inspired by screening tools such as the AQ and '
    + 'RAADS-R — it is not those instruments, and no self-report questionnaire can diagnose autism. '
    + 'Autism is identified by a qualified clinician, usually through a developmental history and direct '
    + 'assessment. If these questions resonate, treat that as a reason to look into it properly, not as a '
    + 'result. Reputable national autism organisations publish free information about assessment pathways.',

  items: [
    // ── Social interaction ──
    { dim: 'social', key: 1, text: 'I find small talk with strangers genuinely difficult, even when I want to make a connection.' },
    { dim: 'social', key: 1, text: 'I have to think consciously about what to do with my face and body in a conversation.' },
    { dim: 'social', key: 1, text: 'Groups exhaust me in a way that one-to-one conversation does not.' },
    { dim: 'social', key: 1, text: 'I rehearse conversations ahead of time so that I am not caught out.' },
    { dim: 'social', key: -1, text: 'I find it easy to tell what someone is feeling from their face and their tone.' },
    { dim: 'social', key: -1, text: 'I enjoy spontaneous, unstructured social time with a group of people.' },

    // ── Communication ──
    { dim: 'communication', key: 1, text: 'I take what people say literally, and sarcasm catches me out.' },
    { dim: 'communication', key: 1, text: 'Idioms and figures of speech sometimes leave me working out what was actually meant.' },
    { dim: 'communication', key: 1, text: 'I have been told my tone comes across as blunt when I did not mean it that way.' },
    { dim: 'communication', key: 1, text: 'I struggle to know when it is my turn to speak in a conversation.' },
    { dim: 'communication', key: -1, text: 'I naturally match the way I speak to whoever I am talking to.' },
    { dim: 'communication', key: -1, text: 'I find it easy to explain my thoughts out loud as I go.' },

    // ── Flexibility & change ──
    { dim: 'flexibility', key: 1, text: 'Last-minute changes to a plan unsettle me more than they seem to unsettle other people.' },
    { dim: 'flexibility', key: 1, text: 'I like to know exactly what to expect before I go somewhere new.' },
    { dim: 'flexibility', key: 1, text: 'I keep to routines, and I am thrown when they are disrupted.' },
    { dim: 'flexibility', key: 1, text: 'I would rather do something the same way each time, if that way works.' },
    { dim: 'flexibility', key: -1, text: 'I adapt easily when a plan changes at the last minute.' },
    { dim: 'flexibility', key: -1, text: 'I enjoy it when a day turns out differently from how I expected.' },

    // ── Attention to detail ──
    { dim: 'detail', key: 1, text: 'I notice patterns, details or errors that other people miss.' },
    { dim: 'detail', key: 1, text: 'I am drawn to systems, categories or collections, and I like to know how they are organised.' },
    { dim: 'detail', key: 1, text: 'I remember facts and figures long after the conversation they came from.' },
    { dim: 'detail', key: 1, text: 'I would rather get something exactly right than approximately done.' },
    { dim: 'detail', key: -1, text: 'I can give a quick, rough answer when that is what a social situation calls for.' },
    { dim: 'detail', key: -1, text: 'I find it easy to move on to the next thing before the last one is finished.' },
  ],

  interpret(scores, responses) {
    // Every subscale is forward- or reverse-keyed the same way, so the total is
    // simply the sum across them.
    const total = Object.values(scores).reduce(
      (acc, bucket) => ({ points: acc.points + bucket.points, pointsMax: acc.pointsMax + bucket.pointsMax }),
      { points: 0, pointsMax: 0 }
    );

    // Per-item points, so "how many statements did you actually endorse" can be
    // reported alongside the total. A null answer scores nothing.
    const itemPoints = responses.map((r) => {
      if (r.value === null || r.value === undefined) return 0;
      return r.key >= 0 ? r.value : 3 - r.value;
    });
    const endorsed = itemPoints.filter((p) => p >= 2).length;
    const strong = itemPoints.filter((p) => p === 3).length;

    const max = total.pointsMax || 1;
    const pct = Math.round((total.points / max) * 100);
    const band = bandFor(pct, BANDS);
    const rows = traitRows(scores, AREAS);

    return {
      headline: String(total.points),
      headlineSub: `${band?.label || 'Result'} — ${pct}% of the maximum ${max} points`,
      summary: band?.body || '',
      stats: [
        { val: `${total.points} / ${max}`, lbl: 'Total points' },
        { val: `${endorsed} / ${responses.length}`, lbl: 'Statements endorsed' },
        { val: String(strong), lbl: 'Strongly agreed' },
      ],
      barsTitle: 'Where the Score Came From',
      bars: rows.map((row) => ({
        label: row.name,
        pct: Math.round(row.pct),
        caption: row.note,
      })),
      blocks: [
        ...rows.map((row) => ({
          title: row.name,
          body: row.pct >= 50 ? row.high : row.low,
        })),
        {
          title: 'What this result is, and is not',
          body: 'This is one questionnaire, filled in by you, about yourself. Real assessment looks at your '
            + 'history from childhood onward, often includes someone who knew you as a child, and is done by '
            + 'a clinician who can tell the difference between autism and the many other things that look '
            + 'like it — social anxiety, ADHD, trauma, and simply being an introverted person in an '
            + 'extroverted culture all overlap with these questions.',
        },
        {
          title: 'If this resonated',
          body: 'Bring it up with a GP or a clinical psychologist, and describe the pattern across your life '
            + 'rather than this questionnaire. You can mention that you took a screening quiz and what it '
            + 'flagged, but a real assessment is a conversation, not a score. If what you recognise here is '
            + 'mostly exhaustion from masking all day, that is worth raising too — it is often the part that '
            + 'there is actual help for.',
        },
      ],
      note:
        'Points are assigned per statement (0–3) with reverse-worded statements flipped, then shown as a '
        + 'share of the maximum. Two people can reach the same total with very different profiles, which is '
        + 'why the four bars above are worth reading before the headline number.',
    };
  },
};
