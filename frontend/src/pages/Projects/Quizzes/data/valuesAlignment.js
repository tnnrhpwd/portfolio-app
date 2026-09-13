/**
 * Values & Future Vision Alignment — 18 statements, answered by both partners
 * and then compared (`mode: 'compare'`).
 *
 * Every item is forward-keyed: these are not right/wrong questions with a
 * "correct" pole, they are positions on a spectrum, so agreement level IS the
 * position. Similarity is therefore just how close the two agreement levels
 * are — see `compareResponses` in quizEngine.js.
 *
 * Each item carries a `discuss` prompt, which the gaps list attaches to the
 * biggest differences. That is the actual product of this quiz: not a
 * compatibility number, but a short list of conversations worth having.
 */
import { quizBySlug } from '../meta';
import { bandFor } from '../quizEngine';

const AREAS = [
  { key: 'family', name: 'Family & Children', blurb: 'Children, extended family, and what matters in raising one.' },
  { key: 'money', name: 'Money', blurb: 'Saving, spending, debt, and whether money is shared.' },
  { key: 'lifestyle', name: 'Day-to-Day Life', blurb: 'Where you live, how weekends go, tidiness, travel.' },
  { key: 'ambition', name: 'Work & Ambition', blurb: 'Career, hours, income, and what you trade for them.' },
  { key: 'connection', name: 'Closeness & Conflict', blurb: 'Time together, time apart, and how disagreements get handled.' },
];

const BANDS = [
  {
    min: 0,
    max: 39,
    label: 'Very different outlooks',
    body: 'You landed far apart on a lot of these. That is worth knowing rather than worrying about: '
      + 'couples who agree on everything are usually couples who have not compared notes yet. The number '
      + 'that matters is not this one, it is how many of the differences below you have actually talked '
      + 'about out loud.',
  },
  {
    min: 40,
    max: 59,
    label: 'More differences than similarities',
    body: 'You agree on some things and diverge on plenty. In practice that usually means your day-to-day '
      + 'life works, and the bigger questions have not been settled between you yet. Read the list below as '
      + 'an agenda rather than a verdict.',
  },
  {
    min: 60,
    max: 79,
    label: 'Broadly aligned',
    body: 'You are pointed in roughly the same direction on most of this, with real differences in a few '
      + 'places. That is the ordinary shape of a couple who have talked about the future — the specific '
      + 'gaps below are the useful part.',
  },
  {
    min: 80,
    max: 100,
    label: 'Closely aligned',
    body: 'You answered these very similarly. Two caveats worth holding on to: it is easy to align on '
      + 'questions you have not had to act on yet, and the items you both answered "neutral" are not '
      + 'agreements, they are unopened questions.',
  },
];

const meta = quizBySlug('values-alignment');

export default {
  ...meta,
  mode: 'compare',
  seoTitle: 'Values & Future Vision Alignment Quiz for Couples',
  seoDescription:
    'A free couples quiz: both partners answer 18 statements about family, money, lifestyle, ambition and closeness, then see exactly where you align and where you differ — with prompts for the gaps.',
  intro:
    'You each answer the same eighteen statements about how you want your life to go, then see the two '
    + 'sets of answers side by side. It is not a compatibility score. Its only real job is to surface the '
    + 'conversations you have been putting off — children, money, where you live, how much of your lives '
    + 'stays separate.',
  pills: [
    { emoji: '👥', label: 'Both answer privately' },
    { emoji: '📊', label: 'Alignment by area' },
    { emoji: '💬', label: 'Prompts for the gaps' },
    { emoji: '🚫', label: 'Nothing saved' },
  ],
  hint:
    '18 statements, five-point agree/disagree scale, answered one partner at a time. Use the middle option '
    + 'when you genuinely have no view — a "neutral" from both of you is not agreement, and this quiz will '
    + 'tell you when it happens. Answer for what you actually want, not for what you think is expected.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. There is no research behind this questionnaire and it is '
    + 'not a compatibility test — agreement percentages do not predict whether a relationship works, and '
    + 'plenty of durable couples disagree in most of these areas. It is a structured way in to a '
    + 'conversation, which is all it should be used for. Answers are not saved to either account.',

  items: [
    // ── Family & Children ──
    {
      dim: 'family',
      key: 1,
      text: 'Having children is something I definitely want.',
      discuss: 'Ask what the next five years looks like if you do, and if you do not. The second version is the one people skip.',
    },
    {
      dim: 'family',
      key: 1,
      text: 'Living close to my extended family matters to me.',
      discuss: 'Pin down what "close" means — same street, same city, or a flight away — and how often you would each want to visit.',
    },
    {
      dim: 'family',
      key: 1,
      text: 'How any children are raised matters more to me than almost any other decision.',
      discuss: 'Name the two or three things you each feel strongest about, and compare those before you compare anything else.',
    },

    // ── Money ──
    {
      dim: 'money',
      key: 1,
      text: 'I would rather save for security than spend on things I could enjoy now.',
      discuss: 'Try naming a savings figure and a fun-money figure you could both live with, and see how far apart the two numbers are.',
    },
    {
      dim: 'money',
      key: 1,
      text: 'I am comfortable carrying debt for something worth having.',
      discuss: 'Ask what each of you would borrow for — a home, a car, a course, a trip — and what you would never borrow for.',
    },
    {
      dim: 'money',
      key: 1,
      text: 'Money between partners should be completely shared rather than partly kept separate.',
      discuss: 'There is no wrong answer, but "all shared", "all separate" and "mostly shared with personal pots" feel very different to live inside.',
    },

    // ── Day-to-Day Life ──
    {
      dim: 'lifestyle',
      key: 1,
      text: 'I would rather live somewhere quiet than somewhere with more going on.',
      discuss: 'Describe the place each of you pictures in ten years, and what you would miss from the other one.',
    },
    {
      dim: 'lifestyle',
      key: 1,
      text: 'Travel is something I want to keep making room for, money permitting.',
      discuss: 'Agree roughly how often you each want to go somewhere, and whether it is a real priority or a nice-to-have.',
    },
    {
      dim: 'lifestyle',
      key: 1,
      text: 'Our weekends should mostly be spent doing things together.',
      discuss: 'Compare an ideal Saturday, hour by hour. This disagreement is usually about how much separate time feels normal, not about the weekend.',
    },
    {
      dim: 'lifestyle',
      key: 1,
      text: 'Keeping a tidy, organised home matters to me.',
      discuss: 'Talk about the actual standard rather than the principle — how tidy, how often, and who does it when.',
    },

    // ── Work & Ambition ──
    {
      dim: 'ambition',
      key: 1,
      text: 'I want to keep pushing my career even if it costs us time together.',
      discuss: 'Ask what each of you is willing to trade over the next few years, and for how long you would trade it.',
    },
    {
      dim: 'ambition',
      key: 1,
      text: 'My work is a big part of who I am.',
      discuss: 'Talk about what you would each do if money stopped mattering. The answer usually says more than the job title does.',
    },
    {
      dim: 'ambition',
      key: 1,
      text: 'I would trade some income for more free time.',
      discuss: 'Compare the trade you would each actually make — in hours or in money — rather than the one you would make in principle.',
    },
    {
      dim: 'ambition',
      key: 1,
      text: 'I would support a partner moving or changing career, even if it disrupted my own plans.',
      discuss: 'Answer this one with a specific scenario rather than in the abstract. It is easy to agree with the principle.',
    },

    // ── Closeness & Conflict ──
    {
      dim: 'connection',
      key: 1,
      text: 'We should talk about a disagreement the same day rather than let it sit.',
      discuss: 'Ask how long each of you needs before a difficult conversation is actually useful. It is usually different, and neither number is wrong.',
    },
    {
      dim: 'connection',
      key: 1,
      text: 'It is healthy for partners to have separate lives and separate friends.',
      discuss: 'Compare how much time apart feels right. This number varies a lot between people and is rarely discussed directly.',
    },
    {
      dim: 'connection',
      key: 1,
      text: 'I need regular, unhurried time together to feel connected.',
      discuss: 'Agree what "regular" means and put something in a calendar, rather than leaving it to whoever asks first.',
    },
    {
      dim: 'connection',
      key: 1,
      text: 'Big decisions should be made together, even when one of us feels strongly.',
      discuss: 'Talk about which decisions each of you would want a veto on, if any. The answer is usually narrower than people expect.',
    },
  ],

  // The areas are declared once, above, and drive both the bars and the labels
  // the comparison groups by.
  areas: AREAS,

  formatComparison(comparison, ctx) {
    const { overallPct, byDim, items } = comparison;
    const band = bandFor(overallPct, BANDS);
    const rounded = Math.round(overallPct);

    // Answering nothing is reachable (both partners can skip every statement),
    // and "0% aligned" would be a lie — they have not disagreed, they have not
    // answered. Say so instead of scoring it.
    if (items.length === 0) {
      return {
        headline: 'No answers',
        headlineSub: 'Nothing to compare yet',
        summary: 'You skipped every statement between you, so there is nothing to compare. Go back and '
          + 'work through at least a few — the ones you are unsure about are usually the ones worth '
          + 'answering, because those are the ones you have not discussed.',
        stats: [
          { val: '0', lbl: 'Statements compared' },
          { val: String(AREAS.length), lbl: 'Areas untouched' },
        ],
        barsTitle: 'Alignment by Area',
        bars: AREAS.map((area) => ({
          label: area.name,
          pct: 0,
          caption: area.blurb,
          note: 'Not answered',
        })),
        gapsTitle: 'Where You Differ Most',
        gaps: [],
        blocks: [{
          title: 'Nothing to compare',
          body: 'A comparison needs both sets of answers, so this result is empty rather than bad. The '
            + 'statements are short and there are no wrong answers — the only way to get anything out of '
            + 'this is to answer them honestly, including the ones where the honest answer is "I am not '
            + 'sure".',
        }],
        note: 'Nothing was scored, because nothing was answered.',
      };
    }

    const rows = AREAS.map((area) => ({
      ...area, pct: byDim[area.key].pct,
    }));

    // "Neutral" from both people is an unopened question, not agreement, so it
    // is counted separately rather than being folded into the score.
    const undecided = items.filter(
      (item) => Math.abs(item.leanA - 0.5) < 0.01 && Math.abs(item.leanB - 0.5) < 0.01,
    ).length;

    const gaps = items
      .filter((item) => item.gap >= 0.25)
      .sort((x, y) => y.gap - x.gap)
      .slice(0, 6);

    return {
      headline: `${rounded}%`,
      headlineSub: band?.label || 'Alignment',
      summary: band?.body || '',
      stats: [
        { val: `${rounded}%`, lbl: 'Overall alignment' },
        { val: String(items.length), lbl: 'Statements compared' },
        { val: String(undecided), lbl: 'Answered neutral by both' },
      ],
      barsTitle: 'Alignment by Area',
      bars: rows.map((row) => {
        const pct = Math.round(row.pct);
        return {
          label: row.name,
          pct,
          caption: row.blurb,
          note: pct >= 75 ? 'Largely aligned' : pct >= 50 ? 'Partly aligned' : 'Well apart',
        };
      }),
      gapsTitle: 'Where You Differ Most',
      gaps: gaps.map((gap) => ({
        text: gap.text,
        aLabel: ctx.scale[gap.aValue] || 'Skipped',
        bLabel: ctx.scale[gap.bValue] || 'Skipped',
        prompt: gap.discuss,
      })),
      blocks: [
        ...(gaps.length === 0
          ? [{
            title: 'Nothing stands out as a clash',
            body: 'You did not answer any of these far enough apart to be flagged. That is a good sign, with '
              + 'one caveat: it can also mean you have not yet had to make a real decision in these areas. '
              + 'The questions are usually most useful the moment one of them becomes an actual choice.',
          }]
          : [{
            title: 'How to use the list above',
            body: `Take them one at a time and in the order given, which puts the widest gaps first. Do not `
              + 'try to solve any of them tonight — the goal of this first pass is only to find out where you '
              + 'actually differ, which is often not where either of you assumed. Some of the prompts may '
              + 'surface that the difference is smaller than the score suggests, because a "Strongly agree" '
              + 'and an "Agree" are close positions even when they look far apart in a bar chart.',
          }]),
        ...(undecided >= 3
          ? [{
            title: `${undecided} statements got "neutral" from both of you`,
            body: 'Those are unopened questions rather than points of agreement — the score above counts '
              + 'them as aligned, because you are not in conflict about them, but neither of you has actually '
              + 'decided. They are worth more of your attention than the small gaps, not less.',
          }]
          : []),
        {
          title: 'What this number is not',
          body: 'It is not a compatibility score, and a lower one does not mean a worse relationship. Some '
            + 'of the most durable couples disagree in most of these areas and simply have a working '
            + 'arrangement; some of the most fragile ones agreed about everything on paper and had never '
            + 'tested any of it. What actually predicts trouble is not the size of a difference, it is '
            + 'whether the two of you can talk about it without one person being punished for their answer.',
        },
      ],
      note:
        'Alignment is measured as how close your two answers were on each statement, averaged. A "Strongly '
        + 'agree" and an "Agree" score as a small difference; the two opposite ends score as none at all. '
        + 'Statements either of you skipped are left out of the average entirely.',
    };
  },
};
