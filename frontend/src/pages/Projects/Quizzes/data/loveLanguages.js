/**
 * Love Languages — 25 statements scoring the five ways people tend to feel
 * cared for. Five items per language, five-point agreement scale.
 *
 * Framed throughout around *receiving* care (the framework's actual claim is
 * about how you best perceive love), which is why the "gifts" items are about
 * being thought of rather than about objects.
 *
 * "The Five Love Languages" is a trademarked book title; the five categories
 * are common descriptors and the statements here are original. The framework
 * itself has weak empirical support and this page says so in the result note —
 * worth keeping, because mismatched languages are commonly treated as a
 * relationship verdict when they are nothing of the sort.
 */
import { quizBySlug } from '../meta';
import { topKeys, traitRows } from '../quizEngine';

const LANGUAGES = [
  {
    key: 'words',
    name: 'Words of Affirmation',
    short: 'Words',
    note: 'Being told, specifically and sincerely, that you matter.',
    body: 'Compliments and stated appreciation land on you in a way other gestures do not. It is not about '
      + 'volume — a specific, sincere sentence about something you actually did means more than a stream of '
      + 'generic praise. The reverse is also true: an offhand criticism can stay with you much longer than '
      + 'it was meant to.',
    with: 'Say the thing you appreciate out loud, and be specific about it. "I noticed you handled that" '
      + 'does more than "you\u2019re great". If something has bothered you, raise it plainly rather than '
      + 'letting it sit, because silence reads to them as the absence of approval.',
  },
  {
    key: 'time',
    name: 'Quality Time',
    short: 'Time',
    note: 'Undivided attention, with nothing competing for it.',
    body: 'Attention is the currency. An hour with a phone in the room is worth far less to you than twenty '
      + 'minutes without one, and being cancelled on for something better stings more than it would for most '
      + 'people. You notice the difference between someone being present and someone being adjacent.',
    with: 'Protect unhurried time and make it undistracted — the quality matters more than the quantity. '
      + 'Being late, cancelling, or half-listening costs you more than you would guess, so it is worth saying '
      + 'that out loud rather than absorbing it.',
  },
  {
    key: 'service',
    name: 'Acts of Service',
    short: 'Acts',
    note: 'Someone lightening the load without being asked.',
    body: 'Practical help reads as care in a way words cannot fake for you. When someone takes a task off '
      + 'your plate that you were dreading, that registers as love; when they say supportive things and '
      + 'nothing changes, those words can feel hollow.',
    with: 'Offer specific help rather than "let me know if you need anything" — the whole point is not '
      + 'having to ask. Equally, do not let this turn into scorekeeping: unexplained resentment about who '
      + 'does what is the usual way this language goes wrong.',
  },
  {
    key: 'gifts',
    name: 'Receiving Gifts',
    short: 'Gifts',
    note: 'A tangible signal that you were being thought about.',
    body: 'The object is not the point — the evidence behind it is. Something small that shows a detail was '
      + 'remembered outweighs something expensive chosen without thought, and keeping the things people gave '
      + 'you is normal. What lands is the proof that you were in someone\u2019s head while they were apart '
      + 'from you.',
    with: 'This is the language most often misread as materialism, so a clear note here: it is about the '
      + 'thought, not the price. A token that proves attention was paid will do more than a larger gift that '
      + 'proves nothing. Do not skip occasions entirely — a missed one genuinely registers as something '
      + 'being absent.',
  },
  {
    key: 'touch',
    name: 'Physical Touch',
    short: 'Touch',
    note: 'Closeness you can feel — a hand, a hug, sitting close.',
    body: 'Physical contact settles you in a way that conversation does not. A hand on your arm changes the '
      + 'temperature of a moment, sitting close is how you know things are fine, and long stretches without '
      + 'any contact leave you feeling disconnected even when nothing is wrong.',
    with: 'Ordinary, everyday contact does the work here — it does not need to be grand. In a long-distance '
      + 'stretch, or if a partner is not naturally tactile, say what you need rather than waiting to be '
      + 'noticed, because this is the language people are least likely to guess.',
  },
];

const meta = quizBySlug('love-languages');

export default {
  ...meta,
  // 5 statements per language, so these divide evenly (2 / 3 per language).
  lengths: {
    short: { label: 'Short', count: 10, blurb: '~2 min' },
    standard: { label: 'Standard', count: 15, blurb: '~4 min' },
    full: { label: 'Full', count: null, blurb: '~6 min' },
  },
  defaultLength: 'standard',
  seoTitle: 'Love Languages Test',
  seoDescription:
    'A free 25-statement love languages test scoring words of affirmation, quality time, acts of service, receiving gifts and physical touch — with instant results and what each one means in practice.',
  intro:
    'The idea here is simple: people give care in the way they would most like to receive it, so two people '
    + 'can both be trying hard and both feel unseen. Twenty-five statements that all describe ways of '
    + 'feeling cared for, scored across five languages.',
  pills: [
    { emoji: '💬', label: 'Words of affirmation' },
    { emoji: '⏳', label: 'Quality time' },
    { emoji: '🧰', label: 'Acts of service' },
    { emoji: '🎁', label: 'Receiving gifts' },
    { emoji: '🤗', label: 'Physical touch' },
  ],
  hint:
    'Five-point agree/disagree scale. Answer for how you feel most cared for rather than how you show '
    + 'care — those two are often different, and that gap is the interesting part of this quiz.',
  scale: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  allowSkip: true,
  disclaimer:
    'For entertainment and self-reflection only. This is an original questionnaire built around the five '
    + 'love languages framework, which is a popular model rather than a strongly evidenced one — it is not a '
    + 'diagnosis, and it says nothing about whether a relationship works. This is not affiliated with the '
    + 'published Five Love Languages material.',

  items: [
    // ── Words of affirmation ──
    { dim: 'words', key: 1, text: 'A sincere compliment stays with me for hours.' },
    { dim: 'words', key: 1, text: 'Hearing that someone is proud of me means more than almost anything else they could say.' },
    { dim: 'words', key: 1, text: 'When appreciation is put into actual words, I feel it more than if it had been shown another way.' },
    { dim: 'words', key: 1, text: 'A message of encouragement can turn my whole day around.' },
    { dim: 'words', key: 1, text: 'I would rather be told I am valued than be given something to show it.' },

    // ── Quality time ──
    { dim: 'time', key: 1, text: 'Undivided attention — no phone, nothing else happening — is the clearest sign someone cares.' },
    { dim: 'time', key: 1, text: 'I would take an unhurried afternoon together over any gift.' },
    { dim: 'time', key: 1, text: 'Being cancelled on for something better stings me more than it seems to sting other people.' },
    { dim: 'time', key: 1, text: 'I feel closest to someone after we have spent real, unhurried time together.' },
    { dim: 'time', key: 1, text: 'I notice straight away when someone is with me physically but somewhere else mentally.' },

    // ── Acts of service ──
    { dim: 'service', key: 1, text: 'When someone quietly handles a task I was dreading, I feel deeply cared for.' },
    { dim: 'service', key: 1, text: 'I would rather someone show up and help than tell me they care.' },
    { dim: 'service', key: 1, text: 'Small practical help matters more to me than big gestures.' },
    { dim: 'service', key: 1, text: 'I remember when someone has gone out of their way to make something easier for me.' },
    { dim: 'service', key: 1, text: 'Words of support feel hollow to me if nothing changes in practice.' },

    // ── Receiving gifts ──
    { dim: 'gifts', key: 1, text: 'A small object someone chose with me in mind feels like evidence I was being thought about.' },
    { dim: 'gifts', key: 1, text: 'I keep the things people have given me, even the small ones.' },
    { dim: 'gifts', key: 1, text: 'A gift that shows someone remembered a detail means far more to me than an expensive one.' },
    { dim: 'gifts', key: 1, text: 'Getting something unexpected is one of the surest ways to make me feel loved.' },
    { dim: 'gifts', key: 1, text: 'I feel let down when an occasion passes without anything to mark it.' },

    // ── Physical touch ──
    { dim: 'touch', key: 1, text: 'A hand on my arm or shoulder can change how I feel in a moment.' },
    { dim: 'touch', key: 1, text: 'Sitting close to someone is how I know we are okay.' },
    { dim: 'touch', key: 1, text: 'Physical closeness reassures me more than anything that gets said.' },
    { dim: 'touch', key: 1, text: 'Long stretches with no physical contact leave me feeling disconnected.' },
    { dim: 'touch', key: 1, text: 'A hug does more for me than a conversation when I have had a hard day.' },
  ],

  interpret(scores, responses) {
    const rows = traitRows(scores, LANGUAGES);
    const ranked = topKeys(scores, 3, LANGUAGES.map((l) => l.key));
    const core = LANGUAGES.find((l) => l.key === ranked[0]) || LANGUAGES[0];
    const next = LANGUAGES.find((l) => l.key === ranked[1]);
    const lowest = rows.slice().sort((a, b) => a.pct - b.pct)[0];
    const corePct = Math.round(scores[core.key]?.pct ?? 0);

    return {
      headline: core.short,
      headlineSub: core.name,
      summary: `${core.body.split('. ')[0]}.`
        + (next && scores[next.key] ? ` ${next.name} came second (${Math.round(scores[next.key].pct)}%), so you likely recognise some of that too.` : '')
        + (lowest ? ` Your lowest was ${lowest.name.toLowerCase()} — which does not mean you dislike it, only that it is not the way you most reliably feel cared for.` : ''),
      stats: [
        { val: `${corePct}%`, lbl: 'Primary language' },
        ...(next ? [{ val: `${Math.round(scores[next.key]?.pct ?? 0)}%`, lbl: next.short }] : []),
        { val: String(responses.length), lbl: 'Statements' },
      ],
      barsTitle: 'How You Receive Care',
      bars: rows.map((row) => ({
        label: row.short,
        pct: Math.round(row.pct),
        caption: row.name,
      })),
      blocks: [
        { title: `${core.name} — what it looks like`, body: core.body },
        { title: 'What works with you', body: core.with },
        ...(next
          ? [{
            title: `Also in the mix: ${next.name}`,
            body: `Your second language came in at ${Math.round(scores[next.key]?.pct ?? 0)}%. Most people `
              + 'have one primary language and one or two that matter nearly as much, so it is worth telling '
              + `a partner both. ${next.body.split('. ')[0]}.`,
          }]
          : []),
        {
          title: 'The part this model gets wrong',
          body: 'The popular version of this idea claims that mismatched languages cause relationships to '
            + 'fail, and that research does not really support that. What the framework is genuinely good '
            + 'for is explaining a specific kind of misunderstanding: two people both trying hard, in '
            + 'languages the other does not hear. Treat it as a vocabulary for that conversation, not as a '
            + 'compatibility test. It also does not replace just asking someone what they need.',
        },
      ],
      note:
        'Each bar is the share of agreement you gave that language across its five statements. The gap '
        + 'between your top two is worth reading as much as the top one: a clear winner is a clear '
        + 'instruction, a narrow one means there is more than one way in.',
    };
  },
};
