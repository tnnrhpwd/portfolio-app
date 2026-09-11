/**
 * The three Simple surfaces — ONE list, two consumers.
 *
 *   💬 Chat    /net     — say what you want, in words (or voice)
 *   🎛️ Control /simple  — watch it work, decide how far it may go
 *   🎯 Goals   /plans   — where intent lives; the durable record
 *
 * Both the header switcher (`components/Simple/SimpleNav`) and the closing CTA
 * band (`components/Simple/SimpleCtaBand`) name these three rooms. They are read
 * from here rather than typed twice because the *words* are the navigation: if
 * the switcher says "Control" and the CTA card says something else, the switcher
 * stops being a familiar landmark and becomes a fourth thing to learn.
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
