/**
 * Attachment Style — 24 statements scoring the four adult attachment patterns.
 *
 * Each pattern is scored independently and the highest wins, because these are
 * not four boxes: most people have a predominant pattern with secondary leanings,
 * and it shifts depending on the relationship. That is why the result always
 * names a runner-up.
 *
 * Original wording. The four-category framing comes from Berscheid/Bartholomew
 * & Horowitz's adult attachment research; the descriptions here are written for
 * this page, and none of this is a diagnosis.
 */
import { quizBySlug } from '../meta';
import { topKeys, traitRows } from '../quizEngine';

const STYLES = [
  {
    key: 'secure',
    name: 'Secure',
    short: 'Secure',
    note: 'Comfortable with closeness, and with distance.',
    body: 'You can be close to someone without it feeling like a risk, and you can be apart without it '
      + 'feeling like a loss. You tend to ask for what you need fairly directly, and you can hear a '
      + 'partner\u2019s need for space without reading it as rejection.',
    help: 'There is not much to fix here. What is worth noticing is that this is the pattern that tends to '
      + 'settle other people down — if a partner is anxious or avoidant, your steadiness is often what gives '
      + 'them room to move. The blind spot is the reverse: it can be hard to see how much distress a partner '
      + 'is in, because it would not distress you.',
  },
  {
    key: 'anxious',
    name: 'Anxious-Preoccupied',
    short: 'Anxious',
    note: 'Watches for distance, and wants reassurance.',
    body: 'You are tuned in to a partner\u2019s availability, and small signals — a shorter reply, a '
      + 'distracted evening — can read as the start of something ending. The urge to close the gap can be '
      + 'strong enough to override what you actually need.',
    help: 'Two things tend to help. Naming the feeling out loud ("I got anxious when you went quiet") '
      + 'rather than acting on it, and building a source of steadiness that does not depend on someone '
      + 'else\u2019s mood. Reassurance works when it is asked for directly, but not when it is tested for — '
      + 'the test is the part that wears a relationship down.',
  },
  {
    key: 'avoidant',
    name: 'Dismissive-Avoidant',
    short: 'Avoidant',
    note: 'Self-reliant, and closeness can register as pressure.',
    body: 'You handle things yourself, and you are good at it. Closeness can arrive as an obligation rather '
      + 'than a relief, and the reflex to create distance often shows up before you have decided anything '
      + 'about how you feel.',
    help: 'The useful move is usually small and specific: say the thing you would normally keep in, once, '
      + 'before the withdrawal starts. Partners generally read silence as disinterest rather than as '
      + 'self-protection. Naming that you need space — instead of just taking it — costs less than it feels '
      + 'like it will.',
  },
  {
    key: 'fearful',
    name: 'Fearful-Avoidant',
    short: 'Fearful',
    note: 'Wants closeness, and expects it to hurt.',
    body: 'You want to be close and you expect being close to cost you. That pulls in two directions at '
      + 'once, which tends to show up as wanting more, getting it, then finding a reason to pull back — or '
      + 'being drawn to people who are not reliably available in the first place.',
    help: 'This pattern usually traces back to a relationship where closeness genuinely was not safe, so it '
      + 'is the least useful one to be hard on yourself about. It is also the pattern that benefits most '
      + 'from working with a therapist rather than a quiz result: the goal is not to want less, it is to let '
      + 'a safe person be safe for long enough to believe it.',
  },
];

const label = (pct) => {
  if (pct >= 65) return 'Pronounced';
  if (pct >= 45) return 'Moderate';
  return 'Low';
};

const meta = quizBySlug('attachment');

export default {
  ...meta,
  seoTitle: 'Attachment Style Quiz',
  seoDescription:
    'A free 24-statement attachment style quiz scoring secure, anxious-preoccupied, dismissive-avoidant and fearful-avoidant patterns, with instant results and a full breakdown.',
  intro:
    'Attachment theory says the way we learned to get care as a child becomes the way we ask for it as an '
    + 'adult — how much closeness feels safe, and what we do when it is threatened. This quiz scores you '
    + 'across the four adult patterns: secure, anxious-preoccupied, dismissive-avoidant and '
    + 'fearful-avoidant.',
  pills: [
    { emoji: '🤝', label: 'Secure' },
    { emoji: '🫧', label: 'Anxious-preoccupied' },
    { emoji: '🧊', label: 'Dismissive-avoidant' },
    { emoji: '🌀', label: 'Fearful-avoidant' },
  ],
  hint:
    '24 statements, six per pattern, five-point agree/disagree scale, no time limit. Answer for how you '
    + 'actually behave in close relationships — not for how you behave at your best, and not for a '
    + 'particular relationship you are trying to make work.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. This is an original questionnaire built on the adult '
    + 'attachment framework — not a clinical instrument, not a diagnosis, and not a verdict on you or your '
    + 'relationships. Attachment patterns are learned, they shift over time and between relationships, and '
    + 'they are a description of a habit rather than a fixed trait.',

  items: [
    // ── Secure ──
    { dim: 'secure', key: 1, text: 'I am comfortable being close to a partner, and I trust they will still be there.' },
    { dim: 'secure', key: 1, text: 'When we disagree, I can stay connected while we work it out.' },
    { dim: 'secure', key: 1, text: 'Asking a partner for support feels natural rather than risky.' },
    { dim: 'secure', key: 1, text: 'I can be close to someone without losing my sense of myself.' },
    { dim: 'secure', key: 1, text: 'I expect relationships to be mostly steady, with ups and downs I can handle.' },
    { dim: 'secure', key: 1, text: 'I am comfortable with a partner needing space, and with taking it myself.' },

    // ── Anxious-preoccupied ──
    { dim: 'anxious', key: 1, text: 'I often worry that a partner does not feel as strongly about me as I do about them.' },
    { dim: 'anxious', key: 1, text: 'When someone close to me goes quiet, I assume something is wrong between us.' },
    { dim: 'anxious', key: 1, text: 'I need a fair amount of reassurance before I feel settled in a relationship.' },
    { dim: 'anxious', key: 1, text: 'I will bend my own needs to avoid the risk of someone pulling away.' },
    { dim: 'anxious', key: 1, text: 'If a partner wants time alone, I find it hard not to take it personally.' },
    { dim: 'anxious', key: 1, text: 'I notice small changes in someone’s tone and read them as distance.' },

    // ── Dismissive-avoidant ──
    { dim: 'avoidant', key: 1, text: 'I would rather work a problem out on my own than lean on a partner.' },
    { dim: 'avoidant', key: 1, text: 'When someone gets too close, I feel an urge to create some space.' },
    { dim: 'avoidant', key: 1, text: 'I find it hard to tell a partner what I need emotionally.' },
    { dim: 'avoidant', key: 1, text: 'Depending on someone makes me uneasy, even when I trust them.' },
    { dim: 'avoidant', key: 1, text: 'I keep parts of my life separate from my relationships.' },
    { dim: 'avoidant', key: 1, text: 'I would rather keep a conversation light than take it somewhere deep.' },

    // ── Fearful-avoidant ──
    { dim: 'fearful', key: 1, text: 'I want to be close, but I also expect to get hurt if I let it happen.' },
    { dim: 'fearful', key: 1, text: 'I swing between wanting more closeness and pulling away.' },
    { dim: 'fearful', key: 1, text: 'I am often drawn to people who are not reliably available to me.' },
    { dim: 'fearful', key: 1, text: 'Part of me wants to be fully known; part of me is sure that would end badly.' },
    { dim: 'fearful', key: 1, text: 'I find it hard to trust even when someone has given me no reason not to.' },
    { dim: 'fearful', key: 1, text: 'When a relationship gets serious, I sometimes create a problem to test it.' },
  ],

  interpret(scores, responses) {
    const rows = traitRows(scores, STYLES);
    const ranked = topKeys(scores, 2, STYLES.map((s) => s.key));
    const core = STYLES.find((s) => s.key === ranked[0]) || STYLES[0];
    const second = STYLES.find((s) => s.key === ranked[1]);
    const corePct = Math.round(scores[core.key]?.pct ?? 0);
    const secondPct = second ? Math.round(scores[second.key]?.pct ?? 0) : 0;
    const mixed = second && corePct - secondPct <= 10;

    return {
      headline: core.name,
      headlineSub: core.note,
      summary: `${core.body.split('. ')[0]}.`
        + (mixed
          ? ` ${second.name} scored almost as high (${secondPct}%), and having two patterns running close together is common — it usually means the pattern depends on who you are with.`
          : ''),
      stats: [
        { val: `${corePct}%`, lbl: 'Strongest pattern' },
        ...(second ? [{ val: `${secondPct}%`, lbl: second.short }] : []),
        { val: String(responses.length), lbl: 'Statements' },
      ],
      barsTitle: 'Your Four Patterns',
      bars: rows.map((row) => ({
        label: row.short,
        pct: Math.round(row.pct),
        caption: `${label(row.pct)}${row.key === core.key ? ' · your strongest' : mixed && row.key === second?.key ? ' · also elevated' : ''}`,
      })),
      blocks: [
        { title: `${core.name} — what it looks like`, body: core.body },
        { title: 'What tends to help', body: core.help },
        ...(mixed && second
          ? [{
            title: `${second.name} is running close behind`,
            body: `${second.body} With two patterns this close, the useful question is not "which am I" but `
              + '"which one shows up with which person" — that is usually the more accurate answer.',
          }]
          : []),
        {
          title: 'How to read this',
          body: 'Most people score highest on one pattern without being exclusively that. Your pattern is a '
            + 'habit learned in order to stay safe, not a personality, and it commonly differs between a '
            + 'romantic relationship, a friendship and a parent. If a low score here describes you in one '
            + 'relationship but not another, believe the relationship rather than the score.',
        },
      ],
      note:
        'Each bar is the share of agreement you gave that pattern across its six statements. Attachment '
        + 'questionnaires are the most self-report-sensitive kind there is — the answers you are least sure '
        + 'about are often the most informative, so it is worth reading the lower bars too rather than only '
        + 'the one that won.',
    };
  },
};
