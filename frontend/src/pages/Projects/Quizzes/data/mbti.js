/**
 * 16 Personality Types — a Myers-Briggs–style four-dichotomy quiz.
 *
 * Config shape (this file is the annotated reference for the others):
 *   scale  — answer labels ordered from "least agreement" to "most", so a
 *            higher index always means stronger agreement (quizEngine relies
 *            on that). The last index is the scale's maximum.
 *   items  — each statement carries `dim` (which dichotomy it feeds) and
 *            `key`: +1 when agreeing points at the FIRST letter of the
 *            dimension key ('E' in 'EI'), -1 when agreeing points at the
 *            second ('I'). Reverse-keyed items are what stop the quiz from
 *            being four questions asked seven ways.
 *   interpret(scores, responses) — returns the display object QuizPage
 *            renders (headline, bars, blocks, …); see QuizPage.jsx.
 *
 * Original wording throughout, and not affiliated with or derived from the
 * Myers-Briggs Type Indicator® instrument.
 */
import { quizBySlug } from '../meta';

const DICHOTOMIES = [
  {
    key: 'EI',
    first: 'E',
    second: 'I',
    firstLabel: 'Extraversion',
    secondLabel: 'Introversion',
    firstBlurb: 'You draw energy from other people and tend to work ideas out by talking them through.',
    secondBlurb: 'You recharge in quiet, and you prefer to think something through privately before you say it.',
  },
  {
    key: 'SN',
    first: 'S',
    second: 'N',
    firstLabel: 'Sensing',
    secondLabel: 'Intuition',
    firstBlurb: 'You trust concrete information and lived experience, and you notice the specifics other people skim past.',
    secondBlurb: 'You are drawn to patterns, possibilities and the connections between things that are not obviously related.',
  },
  {
    key: 'TF',
    first: 'T',
    second: 'F',
    firstLabel: 'Thinking',
    secondLabel: 'Feeling',
    firstBlurb: 'You decide by weighing logic and consistency, and you can separate an argument from the person making it.',
    secondBlurb: 'You decide by weighing impact and values, and you keep the human cost of a decision in view.',
  },
  {
    key: 'JP',
    first: 'J',
    second: 'P',
    firstLabel: 'Judging',
    secondLabel: 'Perceiving',
    firstBlurb: 'You like a settled plan, closed loops and decisions that stay decided.',
    secondBlurb: 'You like to keep your options open and adjust as things develop.',
  },
];

// One line per four-letter type, in my own words — no third-party type names.
const TYPES = {
  INTJ: { label: 'The Strategist', blurb: 'You build an internal model of how a system should work and then set about making reality match it. Independent by default, you would rather redesign a process than keep a bad one because it is familiar.' },
  INTP: { label: 'The Theorist', blurb: 'You are pulled toward the underlying logic of things and enjoy taking ideas apart to see how they fit together. You would rather understand a problem completely than solve it quickly.' },
  ENTJ: { label: 'The Director', blurb: 'You move naturally into the driving seat: set the objective, marshal the people, and keep pushing until it ships. You think in systems and leverage, and you have little patience for drift.' },
  ENTP: { label: 'The Provocateur', blurb: 'You generate options faster than most people can evaluate them, and you enjoy a good argument as a way of testing an idea. Routine is the thing most likely to bore you into looking elsewhere.' },
  INFJ: { label: 'The Counsellor', blurb: 'You read people and situations quickly, and you quietly hold a long-range view of how they could be better. You care deeply about meaning — and about a small number of people rather than a crowd.' },
  INFP: { label: 'The Idealist', blurb: 'You are guided by a strong internal sense of what matters, and you are at your best when your work is genuinely aligned with it. You notice the personal and particular where others see only categories.' },
  ENFJ: { label: 'The Mentor', blurb: 'You are drawn to bringing out the best in the people around you and keeping a group pointed at something worth doing. You feel the emotional temperature of a room almost the moment you walk in.' },
  ENFP: { label: 'The Catalyst', blurb: 'You bring energy, curiosity and enthusiasm to whatever has caught your imagination — and you are good at getting other people excited about it too. You need variety and freedom to stay engaged.' },
  ISTJ: { label: 'The Steward', blurb: 'You are reliable, thorough and quietly principled: if you say a thing will be done, it will be done, and done properly. You prefer proven methods and clearly defined responsibilities.' },
  ISFJ: { label: 'The Guardian', blurb: 'You pay close attention to the practical needs of the people you care about, often before they have noticed those needs themselves. You value stability, loyalty and getting the details right.' },
  ESTJ: { label: 'The Organiser', blurb: 'You like clear structures, defined roles and measurable progress, and you are comfortable making the call and holding people to it. You trust what has been tested in practice.' },
  ESFJ: { label: 'The Host', blurb: 'You are tuned into the people around you and work hard to make sure everyone is included, comfortable and looked after. You value tradition, harmony and knowing where you stand.' },
  ISTP: { label: 'The Tinkerer', blurb: 'You are a practical problem-solver who would rather take something apart than talk about it. You stay calm in a crisis and improvise well with whatever is actually in front of you.' },
  ISFP: { label: 'The Artisan', blurb: 'You have a strong aesthetic sense and a quiet, live-and-let-live streak. You respond to the specific moment and the concrete thing rather than to abstractions or long debates.' },
  ESTP: { label: 'The Operator', blurb: 'You are at your sharpest in the middle of the action, reading a situation in real time and acting on it. You prefer momentum and tangible results to theory and long meetings.' },
  ESFP: { label: 'The Performer', blurb: 'You bring warmth, spontaneity and energy into a room, and you are happiest when life is varied, social and happening now. You notice what people need in the moment.' },
};

const meta = quizBySlug('mbti');

export default {
  ...meta,
  // 7 statements per dichotomy, so these divide evenly (2 / 4 per dichotomy).
  lengths: {
    short: { label: 'Short', count: 8, blurb: '~2 min' },
    standard: { label: 'Standard', count: 16, blurb: '~5 min' },
    full: { label: 'Full', count: null, blurb: '~8 min' },
  },
  defaultLength: 'standard',
  seoTitle: '16 Personality Types Test (MBTI Style)',
  seoDescription:
    'A free 16-types personality quiz: 28 statements across four dichotomies — Extraversion/Introversion, Sensing/Intuition, Thinking/Feeling and Judging/Perceiving — with instant results.',
  intro:
    'Twenty-eight statements, four opposite pairs, and a four-letter type at the end. This is a '
    + 'Myers-Briggs–style questionnaire: it looks at where you direct your energy (E or I), how you take '
    + 'in information (S or N), how you decide (T or F), and how much structure you like (J or P).',
  pills: [
    { emoji: '⚡', label: 'Energy: E or I' },
    { emoji: '👁️', label: 'Information: S or N' },
    { emoji: '⚖️', label: 'Decisions: T or F' },
    { emoji: '🗂️', label: 'Structure: J or P' },
  ],
  hint:
    'Five-point agree/disagree scale, no time limit. Answer for how you usually are rather than how you '
    + 'would like to be — the pairs are only useful if the answers are honest.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. This is an original questionnaire inspired by the '
    + 'four-dichotomy idea — it is not the Myers-Briggs Type Indicator®, is not affiliated with its owners, '
    + 'and has not been validated as a psychometric instrument. Type labels describe tendencies, not limits.',

  items: [
    // ── Extraversion / Introversion ──
    { dim: 'EI', key: 1, text: 'After a busy day, I feel recharged by being around other people.' },
    { dim: 'EI', key: -1, text: 'I prefer to think something through on my own before I share it with a group.' },
    { dim: 'EI', key: 1, text: 'I often start conversations with people I have only just met.' },
    { dim: 'EI', key: -1, text: 'Large social gatherings leave me feeling drained rather than energised.' },
    { dim: 'EI', key: 1, text: 'I like having a wide circle of casual friends and acquaintances.' },
    { dim: 'EI', key: -1, text: 'I need quiet time alone before I feel like myself again.' },
    { dim: 'EI', key: 1, text: 'I would rather talk a problem through out loud than sit with it quietly.' },

    // ── Sensing / Intuition ──
    { dim: 'SN', key: 1, text: 'I notice details that other people tend to walk straight past.' },
    { dim: 'SN', key: -1, text: 'I often think about how things could be rather than how they currently are.' },
    { dim: 'SN', key: 1, text: 'I trust practical experience more than theories or abstract ideas.' },
    { dim: 'SN', key: -1, text: 'I enjoy thinking about the big picture more than about day-to-day facts.' },
    { dim: 'SN', key: 1, text: 'I prefer clear, step-by-step instructions to open-ended direction.' },
    { dim: 'SN', key: -1, text: 'I am drawn to metaphors and ideas that link unrelated things together.' },
    { dim: 'SN', key: 1, text: 'I notice when something in a familiar room has been moved or changed.' },

    // ── Thinking / Feeling ──
    { dim: 'TF', key: 1, text: 'When someone brings me a problem, I focus on solving it rather than on how they feel.' },
    { dim: 'TF', key: -1, text: 'I weigh how a decision will affect people before I judge whether it is right.' },
    { dim: 'TF', key: 1, text: 'I can disagree with an argument without worrying that it damages the relationship.' },
    { dim: 'TF', key: -1, text: 'I notice quickly when someone in the room is uncomfortable, even if they say nothing.' },
    { dim: 'TF', key: 1, text: 'I would rather be honest than tactful when the two pull in different directions.' },
    { dim: 'TF', key: -1, text: 'Keeping the harmony in a group matters to me more than winning the point.' },
    { dim: 'TF', key: 1, text: 'I decide by weighing the evidence rather than by trusting my read on the people involved.' },

    // ── Judging / Perceiving ──
    { dim: 'JP', key: 1, text: 'I like to have my day planned out well in advance.' },
    { dim: 'JP', key: -1, text: 'I would rather keep my options open than commit to a plan early.' },
    { dim: 'JP', key: 1, text: 'I feel uneasy when a task is left unfinished.' },
    { dim: 'JP', key: -1, text: 'I often start things late and rely on a burst of energy to finish them.' },
    { dim: 'JP', key: 1, text: 'I keep lists, and I enjoy crossing things off them.' },
    { dim: 'JP', key: -1, text: 'I am comfortable changing plans at the last minute.' },
    { dim: 'JP', key: 1, text: 'I prefer to finish one project before I start another.' },
  ],

  interpret(scores, responses) {
    const asked = DICHOTOMIES.map((d) => ({ d, pct: scores[d.key]?.pct ?? 50 }));
    const code = asked.map(({ d, pct }) => (pct >= 50 ? d.first : d.second)).join('');
    const type = TYPES[code] || { label: '', blurb: '' };

    // The dichotomy where the answers were least ambiguous — a useful thing to
    // report, because it says which letter to trust most.
    const clearest = asked
      .map(({ d, pct }) => ({ d, share: Math.max(pct, 100 - pct) }))
      .sort((a, b) => b.share - a.share)[0];

    return {
      headline: code,
      headlineSub: type.label,
      summary: type.blurb,
      stats: [
        { val: String(responses.length), lbl: 'Statements' },
        { val: `${Math.round(clearest.share)}%`, lbl: `Clearest: ${clearest.d.first} / ${clearest.d.second}` },
      ],
      barsTitle: 'Your Four Preferences',
      bars: asked.map(({ d, pct }) => ({
        label: `${d.first} / ${d.second}`,
        pct: Math.round(pct),
        caption: `Leans ${pct >= 50 ? d.firstLabel : d.secondLabel}`,
      })),
      blocks: asked.map(({ d, pct }) => {
        const share = Math.round(Math.max(pct, 100 - pct));
        const leansFirst = pct >= 50;
        const close = share < 60;
        return {
          title: `${d.firstLabel} ↔ ${d.secondLabel}`,
          body: `${leansFirst ? d.firstLabel : d.secondLabel} — ${share}% of your answers leaned that way. `
            + `${leansFirst ? d.firstBlurb : d.secondBlurb}`
            + (close
              ? ' Your answers here sat close to the middle, so treat this letter as a lean rather than a rule.'
              : ''),
        };
      }),
      note:
        'Each of the four letters comes from comparing opposite poles, not from a yes/no question: a 60/40 '
        + 'split and a 95/5 split produce the same letter but mean very different things, which is why the '
        + 'percentages above matter more than the four-letter code itself.',
    };
  },
};
