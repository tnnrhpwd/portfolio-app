/**
 * The Simple surfaces — ONE list per consumer.
 *
 *   💬 Chat    /net     — say what you want, in words (or voice)
 *   🎛️ Control /simple  — watch it work, decide how far it may go
 *   🎯 Goals   /plans   — where intent lives; the durable record
 *   🧩 Market  /market  — what other people made, ready to save
 *
 * `SIMPLE_SURFACES` is the **three-room product story** the closing CTA band
 * tells ("Say it, watch it, keep it") — adding a fourth card there would break
 * that sentence.
 *
 * `SIMPLE_NAV_SURFACES` is the **header switcher**: every room you can walk
 * into, Market included. Both lists live here rather than being typed twice
 * because the *words* are the navigation: if the switcher says "Control" and
 * the CTA card says something else, the switcher stops being a familiar
 * landmark and becomes a fourth thing to learn.
 *
 * `desc` is the CTA card's one-line explanation; the switcher only uses the
 * icon + label.
 */
export const SIMPLE_SURFACES = [
  {
    to: '/net',
    icon: '💬',
    label: 'Chat',
    desc: 'Say what you want in plain English. Simple plans the steps and asks before anything risky.',
  },
  {
    to: '/simple',
    icon: '🎛️',
    label: 'Control',
    desc: 'Watch it work on your PC live, and set how far it may go — suggest-only through autopilot.',
  },
  {
    to: '/plans',
    icon: '🎯',
    label: 'Goals',
    desc: 'Every goal keeps its plan, its actions, and the lessons it learned. Hand it back any time.',
  },
];

/** Every room, for the header switcher (the three above plus the marketplace). */
export const SIMPLE_NAV_SURFACES = [
  ...SIMPLE_SURFACES,
  {
    to: '/market',
    icon: '🧩',
    label: 'Market',
    desc: 'Skills and goals other people shared — save one to your own workspace and make it yours.',
  },
];
