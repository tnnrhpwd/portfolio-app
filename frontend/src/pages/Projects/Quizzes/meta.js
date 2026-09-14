/**
 * The quiz catalogue — the single source of truth for what exists under
 * /quizzes, used by the hub page and by each quiz's own config.
 *
 * Kept deliberately light (no question text) so the hub page can import it
 * without pulling every item bank into the bundle. Each quiz's full config
 * lives in ./data/<slug>.js and spreads its meta entry from here, so a name or
 * path is never written down twice.
 *
 * `accentRole` names the SCHEME ROLE that tints this quiz's badges, buttons and
 * bars — not a colour. It resolves to `var(--scheme-accent)` or
 * `var(--scheme-primary)` (see QuizPage.css), so the quizzes follow the
 * visitor's chosen scheme. Quizzes are given alternating roles so neighbouring
 * cards do not all read the same. It is deliberately not a `--fg-*` / `--bg-*`
 * reference: those are aliased onto the scheme inside each page's stylesheet,
 * which would make this field look like a fixed hue when it is not one.
 */

export const QUIZZES = [
  {
    slug: 'mbti',
    path: '/mbti',
    name: '16 Personality Types',
    shortName: '16 Types',
    emoji: '🧭',
    tagline: 'A Myers-Briggs–style read on how you direct energy, take in information, decide, and organise.',
    minutes: 8,
    tags: ['Personality'],
    accentRole: 'accent',
  },
  {
    slug: 'bigfive',
    path: '/big-five',
    name: 'Big Five Personality Test',
    shortName: 'Big Five',
    emoji: '🌈',
    tagline: 'Score yourself on the five broad traits modern personality research keeps coming back to.',
    minutes: 7,
    tags: ['Personality'],
    accentRole: 'primary',
  },
  {
    slug: 'enneagram',
    path: '/enneagram',
    name: 'Enneagram Test',
    shortName: 'Enneagram',
    emoji: '🔺',
    tagline: 'Find your core type out of nine, plus the neighbouring type you lean toward.',
    minutes: 9,
    tags: ['Personality'],
    accentRole: 'primary',
  },
  {
    slug: 'autism',
    path: '/autism-screening',
    name: 'Autism Spectrum Screening',
    shortName: 'Autism Screening',
    emoji: '🧩',
    tagline: 'A Q-style questionnaire across social interaction, communication, flexibility and detail.',
    minutes: 6,
    tags: ['Screening'],
    accentRole: 'accent',
  },
  {
    slug: 'adhd',
    path: '/adhd-screening',
    name: 'ADHD Self-Report Scale',
    shortName: 'ADHD Screening',
    emoji: '⚡',
    tagline: 'An ASRS-style self-report across attention and hyperactivity/impulsivity.',
    minutes: 5,
    tags: ['Screening'],
    accentRole: 'accent',
  },
  {
    slug: 'attachment',
    path: '/attachment-style',
    name: 'Attachment Style Quiz',
    shortName: 'Attachment',
    emoji: '🪢',
    tagline: 'How you handle closeness and distance in close relationships — secure, anxious, avoidant or fearful.',
    minutes: 6,
    tags: ['Relationships'],
    accentRole: 'primary',
  },
  {
    slug: 'love-languages',
    path: '/love-languages',
    name: 'Love Languages Test',
    shortName: 'Love Languages',
    emoji: '💞',
    tagline: 'The five ways people tend to feel cared for, and which of them actually lands on you.',
    minutes: 6,
    tags: ['Relationships'],
    accentRole: 'primary',
  },
  {
    slug: 'values-alignment',
    path: '/values-alignment',
    name: 'Values & Future Alignment',
    shortName: 'Values Alignment',
    emoji: '🧭',
    tagline: 'A couples quiz: both of you answer 18 statements, then see exactly where you align and where you differ.',
    minutes: 10,
    tags: ['For two'],
    accentRole: 'accent',
  },
  {
    slug: 'thirty-six-questions',
    path: '/36-questions',
    name: 'The 36 Questions',
    shortName: '36 Questions',
    emoji: '🕯️',
    tagline: 'Thirty-six questions read aloud in three escalating sets — a guided conversation for two, not a test.',
    minutes: 60,
    tags: ['For two'],
    accentRole: 'primary',
  },
];

/**
 * Quizzes that are listed on the hub but are NOT part of the engine above —
 * they have their own page and their own implementation, so there is no
 * `./data/<slug>.js` for them. Kept in a separate list rather than mixed into
 * `QUIZZES` so the catalogue tests (which assert one config module per entry)
 * can keep iterating `QUIZZES` and stay honest.
 *
 * The IQ Test moved here from the /projects catalogue, where it had been a card
 * of its own. It uses the same scheme roles as the rest, so it does not read as
 * a visitor from another page.
 */
export const STANDALONE_QUIZZES = [
  {
    slug: 'iq',
    path: '/iq',
    name: 'IQ Test',
    shortName: 'IQ Test',
    emoji: '🧠',
    tagline: 'An adaptive IQ test across eight categories, with difficulty tiers and an estimated score.',
    minutes: 20,
    tags: ['Cognitive'],
    accentRole: 'accent',
  },
];

/** What the hub renders, in order: the standalone pages first, then the family. */
export const HUB_QUIZZES = [...STANDALONE_QUIZZES, ...QUIZZES];

/** Look up a quiz's catalogue entry by slug (used by ./data/*.js). */
export const quizBySlug = (slug) => QUIZZES.find((quiz) => quiz.slug === slug);

/** GitHub folder holding every quiz's source, for the "View Source Code" link. */
export const QUIZ_SOURCE_URL =
  'https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/Quizzes';
