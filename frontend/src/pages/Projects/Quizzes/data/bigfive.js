/**
 * Big Five (OCEAN) — 30 statements across the five broad traits.
 *
 * Roughly half the items are reverse-keyed (`key: -1`), so agreeing with them
 * counts against the trait. That is what keeps the quiz from measuring
 * "how positively do you describe yourself" instead of the trait itself.
 *
 * The fifth trait is presented as "Emotional Reactivity" rather than
 * "Neuroticism" — same construct, less pathologising label.
 */
import { quizBySlug } from '../meta';
import { strengthLabel, traitRows } from '../quizEngine';

const TRAITS = [
  { key: 'O', name: 'Openness', note: 'Curiosity, imagination, appetite for the unfamiliar.' },
  { key: 'C', name: 'Conscientiousness', note: 'Order, follow-through, planning ahead.' },
  { key: 'E', name: 'Extraversion', note: 'Sociability, energy from other people, talkativeness.' },
  { key: 'A', name: 'Agreeableness', note: 'Compassion, cooperation, patience with others.' },
  { key: 'N', name: 'Emotional Reactivity', note: 'How quickly and strongly feelings shift under pressure.' },
];

// One paragraph per trait per band. Kept short and non-judgemental: a low
// score is a description, not a deficiency.
const BLURBS = {
  O: {
    High: 'You are curious by default and enjoy ideas, art and unfamiliar places for their own sake. Novelty tends to energise you, though it can also mean more projects started than finished.',
    Balanced: 'You are open to new things without needing them: you will happily follow an interesting detour, but you are just as content with what you already know works.',
    Low: 'You prefer the proven and the concrete to the speculative. That is a real strength when something needs to actually work, and it pairs well with depth over breadth.',
  },
  C: {
    High: 'You are organised and dependable, and you finish what you start. People can build on what you say you will do — the trade-off is that mess and drift cost you more than they cost other people.',
    Balanced: 'You can be organised when it matters without needing everything tidy all the time. You plan where planning pays off and improvise where it does not.',
    Low: 'You work in bursts and dislike being boxed in by structure. You are often at your most creative under a deadline, though the deadline is doing a lot of the work.',
  },
  E: {
    High: 'Other people are where your energy comes from. You think out loud, you enjoy a busy room, and solitude for too long starts to feel flat.',
    Balanced: 'You enjoy company and you enjoy quiet, and you can move between the two without much friction. How social you feel depends a lot on the week.',
    Low: 'You recharge alone and prefer depth of conversation to volume of it. Small talk costs you energy that real conversation gives back.',
  },
  A: {
    High: 'You lead with empathy and give people the benefit of the doubt. You are easy to be around — the risk is that your own needs get quietly deprioritised.',
    Balanced: 'You can be warm and cooperative without losing your own position. You generally pick your battles rather than avoiding or seeking them.',
    Low: 'You are direct and sceptical, and you will say the difficult thing rather than smooth it over. Useful in a crisis; harder in a negotiation you need to win.',
  },
  N: {
    High: 'Your feelings rise quickly and can take a while to settle. That sensitivity picks up real signals early — it just also means more of your energy goes into managing the weather.',
    Balanced: 'You feel things clearly without being swept away by them. Stress registers, and you generally get back to level within a reasonable time.',
    Low: 'You are steady under pressure and you recover from setbacks quickly. The upside is obvious; the thing to watch is missing a warning sign that a more anxious person would have caught.',
  },
};

const meta = quizBySlug('bigfive');

export default {
  ...meta,
  seoTitle: 'Big Five Personality Test (OCEAN)',
  seoDescription:
    'A free Big Five (OCEAN) personality test: 30 statements scoring Openness, Conscientiousness, Extraversion, Agreeableness and Emotional Reactivity, with instant results.',
  intro:
    'The Big Five is the trait model most personality researchers keep coming back to: instead of putting you '
    + 'in a box, it scores you on five broad dimensions and lets you sit high on some and low on others. '
    + 'Thirty statements, about five minutes.',
  pills: [
    { emoji: '💡', label: 'Openness' },
    { emoji: '📋', label: 'Conscientiousness' },
    { emoji: '🗣️', label: 'Extraversion' },
    { emoji: '🤝', label: 'Agreeableness' },
    { emoji: '🌊', label: 'Emotional Reactivity' },
  ],
  hint:
    '30 statements, six per trait, five-point agree/disagree scale. About half are worded in the opposite '
    + 'direction on purpose, so answer each one on its own rather than trying to be consistent.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. It is an original questionnaire written in the spirit of '
    + 'the Big Five / IPIP tradition rather than a copy of any published inventory, and scores here are '
    + 'percentages of your own answers — not norms against a population, and not a clinical assessment.',

  items: [
    // ── Openness ──
    { dim: 'O', key: 1, text: 'I enjoy playing with ideas that have no obvious practical use.' },
    { dim: 'O', key: 1, text: 'I am drawn to art, music or writing that makes me see something differently.' },
    { dim: 'O', key: 1, text: 'I like visiting places where the culture and the language are unfamiliar to me.' },
    { dim: 'O', key: -1, text: 'I would rather stick with what I know than try something unproven.' },
    { dim: 'O', key: -1, text: 'Abstract discussions tend to bore me.' },
    { dim: 'O', key: -1, text: 'I prefer familiar routines to novelty for its own sake.' },

    // ── Conscientiousness ──
    { dim: 'C', key: 1, text: 'I follow through on what I say I will do, even after the novelty has worn off.' },
    { dim: 'C', key: 1, text: 'I keep my space and my work organised.' },
    { dim: 'C', key: 1, text: 'I plan ahead so that deadlines do not turn into emergencies.' },
    { dim: 'C', key: -1, text: 'I leave things to the last minute more often than I would like.' },
    { dim: 'C', key: -1, text: 'My belongings tend to end up wherever I last put them down.' },
    { dim: 'C', key: -1, text: 'I start more things than I finish.' },

    // ── Extraversion ──
    { dim: 'E', key: 1, text: 'I get energy from being around other people.' },
    { dim: 'E', key: 1, text: 'I am usually the one who starts the conversation.' },
    { dim: 'E', key: 1, text: 'I enjoy being part of a busy, talkative group.' },
    { dim: 'E', key: -1, text: 'A full day of socialising leaves me needing time on my own.' },
    { dim: 'E', key: -1, text: 'I would take a quiet evening with one person over a party.' },
    { dim: 'E', key: -1, text: 'I keep my thoughts to myself until I have had time to consider them.' },

    // ── Agreeableness ──
    { dim: 'A', key: 1, text: 'I try to imagine where the other person is coming from before I respond.' },
    { dim: 'A', key: 1, text: 'People tell me I am easy to talk to.' },
    { dim: 'A', key: 1, text: 'Other people’s moods affect how I feel.' },
    { dim: 'A', key: -1, text: 'I will push my point hard when I believe I am right.' },
    { dim: 'A', key: -1, text: 'I find it hard to be patient with people who cannot keep up.' },
    { dim: 'A', key: -1, text: 'I care more about whether something works than about how it makes people feel.' },

    // ── Emotional Reactivity ──
    { dim: 'N', key: 1, text: 'My mood can shift quickly for no obvious reason.' },
    { dim: 'N', key: 1, text: 'I replay conversations afterwards, wondering whether I said the wrong thing.' },
    { dim: 'N', key: 1, text: 'Stress shows up in my body before I have noticed it in my head.' },
    { dim: 'N', key: -1, text: 'I stay calm when things go wrong.' },
    { dim: 'N', key: -1, text: 'I recover quickly from a setback.' },
    { dim: 'N', key: -1, text: 'I rarely feel anxious about things I cannot control.' },
  ],

  interpret(scores, responses) {
    const rows = traitRows(scores, TRAITS);
    const strongest = rows.slice().sort((a, b) => b.pct - a.pct)[0] || rows[0];

    return {
      headline: strongest?.name || 'Your Profile',
      headlineSub: 'Your most pronounced of the five traits',
      summary:
        `You scored highest on ${strongest?.name.toLowerCase()}, and your five traits span `
        + `${Math.round(Math.min(...rows.map((r) => r.pct)))}% to ${Math.round(Math.max(...rows.map((r) => r.pct)))}%. `
        + 'The shape of the profile is more useful than any single number — a mid score is a real result, '
        + 'not a missing one.',
      stats: [
        { val: String(responses.length), lbl: 'Statements' },
        { val: `${Math.round(strongest?.pct ?? 0)}%`, lbl: strongest?.name || 'Top trait' },
      ],
      barsTitle: 'Your Five Traits',
      bars: rows.map((row) => ({
        label: row.name,
        pct: Math.round(row.pct),
        caption: strengthLabel(row.pct),
      })),
      blocks: rows.map((row) => ({
        title: `${row.name} — ${strengthLabel(row.pct)}`,
        body: `${row.note} ${BLURBS[row.key][strengthLabel(row.pct)]}`,
      })),
      note:
        'Each bar is the share of the available agreement you gave that trait across its six statements, '
        + 'with reverse-keyed items flipped. Because there are only six statements per trait, treat a '
        + 'difference of five or ten points between two traits as noise rather than a finding.',
    };
  },
};
