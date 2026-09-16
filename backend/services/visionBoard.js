/**
 * visionBoard.js — the text half of a vision board, kept pure.
 *
 * A vision board is ONE generated picture that stands for the life the user is
 * aiming at. Two models are involved and they do different jobs:
 *
 *   1. the chat model TURNS THE GOALS INTO A PROMPT — that is the whole reason
 *      this is not just "send the goal titles to the image model". "Beach trip
 *      with my girlfriend and her child" is not an image prompt; "a small family
 *      walking a wide empty beach at golden hour, warm light, film photography"
 *      is. Turning an aspiration into something picturable is a language job.
 *   2. the image model draws it.
 *
 * Everything here is pure: no I/O, no DynamoDB, no Bedrock. The controller owns
 * the spending (credit gate → LLM → image → S3 → store) and this file owns what
 * to ask for and what to do with what comes back, which is the part worth
 * testing exhaustively.
 *
 * The one thing that must never reach the image model: a request for text. These
 * models render lettering as garbage, and a "vision board" in the prompt-writer's
 * mind is full of captions — so the rule is stated twice, and text is in the
 * negative prompt as well.
 *
 * The other thing this file owns is the LOOK. A board has a style — surface,
 * palette, how the pictures are treated, how they are arranged — picked per board
 * from BOARD_STYLES and never the one the previous board used, so a gallery of
 * boards reads as a series of different walls rather than the same noticeboard
 * photographed again.
 */

/** The two source sets a board can be made from. */
const BOARD_SCOPES = ['dream', 'all'];

/** The horizon whose goals are "dreams". Mirrors GOAL_HORIZONS in the controller. */
const DREAM_HORIZON = 'life';

/** Longest edge ordering, long → short. Also the container-first sort for `all`. */
const HORIZON_ORDER = ['life', 'year', 'quarter', 'week'];

const GOAL_MAX = 24;          // goals fed to the prompt writer
const TITLE_MAX = 120;
const VISION_MAX = 200;
const PROMPT_MAX = 1200;      // the image prompt itself
const HINT_MAX = 200;         // the user's optional "anything to add?"
const FORWARDED_MIN = 24;     // shorter than this and the model didn't really answer

const SCOPE_LABELS = {
    dream: 'Dreams',
    all: 'All goals',
};

const SCOPE_HINTS = {
    dream: 'Only your Life-horizon goals — the ones that read like aims, not tasks.',
    all: 'Every goal you have, dreams included.',
};

/** Goal statuses that never belong in a picture of the future. */
const EXCLUDED_STATUSES = new Set(['failed']);

// ─── Selection ───────────────────────────────────────────────────────────────

/** A goal's horizon, or null. Tolerates both stored shapes (workspace + legacy). */
function goalHorizon(goal) {
    const h = goal?.horizon ?? goal?.data?.horizon;
    return typeof h === 'string' && h ? h : null;
}

function goalStatus(goal) {
    return goal?.status || goal?.data?.status || 'active';
}

function goalTitle(goal) {
    const t = goal?.name || goal?.title || goal?.data?.title || '';
    return String(t).trim();
}

function goalVision(goal) {
    const v = goal?.vision ?? goal?.data?.vision;
    return typeof v === 'string' ? v.trim() : '';
}

/** Priority as a number, tolerating the low/medium/high labels the UI sends. */
function goalPriority(goal) {
    const p = goal?.priority ?? goal?.data?.priority;
    if (typeof p === 'number' && Number.isFinite(p)) return p;
    if (p === 'high') return 90;
    if (p === 'medium') return 50;
    if (p === 'low') return 10;
    return 0;
}

/**
 * Is this a dream? A dream is a goal with the longest horizon — not a separate
 * kind of object, and not a goal that merely mentions the word.
 */
function isDream(goal) {
    return goalHorizon(goal) === DREAM_HORIZON;
}

/**
 * The goals a board of this scope is made from, longest horizon first.
 *
 * `all` is not "dreams plus the rest" by accident: the sort is what makes the
 * board about the life rather than about this week, because the prompt writer
 * receives them in this order and leads with what it reads first.
 *
 * @returns {{goals: Array<{slug: string, title: string, horizon: string|null, vision: string}>, total: number, truncated: number}}
 */
function selectGoalsForBoard(goals, scope = 'dream', { max = GOAL_MAX } = {}) {
    const list = Array.isArray(goals) ? goals : [];
    const wanted = BOARD_SCOPES.includes(scope) ? scope : 'dream';

    const candidates = list.filter((g) => {
        if (!g) return false;
        if (goalTitle(g) === '') return false;
        if (EXCLUDED_STATUSES.has(goalStatus(g))) return false;
        return wanted === 'dream' ? isDream(g) : true;
    });

    const rank = (g) => {
        const i = HORIZON_ORDER.indexOf(goalHorizon(g));
        // No horizon sorts after every named one but before nothing at all: an
        // unlabelled goal is still more concrete than a decade-long aim.
        return i === -1 ? HORIZON_ORDER.length : i;
    };

    const sorted = [...candidates].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        const sa = goalStatus(a) === 'active' ? 0 : 1;
        const sb = goalStatus(b) === 'active' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        const p = goalPriority(b) - goalPriority(a);
        if (p !== 0) return p;
        return goalTitle(a).localeCompare(goalTitle(b));
    });

    const capped = sorted.slice(0, Math.max(1, max));
    return {
        goals: capped.map((g) => ({
            slug: g._id || g.slug || '',
            title: goalTitle(g).slice(0, TITLE_MAX),
            horizon: goalHorizon(g),
            vision: goalVision(g).slice(0, VISION_MAX),
        })),
        total: candidates.length,
        truncated: Math.max(0, candidates.length - capped.length),
    };
}

// ─── The prompt writer ───────────────────────────────────────────────────────

/**
 * What EVERY board is, whatever its look.
 *
 * Two failures are baked into this list, because this feature has made both:
 *
 *   1. The writer was offered "a single photorealistic scene, OR a loose grid of
 *      editorial photographs" and chose the scene — an editorial stock shot of a
 *      family at a laptop. A fine photograph, and not a vision board.
 *   2. The brief then pinned the *craft* of a physical board — cork, pins,
 *      pushpins, washi tape, paper, torn edges, "handmade" — and every board came
 *      back as a prop: a noticeboard photographed on a wall, standing in for a
 *      life. Real vision boards, the ones people actually make and post, are not
 *      that. They are a COLLAGE OF PHOTOGRAPHS, and what is in the pictures is the
 *      point; what they are stuck to was never the point.
 *
 * So: many photographs, one cohesive light and palette, colour doing the work, and
 * nothing holding it up. The light and palette are the look's job — see
 * BOARD_STYLES.
 */
const BOARD_RULES = [
    '- The picture IS a vision and dream board: ONE photo collage of three to six LARGE photographs of',
    '  different sizes, composed to fill the frame and to read together as a single designed picture.',
    '- No two photographs alike, and the same subject never twice: an image model asked for several',
    '  pictures of one life will happily draw the same room over and over.',
    '- The photographs overlap with their edges crossing, some larger than others — never a row or a',
    '  grid of equal tiles, and never a single scene photographed in a take.',
    '- Every photograph is a real, specific thing from the goals — a place, a room, a view, a table, a',
    '  journey, a landscape, an object — said concretely enough to be drawn: what it is, and where.',
    '- One photograph per goal at most, and do not pad the list. Three subjects described richly beat',
    '  ten named in a row, and an image model given a long bare list draws none of them.',
    '- The photographs ARE the whole picture: no border, no frame, no wall, no visible background around',
    '  them, and nothing in the frame holding them up.',
    '- Every photograph shares one light and one colour grade, so the collage reads as one board',
    '  rather than a pile of unrelated pictures.',
    '- Colour and light are the point: bright, alive and aspirational at a glance, never grey or dusty.',
];

/**
 * The looks a board can have. One is chosen per board (see pickBoardStyle).
 *
 * A look is an ART DIRECTION — light, palette and mood — and nothing else. An
 * earlier version of this catalog chose surfaces and craft instead (cork, washi
 * tape, brass pins, torn paper, riso prints), and the boards came back looking
 * like a craft-supply still life rather than a life somebody wants: the props
 * became the subject of the picture. What actually differs between the vision
 * boards people make is their colour and their light, so that is what varies.
 *
 *   `lines`    what the prompt writer is told (light, palette, mood)
 *   `mood`     the same light, short, for the deterministic prompt
 *   `palette`  the colour language, for the deterministic prompt
 *   `keywords` the words in a user's steer that ask for this look by name
 *
 * `keywords` must stay words of MOOD, not of subject ("beach" would force this
 * look on any steer that mentions one) and must not overlap between looks, or
 * every steer would land on whichever look is listed first.
 */
const BOARD_STYLES = [
    {
        id: 'bright-airy',
        name: 'Bright and airy',
        keywords: ['airy', 'minimal', 'clean', 'bright and airy'],
        lines: [
            '- Bright, even daylight and a lot of air: clean, calm and unhurried, with soft white light',
            '  and almost no heavy shadow.',
            '- Palette: white, cream, pale blue and soft sand, with one fresh accent colour.',
        ],
        mood: 'bright, airy daylight in white, cream and pale blue',
        palette: 'white, cream, pale blue and soft sand',
    },
    {
        id: 'golden-warm',
        name: 'Golden warmth',
        keywords: ['golden hour', 'sunlit', 'sunkissed', 'autumn'],
        lines: [
            '- Warm, low golden-hour light across every image: long soft shadows, everything glowing, a',
            '  honey-and-amber colour grade.',
            '- Palette: amber, terracotta, olive and cream — sunlit, generous, relaxed.',
        ],
        mood: 'warm golden-hour light and a honey-and-amber grade',
        palette: 'amber, terracotta, olive and cream',
    },
    {
        id: 'vivid-pop',
        name: 'Vivid pop',
        keywords: ['vivid', 'pop', 'saturated', 'bold colour', 'bold color'],
        lines: [
            '- Vivid and punchy: saturated colour in every image, strong contrast, the energy of a life',
            '  being lived out loud.',
            '- Palette: cobalt blue, scarlet, sunshine yellow and turquoise, all at full strength.',
        ],
        mood: 'vivid saturated colour with strong contrast and high energy',
        palette: 'cobalt, scarlet, sunshine yellow and turquoise',
    },
    {
        id: 'soft-pastel',
        name: 'Soft pastel',
        keywords: ['pastel', 'dreamy', 'gentle', 'pink'],
        lines: [
            '- Soft and dreamy: diffused light, gentle contrast, a quiet and tender feeling.',
            '- Palette: blush pink, lilac, mint and cream.',
        ],
        mood: 'soft diffused light in blush pink, lilac and mint',
        palette: 'blush pink, lilac, mint and cream',
    },
    {
        id: 'evening-city',
        name: 'Evening city',
        keywords: ['evening', 'night', 'city lights', 'dusk', 'neon'],
        lines: [
            '- Evening: blue-hour skies, lit windows and warm points of light against cool shadow, the',
            '  energy of a city at night.',
            '- Palette: deep blue and violet with warm amber windows and a little pink neon.',
        ],
        mood: 'blue-hour evening light, lit windows and warm glow',
        palette: 'deep blue, violet, warm amber and pink neon',
    },
    {
        id: 'coastal',
        name: 'Coastal light',
        keywords: ['coastal', 'seaside', 'turquoise', 'sailing'],
        lines: [
            '- Sea light: hard sun glittering off water, bleached whites and a fresh salt-air feeling.',
            '- Palette: turquoise, deep sea blue, white and warm sand.',
        ],
        mood: 'bright sea light glittering off turquoise water',
        palette: 'turquoise, deep sea blue, white and warm sand',
    },
    {
        id: 'sun-travel',
        name: 'Sun-drenched travel',
        keywords: ['travel', 'holiday', 'vacation', 'tropical', 'faraway'],
        lines: [
            '- Far from home in the best possible light: hard bright sun, hot white walls, water, foreign',
            '  streets and very wide skies.',
            '- Palette: hot white, turquoise, coral and deep blue.',
        ],
        mood: 'hard bright sun on hot white walls, turquoise water and coral',
        palette: 'hot white, turquoise, coral and deep blue',
    },
    {
        id: 'warm-interior',
        name: 'Warm interior',
        keywords: ['interior', 'cosy', 'cozy', 'lamplight'],
        lines: [
            '- Indoors and warm: lamplight, wood, soft furnishing, the feeling of a lived-in home.',
            '- Palette: caramel, walnut, cream and deep green, lit by warm pools of light.',
        ],
        mood: 'warm lamplight indoors, caramel and walnut with deep green',
        palette: 'caramel, walnut, cream and deep green',
    },
    {
        id: 'lush-green',
        name: 'Lush green',
        keywords: ['green', 'plants', 'garden', 'lush', 'foliage'],
        lines: [
            '- Lush and growing: dappled sunlight through leaves, rich greenery, a garden in full summer.',
            '- Palette: emerald, lime, deep forest green and warm terracotta.',
        ],
        mood: 'dappled sunlight through deep green leaves',
        palette: 'emerald, lime, forest green and terracotta',
    },
    {
        id: 'rich-jewel',
        name: 'Rich jewel',
        keywords: ['jewel', 'emerald', 'gold', 'luxurious', 'opulent'],
        lines: [
            '- Rich and deep: saturated jewel tones in low warm light, a sense of luxury and plenty.',
            '- Palette: emerald, sapphire, plum and gold.',
        ],
        mood: 'low warm light over deep emerald, sapphire and gold',
        palette: 'emerald, sapphire, plum and gold',
    },
];

/** How many of the user's recent looks a new board refuses to repeat. */
const STYLE_MEMORY = 6;

function styleById(id) {
    return BOARD_STYLES.find((s) => s.id === id) || null;
}

// The one refusal vocabulary, shared by the style keywords and by the people and
// text rules below — "no text" and "no neon" are the same shape of sentence, and
// two copies of this list is how one of them ends up not knowing the word "nobody".
const REFUSE_WORDS = 'no|without|avoid|nothing|zero|never|not|no more';

// The steer vocabulary, built from the styles themselves so the two can never
// drift: adding a style makes its name askable in the hint field for free.
const STYLE_MATCHERS = BOARD_STYLES.map((style) => ({
    style,
    asked: new RegExp(`\\b(?:${style.keywords.join('|')})\\b`, 'i'),
    // "no neon", "without collage" — the negated form has to be checked first for
    // the same reason it does with people: the phrase contains the keyword.
    refused: new RegExp(`\\b(?:${REFUSE_WORDS})\\b[^.,;!?]{0,24}?\\b(?:${style.keywords.join('|')})\\b`, 'i'),
}));

/** Style ids the steer rules out by name ("no neon", "without collage"). */
function refusedStyleIds(steer) {
    const out = new Set();
    for (const m of STYLE_MATCHERS) if (m.refused.test(steer)) out.add(m.style.id);
    return out;
}

/** The style the steer asked for by name, or null. */
function askedStyleId(steer) {
    for (const m of STYLE_MATCHERS) {
        if (m.refused.test(steer)) continue;
        if (m.asked.test(steer)) return m.style.id;
    }
    return null;
}

/**
 * The look for one new board.
 *
 * A gallery of boards is the feature, so two boards that look identical are a
 * wasted image credit: `recent` is the user's own history (newest first, see the
 * controller) and a board never reuses a look from it while any other look is
 * still available. Past that it is a genuine pick, not a queue — repeating the
 * same eleven boards in the same order would be its own kind of boring.
 *
 * `rand` is injected so this stays pure and testable.
 *
 * @param {{hint?: string, recent?: string[], rand?: () => number}} options
 * @returns {{id: string, name: string, source: 'asked'|'picked', lines: string[], mood: string, palette: string}}
 */
function pickBoardStyle({ hint = '', recent = [], rand = Math.random } = {}) {
    const steer = String(hint || '');

    // Asked for by name: the user's steer wins over the rotation, exactly as it
    // does for the faces and text defaults.
    const asked = askedStyleId(steer);
    if (asked) return { ...styleById(asked), source: 'asked' };

    const refused = refusedStyleIds(steer);
    const pool = BOARD_STYLES.filter((s) => !refused.has(s.id));
    const usable = pool.length ? pool : BOARD_STYLES;

    const history = (Array.isArray(recent) ? recent : []).map((r) => String(r?.id || r || ''));
    const fresh = usable.filter((s) => !history.includes(s.id));
    // Every look in the pool is recent (a long-standing user): then only the
    // previous board is ruled out, and the rest is a free pick.
    const candidates = fresh.length ? fresh : usable.filter((s) => s.id !== history[0]);
    const finalists = candidates.length ? candidates : usable;

    const i = Math.min(finalists.length - 1, Math.floor(Math.abs(rand()) * finalists.length));
    return { ...finalists[i], source: 'picked' };
}

/** Accept a style object, an id, or nothing at all — always answer with a style. */
function resolveBoardStyle(style, hint = '') {
    if (style && typeof style === 'object' && Array.isArray(style.lines)) return style;
    const byId = typeof style === 'string' ? styleById(style) : null;
    return byId || pickBoardStyle({ hint });
}

/**
 * How people may appear.
 *
 * Default is no faces at all. An image model asked for "a family" produces a
 * photorealistic portrait of a specific-looking family, which is exactly what a
 * vision board does not need — the board is about the aims, and an invented face
 * reads as a stock photo of somebody else's life (and, at worst, as a likeness of
 * a real person). Human presence is still available without faces: backs,
 * silhouettes, distance, hands, out-of-focus background.
 */
const PEOPLE_RULE = {
    off: '- NO faces anywhere. Any people are far away, from behind, in silhouette, out of focus, or'
        + ' hands only — never a portrait, never looking at the camera. Prefer empty scenes, places and things.\n'
        + '- Do not choose a subject that NEEDS a face to make sense — "a family around a table", a'
        + ' portrait, a head-and-shoulders shot. Show the room, the food on the table, the hands, the'
        + ' doorway, the view. An image model asked for a family at a table draws faces whatever the'
        + ' rules say, and there is no fix for that later.',
    on: '- People may appear. Keep them generic and unidentifiable — no likeness of any real or famous person.',
};

/** How text may appear: off by default, because lettering renders as garbage. */
const TEXT_RULE = {
    off: '- NO text, letters, numbers, symbols or captions anywhere — the pictures and the arrangement carry it.',
    on: '- The person asked for words: write one or two SHORT handwritten-style phrases (two to four words)'
        + ' across the collage, as if added by hand. Nothing printed, nothing long.',
};

// A steer that names these switches a default off or on. The word lists are
// shared between "is this asked for" and "is this refused" on purpose: the two
// drifting apart is how `no persons` once read as a request for faces, because
// the negation list only knew the singular.
const PEOPLE_WORDS = 'people|person|persons|family|families|faces?|portraits?|children|kids?|woman|women|man|men|couple|friends?|crowd|selfie';
const TEXT_WORDS = 'text|words?|lettering|writing|written|write|handwritten|quotes?|captions?|title|labels?';

const PEOPLE_HINT_RE = new RegExp(`\\b(?:${PEOPLE_WORDS})\\b`, 'i');
const TEXT_HINT_RE = new RegExp(`\\b(?:${TEXT_WORDS})\\b`, 'i');
const PEOPLE_REFUSED_RE = new RegExp(`\\b(?:${REFUSE_WORDS})\\b[^.,;!?]{0,24}?\\b(?:${PEOPLE_WORDS})\\b`, 'i');
const TEXT_REFUSED_RE = new RegExp(`\\b(?:${REFUSE_WORDS})\\b[^.,;!?]{0,24}?\\b(?:${TEXT_WORDS})\\b`, 'i');

/**
 * Read the user's steer for the two defaults it can override.
 *
 * Checking for the *request* rather than trusting the model to weigh a
 * contradiction matters: the brief says "no text" in one line, and a steer that
 * says "with the words 'our beach house'" would otherwise be arguing with it.
 *
 * Refusal is checked per subject, not once for the whole steer, because a
 * perfectly ordinary hint mixes the two ("warm film, no text, a family in the
 * background") — one global "was anything refused" flag would silently cancel the
 * request for the other. And the negated form has to be checked first, since "no
 * people" *contains* the word: reading that as a request for faces would do the
 * exact opposite of what was asked.
 */
function resolveBoardRules(hint = '') {
    const steer = String(hint || '');
    return {
        allowPeople: !PEOPLE_REFUSED_RE.test(steer) && PEOPLE_HINT_RE.test(steer),
        allowText: !TEXT_REFUSED_RE.test(steer) && TEXT_HINT_RE.test(steer),
    };
}

/**
 * The brief handed to the chat model. Schema-free on purpose: the answer is a
 * single paragraph of prose, so asking for JSON would only add a way to fail.
 *
 * Everything the writer may *not* decide for itself is pinned here — the board
 * rules, this board's look, and whether people and words are allowed — because
 * those are the things it got wrong on its own. The user's free-text hint is the
 * only input that changes them (`resolveBoardRules`, `pickBoardStyle`).
 */
function buildVisionBoardPrompt(goals, { scope = 'dream', hint = '', rules, style } = {}) {
    const lines = goals.map((g, i) => {
        const bits = [`${i + 1}. [${g.horizon || 'no horizon'}] ${g.title}`];
        if (g.vision) bits.push(`   in their words: "${g.vision}"`);
        return bits.join('\n');
    });

    const label = SCOPE_LABELS[scope] || SCOPE_LABELS.dream;
    const steer = String(hint || '').trim().slice(0, HINT_MAX);
    const resolved = rules || resolveBoardRules(steer);
    const look = resolveBoardStyle(style, steer);

    return [
        `Write ONE image-generation prompt for these ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'} (source: ${label}).`,
        '',
        'THEIR GOALS:',
        lines.join('\n'),
        '',
        'The prompt you write must follow every one of these rules:',
        '- 45 to 90 words, ONE paragraph, no line breaks, no headings, no labels, no quotes around it.',
        ...BOARD_RULES,
        // The board's look, chosen before the writer was asked. It is stated as an
        // instruction rather than an option, and it is stated ONCE, because the
        // whole point of the styles is that no two boards come back the same.
        `- This board's look, already chosen for it — follow it exactly: ${look.name}.`,
        ...look.lines,
        // Verified against the real model, four times each way: a prompt that OPENS
        // with this shape draws a board of several real photographs, and one that
        // opens any other way does not — it draws a single lovely scene, a colour
        // swatch, or the same building tiled. The writer gets the opening verbatim
        // and spends its freedom on the subjects, which is where the goals are.
        //
        // The name it opens with is deliberate: the product calls this a vision and
        // dream board, so the prompt does too, and the naming rides in the one
        // position whose wording decides the picture — immediately followed by the
        // collage phrase, so the name reads as a description of the collage rather
        // than an instruction to go and fetch a board to pin things to.
        '- Every prompt must call the picture a "vision and dream board", and must open with exactly',
        '  this shape, filled in:',
        '  "A vision and dream board: a bold photo collage filling the frame — large glossy photographs',
        '  of <subjects>, overlapping and layered at slight angles with their edges crossing, <light and',
        '  palette>, photographic."',
        '- The name describes THIS collage of photographs and nothing else — it is not a board the',
        '  photographs are fixed to. Never describe a surface, a material, or an object holding them.',
        '- The subjects are what the goals become, and they must be different KINDS of thing from each',
        '  other — an interior, an exterior, a landscape, a person seen from far away, an object in the',
        '  hand. Five variations of one building is how a board comes back as the same picture five times.',
        '- Turn each goal into a concrete, picturable subject. Use their own words and details.',
        '- Be specific about place, time of day, light, weather and mood.',
        resolved.allowPeople ? PEOPLE_RULE.on : PEOPLE_RULE.off,
        resolved.allowText ? TEXT_RULE.on : TEXT_RULE.off,
        '- No person holds, presents or looks at the collage: the collage IS the picture.',
        '- Do not name the person or the goals in the prompt.',
        steer ? `- The person asked for this as well. Honour it: ${steer}` : '',
        '',
        'Reply with the prompt and nothing else — no preamble, no explanation.',
    ].filter((l) => l !== '').join('\n');
}

/** The system turn for the prompt writer. */
const VISION_BOARD_SYSTEM =
    'You write single-paragraph prompts for a photorealistic AI image model, describing a vision and '
    + 'dream board — a collage of photographs of the life somebody wants — rather than a scene or a '
    + 'still life. You always call it a vision and dream board, and you always describe it as a collage '
    + 'of photographs and nothing else: never a cork board, pins, tape, pegs, paper, frames or any '
    + 'other prop, because those turn a picture of a life into a picture of stationery. Every board has '
    + 'its own light and palette, which you are told: follow the look you are given. You never ask for '
    + 'identifiable faces, and never for text, lettering, logos or borders inside an image unless the '
    + 'person explicitly asked for them, because those render as garbage. You always answer with the '
    + 'prompt alone.';

/**
 * A deterministic prompt used when the model returns something unusable. Not a
 * degraded experience so much as a floor: the goals still become a board, and it
 * is still the right *kind* of picture — the same look the brief asked for, built
 * from the goal titles. The look comes from the same style the brief got, so a
 * fallback board is not the one board in the gallery that looks different.
 */
function fallbackBoardPrompt(goals, scope = 'dream', rules = {}, style) {
    const subjects = (Array.isArray(goals) ? goals : [])
        .map((g) => String(g?.title || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);
    const list = subjects.length ? subjects.join(', ') : 'an open horizon';
    const look = resolveBoardStyle(style);
    const horizon = scope === 'dream'
        ? 'the life they are aiming at'
        : 'everything from this week to a lifetime away';
    const people = rules.allowPeople
        ? 'people kept distant and unidentifiable'
        : 'no faces at all';
    return `A vision and dream board of ${horizon}: a bold photo collage filling the frame — large glossy `
        + `photographs of ${list}, overlapping and layered at slight angles with their edges crossing. `
        + `${look.mood}. Palette: ${look.palette}. ${people}, no text or lettering`;
}

/**
 * Clean up whatever the model produced into something the image model accepts.
 *
 * Models like to help: they wrap the prompt in code fences, prefix it with
 * "Prompt:" and put it in quotes, or add a sentence of commentary. All of that is
 * noise to an image model, and a stray `**` or a trailing "Let me know if you'd
 * like changes!" shows up as odd marks in the picture.
 *
 * @returns {{prompt: string, source: 'model'|'fallback'}}
 */
function normalizeBoardPrompt(raw, goals, scope = 'dream', rules = {}, style) {
    let text = String(raw || '');

    // Fences, then a leading label, then wrapping quotes — in that order, since
    // each one can expose another.
    text = text.replace(/```[a-z]*/gi, ' ').replace(/```/g, ' ');
    text = text.replace(/^\s*(?:here(?:'s| is)[^:\n]*|prompt|image prompt|final prompt)\s*[:\-]\s*/i, '');
    text = text.replace(/^\s*["'“”]+|["'“”]+\s*$/g, '');
    // Markdown emphasis that would otherwise become literal punctuation in the
    // prompt's semantics ("a **small** boat").
    text = text.replace(/\*\*|__|`/g, '');
    // Drop a trailing offer to help, which is a reply to the user and not part of
    // the prompt: it is nearly always the last sentence and always starts this way.
    text = text.replace(/\s*(?:let me know|would you like|if you(?:'d| would) like|feel free)[^.?!]*[.?!]?\s*$/i, '');
    text = text.replace(/\s+/g, ' ').trim();
    // A model that answered in bullets or with a heading left pipes/newlines
    // behind; a bare leading dash reads as part of the scene.
    text = text.replace(/^[-–—•\s]+/, '').trim();

    if (text.length > PROMPT_MAX) {
        const cut = text.slice(0, PROMPT_MAX);
        // Prefer a sentence end over a clause end, and both over a hard cut
        // mid-word — but only when the break lands in the last stretch of the
        // text, or the "break" would throw away half the answer to gain a
        // tidier ending.
        const dot = cut.lastIndexOf('. ');
        const comma = cut.lastIndexOf(', ');
        const stop = Math.max(dot, comma);
        if (stop > PROMPT_MAX * 0.6) {
            text = cut.slice(0, dot === stop ? stop + 1 : stop);
        } else {
            text = cut;
        }
        // A trailing comma or colon reads as a truncated thought; a full stop
        // reads as a finished one, so only the punctuation that hurts is
        // dropped.
        text = text.replace(/[\s,;:]+$/, '');
    }

    if (text.length < FORWARDED_MIN) {
        return { prompt: fallbackBoardPrompt(goals, scope, rules, style), source: 'fallback' };
    }
    // Belt and braces: a model that ignored the brief and asked for faces or
    // lettering anyway is answered by the negative prompt, which follows the same
    // rules (see boardNegativePrompt) rather than a fixed list.
    return { prompt: text, source: 'model' };
}

// ─── The negative prompt ─────────────────────────────────────────────────────
// Verified against the real model (Stability SD3.5 Large, 2026-09-15), because
// what goes in here is not obvious and the wrong thing does real damage:
//
//   • A long, conceptual negative list — frames, walls, props, "clutter" — does
//     not subtract those things. It takes over the guidance, and the picture stops
//     being the prompt at all: the same photo-collage prompt that had been drawing
//     four-photograph boards of a life came back as a rigid grid of one building,
//     and then as a blue mountain, as the denials grew.
//   • A SHORT denial of the things that render as marks rather than pictures —
//     lettering above all — costs nothing.
//   • Refusing faces is also safe (tested on its own, with the collage intact and
//     the people in it seen from behind or at a distance), and it is needed: the
//     positive rule alone does not stop an image model drawing a face, and a
//     board should not be a portrait of somebody who does not exist.

/** Watermarks and signatures are refused however the user steered: a signed photograph is not a board. */
const NEGATIVE_MARKS = 'watermark, signature, logo';
const NEGATIVE_TEXT = 'text, words, numbers, letters';
const NEGATIVE_FACES = 'faces, portraits';

/**
 * The negative prompt for a board, built from the resolved rules.
 *
 * Short by design: see the note above. Everything else the brief says in the
 * positive — a prop or a composition is kept out by describing a picture that has
 * no room for it, not by naming it here.
 *
 * @param {{allowText?: boolean, allowPeople?: boolean}} rules
 */
function boardNegativePrompt({ allowText = false, allowPeople = false } = {}) {
    return [
        allowText ? '' : NEGATIVE_TEXT,
        allowPeople ? '' : NEGATIVE_FACES,
        NEGATIVE_MARKS,
    ].filter(Boolean).join(', ');
}

/** A board is landscape — it is a desktop wallpaper, a header, a wall of a life. */
const BOARD_ASPECT_RATIO = '16:9';

// ─── The record ──────────────────────────────────────────────────────────────

/** Human name for a board, shown in the gallery. */
function boardName(scope) {
    return scope === 'all' ? 'Vision board — all goals' : 'Vision board — dreams';
}

/**
 * A slug the workspace store accepts (`^[a-z0-9][a-z0-9_-]{0,99}$`), unique per
 * board: two boards of the same scope in the same second must not overwrite each
 * other, so a short suffix is part of the name rather than a retry loop.
 */
function boardSlug(at, scope, rand = '') {
    const iso = String(at || new Date().toISOString());
    const compact = iso.replace(/[-:]/g, '').replace(/\.\d+Z?$/, 'Z').replace('T', '-').replace('Z', '');
    const tail = String(rand || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
    const kind = scope === 'all' ? 'all' : 'dreams';
    return `board-${compact}-${kind}${tail ? `-${tail}` : ''}`.toLowerCase();
}

/**
 * The stored payload. Everything needed to render the gallery from a single list
 * read, plus the honest record of what it was made from: which goals, in which
 * order, and the prompt that was actually sent — so "why does my board look like
 * that" is answerable months later.
 */
function buildBoardRecord({
    scope,
    goals,
    prompt,
    promptSource = 'model',
    hint = '',
    rules = {},
    style,
    negativePrompt,
    url,
    s3Key,
    bytes,
    recordId,
    aspects = {},
    at,
    userAgent,
}) {
    const look = resolveBoardStyle(style, String(hint || ''));
    return {
        version: 1,
        scope,
        source: {
            total: aspects.total ?? goals.length,
            used: goals.length,
            truncated: aspects.truncated || 0,
            goals: goals.map((g) => ({ slug: g.slug, title: g.title, horizon: g.horizon || null })),
        },
        prompt,
        promptSource,
        hint: String(hint || '').slice(0, HINT_MAX),
        // Which of the looks this board got, by id and by name. The id is what
        // the next board avoids repeating; the name is what the gallery shows,
        // because "why are they all the same" and "which one was the riso one"
        // are the two questions a history of boards has to answer.
        style: { id: look.id, name: look.name },
        // What the steer actually switched on, so a board that came back with a
        // face in it is explainable: the user asked for one, and the record says so.
        rules: {
            allowPeople: !!rules.allowPeople,
            allowText: !!rules.allowText,
        },
        negativePrompt: negativePrompt || boardNegativePrompt(rules),
        aspectRatio: BOARD_ASPECT_RATIO,
        model: aspects.model || null,
        seed: aspects.seed ?? null,
        image: { url, s3Key, bytes, recordId: recordId || null },
        generatedAt: at || new Date().toISOString(),
        ...(userAgent ? { via: userAgent } : {}),
    };
}

module.exports = {
    BOARD_SCOPES,
    BOARD_ASPECT_RATIO,
    BOARD_RULES,
    BOARD_STYLES,
    STYLE_MEMORY,
    DREAM_HORIZON,
    GOAL_MAX,
    PROMPT_MAX,
    HINT_MAX,
    SCOPE_LABELS,
    SCOPE_HINTS,
    VISION_BOARD_SYSTEM,
    isDream,
    selectGoalsForBoard,
    resolveBoardRules,
    pickBoardStyle,
    resolveBoardStyle,
    boardNegativePrompt,
    buildVisionBoardPrompt,
    fallbackBoardPrompt,
    normalizeBoardPrompt,
    boardName,
    boardSlug,
    buildBoardRecord,
};
