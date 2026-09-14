/**
 * Enneagram — 36 statements, four per type, scoring all nine types at once.
 *
 * Presented as a scored questionnaire rather than the usual forced-choice
 * pairing, so you get a full nine-bar profile and can see how close your
 * second type is to your first (the "wing").
 *
 * Original wording; the nine type names are ordinary descriptive phrases and
 * the descriptions are written for this page.
 */
import { quizBySlug } from '../meta';
import { topKeys, traitRows } from '../quizEngine';

const TYPES = [
  {
    key: 'T1',
    name: 'The Reformer',
    short: 'Reformer',
    note: 'Principled, self-controlled, improvement-minded.',
    body: 'You run on a sense that things can and should be done properly. You spot the gap between how something is and how it ought to be almost automatically, and you hold yourself to standards you would never demand of anyone else. The cost is a background hum of irritation and self-criticism when reality falls short — including your own.',
  },
  {
    key: 'T2',
    name: 'The Helper',
    short: 'Helper',
    note: 'Warm, attentive, driven to be needed.',
    body: 'You read what other people need quickly, often before they have worked it out themselves, and you move toward it. Being needed feels like being valuable, which makes it genuinely hard to ask for anything back. The work is noticing when giving has quietly turned into earning your place.',
  },
  {
    key: 'T3',
    name: 'The Achiever',
    short: 'Achiever',
    note: 'Goal-driven, adaptable, image-aware.',
    body: 'You are wired to succeed at whatever the situation rewards, and you change your presentation to fit the room without really deciding to. Momentum feels like safety. The thing that is easy to lose is the difference between what you actually want and what would look like winning.',
  },
  {
    key: 'T4',
    name: 'The Individualist',
    short: 'Individualist',
    note: 'Introspective, expressive, drawn to the particular.',
    body: 'You are tuned to what is missing, to what is uniquely yours, and to the emotional truth of a situation. That gives you real depth and a strong creative signal. It also means you can read a passing mood as a permanent fact about yourself.',
  },
  {
    key: 'T5',
    name: 'The Investigator',
    short: 'Investigator',
    note: 'Observant, private, knowledge-seeking.',
    body: 'You gather understanding before you commit, and you keep a reserve of time, energy and opinion that other people do not automatically get access to. Competence is how you feel safe. The risk is that preparation becomes a place to live rather than a step before acting.',
  },
  {
    key: 'T6',
    name: 'The Loyalist',
    short: 'Loyalist',
    note: 'Vigilant, committed, loyal to trusted people.',
    body: 'You scan for what could go wrong, and you want to know where someone stands before you relax around them. Once you commit, you commit hard — to people, to groups, to principles. The tension is between a real talent for spotting risk and a habit of running the same worries on repeat.',
  },
  {
    key: 'T7',
    name: 'The Enthusiast',
    short: 'Enthusiast',
    note: 'Curious, optimistic, keeps options open.',
    body: 'You keep a running list of things worth doing, and you are genuinely good at reframing difficulty into something more interesting. Options feel like freedom, and closing one down feels like loss. Staying with one good thing long enough to get the depth out of it is the practice.',
  },
  {
    key: 'T8',
    name: 'The Challenger',
    short: 'Challenger',
    note: 'Direct, protective, takes charge.',
    body: 'You move toward conflict rather than away from it, and you would rather be told something bluntly than managed gently. You protect the people inside your circle fiercely. What is hard is letting anyone see the part of you that is not in control.',
  },
  {
    key: 'T9',
    name: 'The Peacemaker',
    short: 'Peacemaker',
    note: 'Easy-going, accommodating, sees all sides.',
    body: 'You can see most sides of an argument, which makes you genuinely good at holding a group together and genuinely bad at knowing what you want. Conflict is expensive, so it tends to get deferred. Your own preferences are the thing most likely to go missing.',
  },
];

const meta = quizBySlug('enneagram');

export default {
  ...meta,
  // 4 statements per type, so these divide evenly (2 / 3 per type).
  lengths: {
    short: { label: 'Short', count: 18, blurb: '~5 min' },
    standard: { label: 'Standard', count: 27, blurb: '~7 min' },
    full: { label: 'Full', count: null, blurb: '~9 min' },
  },
  defaultLength: 'standard',
  seoTitle: 'Enneagram Test — Find Your Type',
  seoDescription:
    'A free Enneagram test: 36 statements scored across all nine types, with your core type, your wing, and a full nine-bar profile.',
  intro:
    'Most Enneagram tests force you to choose between two statements at a time. This one asks you to rate '
    + '36 statements instead, scores all nine types at once, and shows you the full profile — including how '
    + 'close your second type sits to your first.',
  pills: [
    { emoji: '🎯', label: 'Core type' },
    { emoji: '🪽', label: 'Wing / second type' },
    { emoji: '📊', label: 'Full nine-bar profile' },
  ],
  hint:
    'Five-point agree/disagree scale, no time limit. Types that share a centre (2-3-4, 5-6-7, 8-9-1) tend '
    + 'to score near each other, so expect a few bars to be close.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. The Enneagram is not a validated psychometric instrument, '
    + 'and this is an original questionnaire rather than a copy of any published test. Use it as a prompt for '
    + 'reflection, not as a diagnosis or a fixed identity.',

  items: [
    // ── Type 1 — Reformer ──
    { dim: 'T1', key: 1, text: 'I notice small errors and imperfections that other people walk straight past.' },
    { dim: 'T1', key: 1, text: 'I hold myself to standards I would never demand of anyone else.' },
    { dim: 'T1', key: 1, text: 'I feel a quiet irritation when something is done sloppily.' },
    { dim: 'T1', key: 1, text: 'Doing the right thing matters more to me than being liked.' },

    // ── Type 2 — Helper ──
    { dim: 'T2', key: 1, text: 'I can usually tell what someone needs before they ask for it.' },
    { dim: 'T2', key: 1, text: 'I feel most valuable when I am looking after someone else.' },
    { dim: 'T2', key: 1, text: 'It is hard for me to ask for help, even when I need it.' },
    { dim: 'T2', key: 1, text: 'I sometimes give more than I can afford to, then feel quietly resentful.' },

    // ── Type 3 — Achiever ──
    { dim: 'T3', key: 1, text: 'I measure myself by what I have accomplished.' },
    { dim: 'T3', key: 1, text: 'I adapt how I come across to suit whatever a situation rewards.' },
    { dim: 'T3', key: 1, text: 'I would rather be effective than perfect.' },
    { dim: 'T3', key: 1, text: 'Slowing down feels uncomfortably like falling behind.' },

    // ── Type 4 — Individualist ──
    { dim: 'T4', key: 1, text: 'I feel different from most people, and I am not sure I would want to be like them.' },
    { dim: 'T4', key: 1, text: 'My moods move me more than my plans do.' },
    { dim: 'T4', key: 1, text: 'I am drawn to things that are beautiful, melancholy or deeply personal.' },
    { dim: 'T4', key: 1, text: 'I sometimes worry that something essential is missing from my life.' },

    // ── Type 5 — Investigator ──
    { dim: 'T5', key: 1, text: 'I need a lot of time alone to think before I feel ready to act.' },
    { dim: 'T5', key: 1, text: 'I would rather understand one subject deeply than know a little about many.' },
    { dim: 'T5', key: 1, text: 'I keep parts of myself — my time, my opinions, my resources — in reserve.' },
    { dim: 'T5', key: 1, text: 'Being caught unprepared is one of my least favourite feelings.' },

    // ── Type 6 — Loyalist ──
    { dim: 'T6', key: 1, text: 'I scan for what could go wrong long before it actually does.' },
    { dim: 'T6', key: 1, text: 'I want to know where someone stands before I trust them.' },
    { dim: 'T6', key: 1, text: 'I stay loyal to the people and groups I have committed to, sometimes past the point of sense.' },
    { dim: 'T6', key: 1, text: 'I second-guess decisions even after I have made them.' },

    // ── Type 7 — Enthusiast ──
    { dim: 'T7', key: 1, text: 'I keep a running list of things I want to try next.' },
    { dim: 'T7', key: 1, text: 'I would rather keep my options open than commit to one path.' },
    { dim: 'T7', key: 1, text: 'I can talk myself out of something painful by finding something more interesting to do.' },
    { dim: 'T7', key: 1, text: 'Boredom bothers me more than being busy does.' },

    // ── Type 8 — Challenger ──
    { dim: 'T8', key: 1, text: 'I would rather be told the truth bluntly than managed gently.' },
    { dim: 'T8', key: 1, text: 'I step forward and take charge when nobody else will.' },
    { dim: 'T8', key: 1, text: 'I find it hard to show weakness, even to people I am close to.' },
    { dim: 'T8', key: 1, text: 'Injustice makes me want to act, not deliberate.' },

    // ── Type 9 — Peacemaker ──
    { dim: 'T9', key: 1, text: 'I can see most sides of an argument, which can make it hard to pick one.' },
    { dim: 'T9', key: 1, text: 'I would rather keep the peace than win the point.' },
    { dim: 'T9', key: 1, text: 'I put off things that are likely to create conflict.' },
    { dim: 'T9', key: 1, text: 'I sometimes lose track of what I actually want.' },
  ],

  interpret(scores) {
    const rows = traitRows(scores, TYPES);
    const ranked = topKeys(scores, 3, TYPES.map((t) => t.key));
    const coreKey = ranked[0];
    const wingKey = ranked[1];
    const core = TYPES.find((t) => t.key === coreKey) || TYPES[0];
    const wing = TYPES.find((t) => t.key === wingKey);
    const coreScore = coreKey ? scores[coreKey] : null;
    const gap = wingKey && coreKey ? coreScore.points - scores[wingKey].points : 0;
    const closeWing = gap <= 1;

    return {
      headline: `Type ${core.key.replace('T', '')}`,
      headlineSub: core.name,
      summary: `${core.body.split('. ')[0]}. ${
        wing && closeWing
          ? `Your ${wing.name.replace('The ', '').toLowerCase()} scores sit almost as high, so you may recognise a good deal of that type too.`
          : wing
            ? `${wing.name} came second — worth reading as a wing rather than a second identity.`
            : ''
      }`.trim(),
      stats: [
        { val: `${Math.round(coreScore?.pct ?? 0)}%`, lbl: 'Core type match' },
        ...(wing ? [{ val: `${Math.round(scores[wingKey].pct)}%`, lbl: wing.short }] : []),
      ],
      barsTitle: 'All Nine Types',
      bars: rows.map((row) => ({
        label: row.short,
        pct: Math.round(row.pct),
        caption: row.name,
        note: row.key === coreKey ? 'your core type' : row.key === wingKey ? 'your wing' : undefined,
      })),
      blocks: [
        {
          title: `${core.name} — ${core.note}`,
          body: core.body,
        },
        ...(wing && closeWing
          ? [{
            title: `A close second: ${wing.name}`,
            body: `${wing.note} When two types score within a point of each other, read both descriptions `
              + 'and decide which one explains more of your actual behaviour under stress — that is usually '
              + `the real core. ${wing.body}`,
          }]
          : []),
        {
          title: 'How to read this',
          body: 'The useful question is not "which type am I" but "which of these descriptions explains '
            + 'what I do when I am not at my best". A type you recognise in that light is more informative '
            + 'than one that merely sounds flattering.',
        },
      ],
      note:
        'Each bar is the share of agreement you gave that type across its four statements, so a type with '
        + 'one enthusiastic answer can outrank a type you feel consistently moderate about. Weigh the shape '
        + 'of the profile against your own read on yourself.',
    };
  },
};
