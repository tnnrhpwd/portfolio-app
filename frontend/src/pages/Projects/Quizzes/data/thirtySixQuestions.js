/**
 * The 36 Questions — a guided two-person conversation, not a scored quiz
 * (`mode: 'prompt'`).
 *
 * Nothing here is graded, so there is no `scale` and no `interpret`; the only
 * thing recorded is each partner's private closeness rating at the end, which
 * `formatSession` turns into the result screen.
 *
 * The escalating three-set structure comes from Arthur Aron and colleagues'
 * research on generating interpersonal closeness, later popularised as "the 36
 * questions that make you fall in love". The questions below are ORIGINAL and
 * written for this page — they follow the same shape (light → personal →
 * vulnerable) but are not the published ones, which are under copyright. The
 * ending is also honestly framed: the study found the exercise accelerates
 * closeness between people; it does not manufacture love, and it is not a
 * compatibility test.
 */
import { quizBySlug } from '../meta';
import { bandFor } from '../quizEngine';

const SETS = [
  {
    key: 'I',
    name: 'Set I — Starting somewhere',
    blurb: 'Light, factual, and chosen so that neither of you has to be brave yet. Skip around within a set if you want to.',
  },
  {
    key: 'II',
    name: 'Set II — Going deeper',
    blurb: 'Personal history, values and feelings. This is where the conversation usually stops being small talk.',
  },
  {
    key: 'III',
    name: 'Set III — Being seen',
    blurb: 'The vulnerable end. There is no obligation to answer any of these — saying so is itself an answer.',
  },
];

const QUESTIONS = [
  // ── Set I ──
  { set: 'I', text: 'Given anyone at all, who would you want at a dinner you were hosting, and why them?' },
  { set: 'I', text: 'What is the last thing you got genuinely excited about?' },
  { set: 'I', text: 'What does an ordinary good day look like for you at the moment?' },
  { set: 'I', text: 'What did you want to be when you were eight, and what happened to that idea?' },
  { set: 'I', text: 'What is a small thing that reliably improves your mood?' },
  { set: 'I', text: 'What do you do to recover when a week has been too much?' },
  { set: 'I', text: 'What is something you are better at than most people give you credit for?' },
  { set: 'I', text: 'What is the earliest thing you remember deciding about the kind of person you wanted to be?' },
  { set: 'I', text: 'What is a place you keep meaning to go back to?' },
  { set: 'I', text: 'Who taught you the most, and what did they actually teach you?' },
  { set: 'I', text: 'What do you spend money on without feeling bad about it?' },
  { set: 'I', text: 'What is the most useful thing anyone has ever told you?' },

  // ── Set II ──
  { set: 'II', text: 'What is something about your family you only understood as an adult?' },
  { set: 'II', text: 'What do you do when you are hurt and do not want to say so?' },
  { set: 'II', text: 'What is a belief you held five years ago that you have since dropped?' },
  { set: 'II', text: 'When do you feel most like yourself?' },
  { set: 'II', text: 'What is the kindest thing a stranger has ever done for you?' },
  { set: 'II', text: 'What are you quietly afraid of?' },
  { set: 'II', text: 'What is a part of your history you would rather not have to explain to anyone?' },
  { set: 'II', text: 'Who would you want in the room at your worst moment, and why them?' },
  { set: 'II', text: 'What do you need more of that you have not asked anyone for?' },
  { set: 'II', text: 'What do you find hardest to forgive in other people, and where do you think that comes from?' },
  { set: 'II', text: 'What does the word "home" mean to you?' },
  { set: 'II', text: 'When did you last genuinely change your mind about something that mattered?' },

  // ── Set III ──
  { set: 'III', text: 'What is something you admire in the person opposite you that you have never said out loud?' },
  { set: 'III', text: 'What do you think I get wrong about you?' },
  { set: 'III', text: 'When have you been most afraid of losing someone?' },
  { set: 'III', text: 'When have you been most proud of how someone close to you handled something?' },
  { set: 'III', text: 'If one thing in your life had gone differently, what would you have chosen instead?' },
  { set: 'III', text: 'What do you want to be true about your life in ten years? Say it without hedging.' },
  { set: 'III', text: 'What have you been carrying that someone else could take some of?' },
  { set: 'III', text: 'What is the nicest thing anyone has said about you that you still do not quite believe?' },
  { set: 'III', text: 'If this were the last time we talked for a long while, what would you want to have said?' },
  { set: 'III', text: 'What did you need as a child that you still find it hard to ask for?' },
  { set: 'III', text: 'What would you want me to know about you that nothing on the surface shows?' },
  { set: 'III', text: 'Say one specific thing you appreciate about the other person. Not a general one.' },
];

const CLOSENESS_LABELS = [
  { value: 1, label: 'Distant' },
  { value: 2, label: 'A bit apart' },
  { value: 3, label: 'Separate' },
  { value: 4, label: 'Neutral' },
  { value: 5, label: 'Close-ish' },
  { value: 6, label: 'Close' },
  { value: 7, label: 'Very close' },
];

const BANDS = [
  {
    min: 0,
    max: 4,
    label: 'Room here',
    body: 'You both came out low on closeness, which after an evening of these questions is worth taking at '
      + 'face value rather than explaining away. It often means something specific has gone unsaid, and the '
      + 'third set is where it usually lives. Naming that is more useful than repeating the exercise.',
  },
  {
    min: 4.01,
    max: 5.5,
    label: 'Warm, with distance',
    body: 'You are not far apart, and not as close as the evening might have suggested. That is a common '
      + 'result — the questions open things up while you are answering them, and the feeling fades faster '
      + 'than people expect. What tends to hold it is following up on one thing from Set III in the week '
      + 'afterwards, rather than letting it be a nice evening.',
  },
  {
    min: 5.51,
    max: 6.5,
    label: 'Close',
    body: 'You both felt close by the end. The useful move is to notice what got you there — for most people '
      + 'it is one specific question rather than the set as a whole — and to make room for that kind of '
      + 'conversation when it is not being prompted by a quiz.',
  },
  {
    min: 6.51,
    max: 7,
    label: 'Very close',
    body: 'You both landed at the top of the scale. Worth holding lightly: a rating taken at the end of an '
      + 'unusually open evening is a reading of that evening, not of the relationship. The thing that makes '
      + 'it durable is doing this often enough that it stops being unusual.',
  },
];

const meta = quizBySlug('thirty-six-questions');

export default {
  ...meta,
  mode: 'prompt',
  // 3 escalating sets of 12. A shorter run takes fewer from EACH set rather
  // than dropping a set, so the arc from light to vulnerable survives — which
  // is the only reason the exercise works at all.
  lengths: {
    short: { label: 'One pass', count: 12, blurb: '~20 min' },
    standard: { label: 'Standard', count: 24, blurb: '~40 min' },
    full: { label: 'All three sets', count: null, blurb: '~60 min' },
  },
  defaultLength: 'standard',
  seoTitle: 'The 36 Questions — A Conversation for Two',
  seoDescription:
    'A guided 36-question conversation for couples in three escalating sets, with a private closeness rating at the end and a full question list to keep. Nothing scored, nothing saved.',
  intro:
    'This is not a test. It is thirty-six questions read aloud, in three sets that get progressively less '
    + 'guarded, with both of you answering each one before moving on. The only thing recorded at the end is '
    + 'how close each of you felt — and you each answer that privately, so neither of you anchors the other.',
  pills: [
    { emoji: '🗣️', label: 'Read aloud, answer aloud' },
    { emoji: '📈', label: '3 escalating sets' },
    { emoji: '⏱️', label: 'About an hour' },
    { emoji: '🔒', label: 'Nothing saved, ever' },
  ],
  hint:
    'Put the phones out of reach and go in order — the sets depend on the earlier ones having been '
    + 'answered. If a question lands badly, say so and move on; that is a better outcome than pushing '
    + 'through it.',
  // The escalation is the whole design, so the order is fixed. CoupleQuizPage
  // also enforces this for prompt mode; declaring it here documents why.
  shuffle: false,
  closeness: {
    question: 'How close do you feel to the person you just did this with, right now?',
    scale: CLOSENESS_LABELS,
    note: 'Answer this as how you feel this minute, not how you think you should feel. Your partner does not see your answer until after they have given theirs.',
  },
  disclaimer:
    'For entertainment and self-reflection only. The three-set structure follows the "generating '
    + 'interpersonal closeness" research by Aron and colleagues, but these questions are original — they '
    + 'are not the published 36 questions, which are under copyright, and this exercise is not affiliated '
    + 'with that research. The study found this kind of conversation accelerates closeness between people; '
    + 'it does not manufacture love, it does not work for every pair, and it says nothing about whether a '
    + 'relationship should continue. Nothing you answer here is saved.',

  sets: SETS,
  items: QUESTIONS,

  formatSession({ names, ratings }) {
    const a = ratings?.a ?? 0;
    const b = ratings?.b ?? 0;
    const average = (a + b) / 2;
    const separated = Math.abs(a - b);
    const band = bandFor(average, BANDS);

    return {
      headline: band?.label || 'Result',
      headlineSub: `${names.a} and ${names.b}, side by side`,
      summary: band?.body || '',
      stats: [
        { val: `${a}/7`, lbl: names.a },
        { val: `${b}/7`, lbl: names.b },
        { val: String(separated), lbl: 'Points apart' },
      ],
      blocks: [
        ...(separated >= 2
          ? [{
            title: `You came out ${separated} points apart`,
            body: `A gap that size usually means one of you found the evening more moving than the other `
              + `did, and the most useful thing you can do is say which one of you that was. It is far more `
              + `often about what was going on before you started than about anything in the questions — `
              + `one of you may have arrived already carrying something. Try not to read it as a verdict on `
              + `the relationship, because it is not one.`,
          }]
          : [{
            title: 'Your ratings landed close together',
            body: 'You read the evening similarly, which at least means you are calibrated to each other. '
              + 'That is worth more than either number: couples who agree about how close they feel tend to '
              + 'recover faster from the times they do not.',
          }]),
        {
          title: 'The optional ending',
          body: 'The original study closed with four minutes of silent eye contact. It sounds like a stunt '
            + 'and it is genuinely uncomfortable for the first minute, then usually stops being. Do it if '
            + 'you want the full version — a timer, no talking, and no breaking eye contact to laugh it off.',
        },
        {
          title: 'Where to take it from here',
          body: 'Pick the one question that landed hardest, not the whole set, and come back to it in a few '
            + 'days. The effect of an exercise like this fades quickly if the evening is all there is. It is '
            + 'also worth doing again in a year: the same questions get different answers, and the '
            + 'difference between the two sets is more interesting than either one.',
        },
        {
          title: 'If it did not land',
          body: 'Some pairs find this completely flat, and a few find it actively uncomfortable — usually '
            + 'because one person does not want to be known that directly. That is a real result rather '
            + 'than a failure of the exercise, and it is worth saying out loud to each other rather than '
            + 'quietly marking the evening down.',
        },
      ],
      note:
        'The closeness rating is a snapshot of one evening, taken immediately after an unusually open '
        + 'conversation, and it is not comparable between couples or between nights. Treat the two numbers as '
        + 'the start of a sentence rather than the end of one.',
    };
  },
};
