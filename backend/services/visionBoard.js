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
 * This is the whole answer to "make it look like the vision boards people post
 * online", and it is spelled out rather than gestured at because the first
 * version of this feature did not have it: the model was offered "a single scene
 * OR a grid of photographs", chose the scene, and produced an editorial stock
 * photograph of a family at a laptop — a fine picture, and not a vision board.
 *
 * What is *not* here is the surface, the palette or the arrangement — those are
 * the style's job (see BOARD_STYLES). They used to live here as one fixed answer
 * ("cork / linen pinboard / pale paper", "calm, soft and neutral"), which is
 * exactly why every board came back as the same dusty noticeboard. Picture count
 * is 6–10 on purpose — a real board is not a mosaic, and at 16:9 each piece has
 * to stay big enough to be legible as *something*.
 */
const BOARD_RULES = [
    '- The picture IS a handmade vision board filling the whole frame: a physical surface covered in',
    '  pictures — not one scene photographed in a take, and not a neat wall of equal thumbnails.',
    '- 6 to 10 separate pictures of different sizes: two or three larger pieces carrying the main aims,',
    '  smaller ones filling the gaps, with the surface showing between them.',
    '- Use the whole surface, evenly: pieces spread across the frame in portrait and landscape, with no',
    '  large empty area left on one side. A corner-clustered board with half the surface bare is a miss.',
    '- The board itself reaches every edge of the frame — no wall, margin, table or room visible around',
    '  it, and no straight-on "photograph of a board on a wall" framing.',
    '- Show the craft: hand-placed pieces, slightly imperfect, with a soft shadow under each one so it',
    '  reads as pinned, taped or pegged on rather than pasted flat.',
    '- Colour and light are the point. This is a poster of a life somebody wants: bright, alive and',
    '  full of energy at a glance, never grey, dusty or moody.',
    '- Each piece shows ONE concrete thing — a place, a moment, a room, a view, a thing — simple and',
    '  legible rather than a busy composite.',
];

/**
 * The looks a board can have. One is chosen per board (see pickBoardStyle).
 *
 * This catalog exists because the fixed look was the complaint: every board was
 * the same warm noticeboard, so a gallery of them read as one picture repeated.
 * A board is *supposed* to look like the person's own wall, and no two people's
 * walls look alike — so a board now gets a surface, a palette, a way of treating
 * the pictures and an arrangement, drawn from this list and never the one the
 * last board used.
 *
 * Every style obeys BOARD_RULES and the people/text rules on top; the styles only
 * decide the four things that make boards look different from each other:
 *
 *   `lines`    what the prompt writer is told (surface, palette, arrangement)
 *   `fallback` the same surface, short, for the deterministic prompt
 *   `craft`    how the pieces are held on, for the deterministic prompt
 *   `palette`  the colour language, for the deterministic prompt
 *   `keywords` the words in a user's steer that ask for this style by name
 *
 * `keywords` must stay SPECIFIC. "film", "warm" and "photography" are how people
 * describe a mood, not a request for one particular board, so they belong to no
 * style; a keyword that swallowed them would hijack the steer it appears in.
 */
const BOARD_STYLES = [
    {
        id: 'sunny-grid',
        name: 'Sunny grid',
        keywords: ['grid', 'pegboard', 'checkerboard'],
        lines: [
            '- The board is a clean white pegboard with a soft grey grid, and the light is bright and even.',
            '- Lay the pieces out as a cheerful grid that breaks its own rules: mostly rows and columns, with',
            '  two or three tiles knocked off-axis by a few degrees and small tiles wedged into the gaps.',
            '- Palette: bold primary red, yellow and blue, a rounded colour-block shape behind some pieces,',
            '  and bright plastic clips instead of pins.',
        ],
        fallback: 'a bright white pegboard in clean even daylight',
        craft: 'rounded paper edges, bright plastic clips and colour-block shapes',
        palette: 'bold primary red, yellow and blue on white',
    },
    {
        id: 'cork-classic',
        name: 'Cork & brass',
        keywords: ['cork', 'pinboard', 'noticeboard'],
        lines: [
            '- The board is warm honey-coloured cork with visible grain, lit by low golden afternoon sun.',
            '- Scatter the pieces at playful angles, overlapping two or three deep, and tuck small extras',
            '  into the gaps: a coloured paper scrap, a fabric swatch, a pressed leaf, a strip of washi tape.',
            '- Palette: terracotta, marigold, olive and dusty blue against the cork, with creamy white',
            '  borders around every photograph.',
        ],
        fallback: 'a warm honey-coloured cork pinboard in low golden light',
        craft: 'white photo borders, washi tape, brass pins and pressed leaves',
        palette: 'terracotta, marigold and olive against warm cork',
    },
    {
        id: 'riso-pop',
        name: 'Riso pop',
        keywords: ['riso', 'risograph', 'duotone', 'screenprint', 'screen print', 'fluorescent'],
        lines: [
            '- The board is a huge sheet of chartreuse paper and every piece on it is a bold two-ink',
            '  risograph-style print: flat fluorescent pink and electric blue, visible misregistration,',
            '  coarse halftone dots, prints overlapping each other like a screen-printed poster.',
            '- Compose it like a loud graphic poster: big prints butting edge to edge, one diagonal band',
            '  cutting across the sheet, two solid colour shapes sitting behind the layers.',
            '- Palette: fluorescent pink, electric blue, chartreuse and black. High contrast, flat, no',
            '  soft neutrals anywhere.',
        ],
        fallback: 'a big chartreuse sheet printed with fluorescent pink and electric blue ink',
        craft: 'deckled print edges, coarse halftone texture and striped tape',
        palette: 'fluorescent pink, electric blue and chartreuse',
    },
    {
        id: 'watercolour',
        name: 'Watercolour wash',
        keywords: ['watercolour', 'watercolor', 'water-colour', 'gouache', 'painterly', 'ink sketch'],
        lines: [
            '- The board is a sheet of heavyweight textured watercolour paper washed with wet pigment:',
            '  indigo, turquoise and marigold bleeding into each other, salt blooms blooming at the edges.',
            '- Paint loose ink-and-wash sketches, and pin a few real photographs among them; some pieces are',
            '  deliberately unfinished, one or two held with torn masking tape.',
            '- The washes reach every corner and the colours glow through the paper; nothing is grey or bare.',
        ],
        fallback: 'heavyweight watercolour paper washed with glowing wet pigment',
        craft: 'soft paper edges, torn masking tape and watercolour blooms',
        palette: 'indigo, turquoise, coral and marigold washes',
    },
    {
        id: 'neon-night',
        name: 'Neon night',
        keywords: ['neon', 'glow', 'glowing', 'holographic', 'midnight', 'iridescent'],
        lines: [
            '- The board is deep midnight blue and it glows: every piece is lit from within, bright against',
            '  the dark, like windows shining in a city at night. Thin ribbons of neon light run between them.',
            '- Arrange the pieces like a constellation — a loose spiral of pictures radiating out from one',
            '  large central piece, glowing threads and tiny points of light connecting them.',
            '- Palette: hot pink, cyan and violet neon with warm amber windows, holographic foil and',
            '  iridescent tape catching the light everywhere.',
        ],
        fallback: 'a deep midnight-blue board lit by neon, every piece glowing',
        craft: 'clean cut edges, iridescent tape and glowing thread between the pieces',
        palette: 'hot pink, cyan and violet neon glowing out of midnight blue',
    },
    {
        id: 'magazine-pop',
        name: 'Magazine pop',
        keywords: ['magazine', 'collage', 'cut-out', 'cutout', 'glossy', 'tear sheet'],
        lines: [
            '- The board is built from overlapping torn glossy magazine sheets laid over big flat blocks of',
            '  red, cobalt and yellow paint, so the surface itself is as loud as the pictures on it.',
            '- Cut the pieces out by hand and let them collide: sharp diagonal overlaps, one huge piece',
            '  running off the edge of the frame, a spray of small cut shapes and coloured dots.',
            '- Palette: saturated primaries and glossy full-colour prints. No headlines, no mastheads,',
            '  no brand marks — only pictures and flat colour.',
        ],
        fallback: 'a collage of torn glossy magazine sheets over flat blocks of bright paint',
        craft: 'hand-cut glossy sheet edges, torn paper and glued colour blocks',
        palette: 'cobalt, scarlet and sunflower yellow colour blocks',
    },
    {
        id: 'polaroid-garland',
        name: 'Polaroid garland',
        keywords: ['polaroid', 'polaroids', 'instant film', 'bunting', 'garland', 'peg', 'pegs', 'twine'],
        lines: [
            '- The board is a party: two criss-crossing lines of baker\'s twine strung across pale cream',
            '  paper, with instant-film polaroids pegged along them in a shallow arc, a few hanging crooked.',
            '- Fill the space around the lines with small pegged prints, taped squares of colour, paper',
            '  bunting and tiny flags, so no area of the board is left bare.',
            '- Palette: sunny pastels — mint, peach, lemon and sky blue — with bright primary confetti.',
        ],
        fallback: 'pale cream paper strung with twine and pegged instant-film photographs',
        craft: 'thick instant-film borders, wooden pegs on twine and taped paper flags',
        palette: 'mint, peach, lemon and sky blue with bright confetti',
    },
    {
        id: 'terrazzo',
        name: 'Terrazzo confetti',
        keywords: ['terrazzo', 'confetti', 'speckled'],
        lines: [
            '- The board is pale terrazzo — a smooth surface speckled with chips of coral, cobalt, mint and',
            '  ochre — and the pieces sit on it like a joyful scatter of confetti.',
            '- Scatter the pieces outward from a loose centre in every direction, each at its own rotation,',
            '  with punched paper circles, washi dots and a few tiny frames filling the gaps.',
            '- Palette: coral, cobalt, mint, ochre and white — cheerful, matte, evenly bright across the frame.',
        ],
        fallback: 'a pale speckled terrazzo surface scattered with colour',
        craft: 'matte paper edges, washi-tape corners and punched confetti circles',
        palette: 'coral, cobalt, mint and ochre confetti on pale stone',
    },
    {
        id: 'golden-film',
        name: 'Golden film',
        keywords: ['light leak', 'light leaks', 'analog', 'analogue', 'kodak', 'portra', 'sun-bleached'],
        lines: [
            '- The board is sun-faded linen under late golden light — warm, glowing, with a soft grain over',
            '  everything like a much-loved film photograph.',
            '- Layer warm prints densely, overlapping and slightly off-square, held with wooden pegs, twine,',
            '  kraft tape and a couple of dried flower sprigs tucked behind the edges.',
            '- Palette: honey, amber, burnt orange and deep green, with real light leaks burning in at the',
            '  edges of a few pieces.',
        ],
        fallback: 'sun-faded linen under late golden light, warm and grainy',
        craft: 'warm film grain, kraft tape, wooden pegs and dried flowers',
        palette: 'honey, amber, burnt orange and deep green',
    },
    {
        id: 'greenhouse',
        name: 'Greenhouse',
        keywords: ['greenhouse', 'botanical', 'plant', 'plants', 'leaves', 'foliage', 'garden', 'jungle'],
        lines: [
            '- The board is painted deep emerald green and alive with plants: leaves and fronds pressed flat',
            '  across it and hanging over the edges of the pieces.',
            '- The pieces climb the frame like a vine — a vertical, organic arrangement that leans and curves',
            '  upward, with pressed leaves, seed heads and small terracotta details filling every gap.',
            '- Palette: emerald, lime, jade and terracotta, with bright white paper edges cutting through',
            '  the green.',
        ],
        fallback: 'a deep emerald board overgrown with pressed leaves',
        craft: 'pressed leaves, deckled paper edges and twine',
        palette: 'emerald, lime and terracotta against deep green',
    },
    {
        id: 'cosmic',
        name: 'Cosmic dream',
        keywords: ['cosmic', 'galaxy', 'nebula', 'stars', 'starry', 'aurora', 'space'],
        lines: [
            '- The board is deep indigo dusted with stars, and the pieces orbit one large central picture,',
            '  spiralling outward like a galaxy, trailing iridescent foil and star-shaped confetti.',
            '- Make the arrangement obviously orbital: concentric rings, pieces set at different angles,',
            '  stardust and fine glitter scattered right across the surface.',
            '- Palette: indigo, magenta, teal and gold, with a shimmer on everything.',
        ],
        fallback: 'a deep indigo board dusted with stars and iridescent foil',
        craft: 'clean cut edges, foil stars and fine glitter',
        palette: 'indigo, magenta, teal and gold',
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
 * @returns {{id: string, name: string, source: 'asked'|'picked', lines: string[], fallback: string, craft: string, palette: string}}
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
        + ' hands only — never a portrait, never looking at the camera. Prefer empty scenes, places and things.',
    on: '- People may appear. Keep them generic and unidentifiable — no likeness of any real or famous person.',
};

/** How text may appear: off by default, because lettering renders as garbage. */
const TEXT_RULE = {
    off: '- NO text, letters, numbers, symbols or captions anywhere — the pictures and the arrangement carry it.',
    on: '- The person asked for words: add one or two SHORT handwritten-style phrases (two to four words)'
        + ' on torn paper or a sticky note, as if written by hand. Nothing printed, nothing long.',
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
        '- Begin with the board itself — its surface and how the pictures are arranged — then describe',
        '  what is inside the pieces. An image model weights the opening words hardest.',
        '- Turn each goal into a concrete, picturable subject. Use their own words and details.',
        '- Be specific about place, time of day, light, weather, materials and mood.',
        resolved.allowPeople ? PEOPLE_RULE.on : PEOPLE_RULE.off,
        resolved.allowText ? TEXT_RULE.on : TEXT_RULE.off,
        '- Never show a person holding, presenting or looking at the board: the board is the picture.',
        '- Do not name the person, the goals, or the words "vision board" in the prompt.',
        '- Do not ask for a frame, a border, or a mock-up of a poster on a wall.',
        steer ? `- The person asked for this as well. Honour it: ${steer}` : '',
        '',
        'Reply with the prompt and nothing else — no preamble, no explanation.',
    ].filter((l) => l !== '').join('\n');
}

/** The system turn for the prompt writer. */
const VISION_BOARD_SYSTEM =
    'You write single-paragraph prompts for a photorealistic AI image model, describing a handmade '
    + 'vision board — a physical surface covered in pictures — rather than a single scene. Every board '
    + 'has its own look, which you are told: follow the look you are given rather than falling back on '
    + 'cork and pins. You never ask for identifiable faces, and never for text, lettering, logos or '
    + 'borders inside an image unless the person explicitly asked for them, because those render as '
    + 'garbage. You always answer with the prompt alone.';

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
    const frame = scope === 'dream'
        ? `${look.fallback}, carrying the life being aimed at`
        : `${look.fallback}, from this week to a lifetime away`;
    const people = rules.allowPeople
        ? 'people kept distant and unidentifiable'
        : 'no faces at all';
    return `A handmade vision board filling the frame: ${frame}, covered in six to ten overlapping `
        + `pictures of different sizes, ${look.craft}, the surface showing between the pieces. `
        + `The pictures show ${list}, in ${look.palette}. ${people}, no text or lettering`;
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

// The negative prompt is the second half of the two defaults: the brief asks, the
// negative prompt forbids, and both are built from the same resolved rules so a
// user who *wants* a face or a handwritten word is not fighting the safety net.
const NEGATIVE_TEXT = 'text, lettering, words, numbers, captions, signage';
const NEGATIVE_MARKS = 'watermark, signature, logo, brand logo, product placement, stock photo watermark';
// A likeness of a real person is refused whoever the subject is: allowing people
// is not the same as asking for a face that belongs to somebody.
const NEGATIVE_LIKENESS = 'celebrity likeness, likeness of a real person';
// Dropped only when the user asked for people.
const NEGATIVE_ANONYMITY = 'identifiable faces, portrait, close-up face, looking at camera, '
    + 'stock-photo family, corporate headshot';
// Quality terms that apply whatever the user asked for. "distorted faces" and
// "deformed hands" only mean anything when hands or faces could appear, and a
// negative prompt that names something the scene cannot contain is spent tokens —
// but it is cheap, and dropping it invites a mangled face the moment the steer
// asks for people.
const NEGATIVE_ALWAYS = 'low quality, blurry, distorted faces, extra limbs, deformed hands, cluttered, noisy';

/**
 * The negative prompt for a board, built from the resolved rules.
 *
 * @param {{allowText?: boolean, allowPeople?: boolean}} rules
 */
function boardNegativePrompt({ allowText = false, allowPeople = false } = {}) {
    return [
        allowText ? '' : NEGATIVE_TEXT,
        NEGATIVE_MARKS,
        allowPeople ? '' : NEGATIVE_ANONYMITY,
        NEGATIVE_LIKENESS,
        'poster, mock-up, picture frame, border',
        NEGATIVE_ALWAYS,
    ].filter(Boolean).join(', ');
}

/** A board is landscape — it is a wall, a desktop, a header. */
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
