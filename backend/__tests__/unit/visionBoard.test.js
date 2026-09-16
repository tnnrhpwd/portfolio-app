/**
 * Vision board — the pure half.
 *
 * What is worth asserting here is not "the function returns a string" but the
 * decisions a vision board gets wrong in practice: a dream is a Life-horizon
 * goal (not every goal), `all` still leads with the long horizons, the prompt
 * writer is told twice not to ask for text, a model answer that is really a
 * chat reply ("Here's the prompt: … Let me know if you'd like changes!") is
 * cleaned into something an image model can use instead of being passed through
 * with its commentary attached, and **no two boards get the same look** — the
 * complaint that every board came back as the same dusty cork noticeboard.
 */

const {
    BOARD_SCOPES,
    BOARD_ASPECT_RATIO,
    BOARD_RULES,
    BOARD_STYLES,
    STYLE_MEMORY,
    SCOPE_LABELS,
    isDream,
    selectGoalsForBoard,
    buildVisionBoardPrompt,
    fallbackBoardPrompt,
    normalizeBoardPrompt,
    resolveBoardRules,
    pickBoardStyle,
    resolveBoardStyle,
    boardNegativePrompt,
    boardName,
    boardSlug,
    buildBoardRecord,
} = require('../../services/visionBoard');

const goal = (over = {}) => ({
    _id: 'g',
    kind: 'goal',
    name: 'A goal',
    status: 'active',
    priority: 50,
    horizon: null,
    vision: '',
    ...over,
});

const dream = (over = {}) => goal({ horizon: 'life', ...over });

describe('visionBoard · scope', () => {
    test('a dream is a Life-horizon goal, and only that', () => {
        expect(isDream(dream())).toBe(true);
        expect(isDream(goal({ horizon: 'year' }))).toBe(false);
        expect(isDream(goal({ horizon: 'week' }))).toBe(false);
        // Unset is a real state, not a dream.
        expect(isDream(goal())).toBe(false);
        // Tolerates the legacy memory shape, where fields sit under `data`.
        expect(isDream({ data: { title: 'x', horizon: 'life' } })).toBe(true);
    });

    test('dream scope takes only Life goals; all scope takes everything', () => {
        const goals = [
            dream({ _id: 'a', name: 'Retire by the coast' }),
            goal({ _id: 'b', name: 'Ship the portfolio', horizon: 'quarter' }),
            goal({ _id: 'c', name: 'Tidy the shed' }),
        ];
        expect(selectGoalsForBoard(goals, 'dream').goals.map((g) => g.slug)).toEqual(['a']);
        expect(selectGoalsForBoard(goals, 'all').goals.map((g) => g.slug)).toEqual(['a', 'b', 'c']);
    });

    test('all scope leads with the longest horizons, then active, then priority', () => {
        const goals = [
            goal({ _id: 'week', name: 'This week thing', horizon: 'week' }),
            goal({ _id: 'life-paused', name: 'Paused dream', horizon: 'life', status: 'paused' }),
            goal({ _id: 'life-high', name: 'Dream A', horizon: 'life', priority: 90 }),
            goal({ _id: 'life-low', name: 'Dream B', horizon: 'life', priority: 10 }),
            goal({ _id: 'none', name: 'Unlabelled' }),
        ];
        expect(selectGoalsForBoard(goals, 'all').goals.map((g) => g.slug))
            .toEqual(['life-high', 'life-low', 'life-paused', 'week', 'none']);
    });

    test('a board is not made of failures, and a goal with no title is not a subject', () => {
        const goals = [
            dream({ _id: 'ok', name: 'A real aim' }),
            dream({ _id: 'dead', name: 'Abandoned', status: 'failed' }),
            dream({ _id: 'blank', name: '   ' }),
        ];
        expect(selectGoalsForBoard(goals, 'dream').goals.map((g) => g.slug)).toEqual(['ok']);
    });

    test('the list is capped, and the cap is reported rather than hidden', () => {
        const goals = Array.from({ length: 30 }, (_, i) => dream({ _id: `g${i}`, name: `Aim ${i}` }));
        const selection = selectGoalsForBoard(goals, 'dream', { max: 24 });
        expect(selection.goals).toHaveLength(24);
        expect(selection.total).toBe(30);
        expect(selection.truncated).toBe(6);
    });

    test('each goal carries the user\'s own words, trimmed to a usable length', () => {
        const long = 'x'.repeat(500);
        const selection = selectGoalsForBoard([
            dream({ _id: 'a', name: '  Retire by the coast  ', vision: `  ${long}  ` }),
        ], 'dream');
        expect(selection.goals[0].title).toBe('Retire by the coast');
        expect(selection.goals[0].vision).toHaveLength(200);
    });

    test('an unknown scope degrades to dreams rather than to everything', () => {
        const goals = [dream({ _id: 'a', name: 'Aim' }), goal({ _id: 'b', name: 'Chore', horizon: 'week' })];
        expect(selectGoalsForBoard(goals, 'nonsense').goals.map((g) => g.slug)).toEqual(['a']);
    });
});

describe('visionBoard · the prompt writer', () => {
    const goals = [
        { slug: 'a', title: 'Retire by the coast', horizon: 'life', vision: 'long walks, a small boat, no alarm clock' },
        { slug: 'b', title: 'Ship the portfolio site', horizon: 'quarter', vision: '' },
    ];

    test('the brief carries the goals, their horizons and the user\'s own words', () => {
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream' });
        expect(prompt).toContain('Retire by the coast');
        expect(prompt).toContain('long walks, a small boat, no alarm clock');
        expect(prompt).toContain('[quarter] Ship the portfolio site');
        expect(prompt).toMatch(/ONE image-generation prompt/);
    });

    test('it asks for no text in the image, twice', () => {
        const prompt = buildVisionBoardPrompt(goals, { scope: 'all' });
        expect(prompt).toMatch(/NO text, letters, numbers, symbols or captions/);
        // …and the negative prompt is the backstop for a model that ignores it.
        expect(boardNegativePrompt()).toMatch(/text, words, numbers, letters/);
        expect(boardNegativePrompt()).toMatch(/watermark/);
    });

    test('the picture asked for is a photo collage, not one scene', () => {
        // The first version of this feature offered "a single scene OR a grid" and
        // got an editorial stock photograph of a family at a laptop: a fine
        // picture, and not a vision board.
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream' });
        expect(prompt).toMatch(/The picture IS a vision board: ONE photo collage/);
        expect(prompt).toMatch(/three to six LARGE photographs/);
        expect(prompt).toMatch(/A bold photo collage filling the frame: large glossy photographs of/);
        // …and the scene option is gone.
        expect(prompt).not.toMatch(/either a single photorealistic scene/);
        // Still a collage of several photographs, never a lone scene or a tidy
        // grid: that is the failure this rule was written for, and removing the
        // props must not remove the thing that makes it a board.
        expect(prompt).toMatch(/never a single scene photographed in a take/);
        expect(prompt).toMatch(/never a row or a\s+grid of equal tiles/);
        // The count is deliberately small: an image model given a long bare list of
        // subjects draws none of them (verified against the real model), so the
        // writer is told to describe a handful richly instead.
        expect(prompt).toMatch(/Three subjects described richly beat/);
    });

    // The complaint that produced this list: every board came back as a noticeboard
    // photographed on a wall — cork, pins, washi tape, paper scraps — with the props
    // as the subject of the picture. A vision board is what is IN the photographs.
    const PROPS = /\bcork\b|pinboard|corkboard|bulletin board|push ?pin|thumbtack|\bpins?\b|\btape\b|washi|\bpegs?\b|twine|\bstring\b|scrapbook|sticker|\bglitter\b|\bfoil\b|\blinen\b|kraft paper|\bpaper\b|torn edge|deckled|halftone|mock-up|picture frame/i;

    test('the brief asks for no props, in the rules or in any look', () => {
        expect(BOARD_RULES.join(' ')).not.toMatch(PROPS);
        for (const style of BOARD_STYLES) {
            // The look is light, palette and mood only. A prop here is how the
            // stationery became the subject of the picture.
            expect(`${style.id} ${style.name} ${style.lines.join(' ')} ${style.mood} ${style.palette}`)
                .not.toMatch(PROPS);
        }
        // …and it holds for the brief that is actually sent, whichever look it got.
        for (const style of BOARD_STYLES) {
            const sent = buildVisionBoardPrompt(goals, { scope: 'dream', style: style.id });
            expect(sent.slice(sent.indexOf('The prompt you write must follow'))).not.toMatch(PROPS);
        }
    });

    test('the negative prompt is short, and describes no concepts', () => {
        // ⚠️ Verified against the real model: a long negative list does not
        // subtract what it names — it takes over the guidance. The same collage
        // prompt that drew a four-photograph board of a life came back as a grid of
        // one building, and then as a blue mountain, as the denials grew. The
        // negative prompt is for what renders as garbage (lettering, watermarks),
        // and nothing else belongs in it.
        for (const rules of [{}, { allowPeople: true }, { allowText: true }, { allowPeople: true, allowText: true }]) {
            const terms = boardNegativePrompt(rules).split(',').map((t) => t.trim());
            expect(terms.length).toBeLessThanOrEqual(9);
            // No props, no places, no colours, no rooms: nothing a picture could
            // be built out of, only the marks of a photograph that is not a board.
            expect(boardNegativePrompt(rules)).not.toMatch(PROPS);
        }
        // A user who asked for people and for words keeps both; the marks still go.
        expect(boardNegativePrompt({ allowPeople: true, allowText: true })).toBe('watermark, signature, logo');
    });

    test('the brief carries this board\'s look, by name and in detail', () => {
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', style: 'vivid-pop' });
        expect(prompt).toMatch(/already chosen for it — follow it exactly: Vivid pop/);
        // Light and palette, and nothing else: the look is an art direction.
        expect(prompt).toMatch(/saturated colour in every image/);
        expect(prompt).toMatch(/cobalt blue, scarlet, sunshine yellow and turquoise/);
        // The system turn has to know a look is always given, or the writer reaches
        // for the cork board that "vision board" means to it.
        expect(require('../../services/visionBoard').VISION_BOARD_SYSTEM)
            .toMatch(/Every board has its own light and palette, which you are told/);
        expect(require('../../services/visionBoard').VISION_BOARD_SYSTEM)
            .toMatch(/never a cork board, pins, tape, pegs, paper/);
    });

    test('the writing brief is not the place the look is decided', () => {
        // The surface, palette and arrangement used to be pinned here as one fixed
        // answer ("cork / linen pinboard / pale paper", "calm, soft and neutral") —
        // which is why every board came back as the same dusty noticeboard.
        expect(BOARD_RULES.join(' ')).not.toMatch(/cork/);
        expect(BOARD_RULES.join(' ')).not.toMatch(/calm, soft and neutral/);
        // What is left is the part every board shares, colour included: that old
        // line asking for a neutral board was half the reason the boards were dull.
        expect(BOARD_RULES.join(' ')).toMatch(/Colour and light are the point/);
    });

    test('no faces by default, and the rule says how to include people anyway', () => {
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream' });
        expect(prompt).toMatch(/NO faces anywhere/);
        expect(prompt).toMatch(/never a portrait, never looking at the camera/);
        // A face-free board still needs a way to show human life.
        expect(prompt).toMatch(/silhouette, out of focus, or\s+hands only/);
        // …and the negative prompt names the face, because the positive rule alone
        // does not stop an image model drawing one. (Verified in isolation: this
        // denial leaves the collage intact, unlike a long list of props.)
        expect(boardNegativePrompt()).toMatch(/faces, portraits/);
    });

    test('the user\'s own steer is honoured, and bounded', () => {
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', hint: '  warm film photography, no people  ' });
        expect(prompt).toContain('warm film photography, no people');
        // No steer, no empty rule left behind.
        expect(buildVisionBoardPrompt(goals, { scope: 'dream' })).not.toMatch(/asked for this as well/);
    });

    test('the brief does not let the model reply with a discussion', () => {
        expect(buildVisionBoardPrompt(goals)).toMatch(/Reply with the prompt and nothing else/);
    });

    test('a landscape board is the only aspect ratio offered', () => {
        expect(BOARD_ASPECT_RATIO).toBe('16:9');
    });
});

describe('visionBoard · the look', () => {
    const goals = [{ slug: 'a', title: 'Retire by the coast', horizon: 'life', vision: '' }];
    const recordFor = (style) => buildBoardRecord({
        scope: 'dream', goals, prompt: 'A board.', url: 'u', s3Key: 'k', bytes: 1, style,
    });

    test('every look is complete, distinct, and askable by name', () => {
        const ids = BOARD_STYLES.map((s) => s.id);
        const names = BOARD_STYLES.map((s) => s.name);
        expect(ids.length).toBeGreaterThanOrEqual(8);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(names).size).toBe(names.length);
        for (const style of BOARD_STYLES) {
            expect(style.lines.length).toBeGreaterThanOrEqual(2);
            expect(style.keywords.length).toBeGreaterThan(0);
            for (const k of style.keywords) expect(k).toBe(k.toLowerCase());
            expect(style.mood.length).toBeGreaterThan(10);
            expect(style.palette.length).toBeGreaterThan(10);
            // A style that never reaches the brief, the fallback or the record is
            // a style nobody will ever see.
            expect(buildVisionBoardPrompt(goals, { scope: 'dream', style: style.id })).toContain(style.name);
            expect(fallbackBoardPrompt(goals, 'dream', {}, style.id)).toContain(style.mood);
            expect(recordFor(style.id).style).toEqual({ id: style.id, name: style.name });
        }
    });

    test('a new board never repeats the look of the boards before it', () => {
        // The complaint this exists for: every board came back as the same cork
        // noticeboard, so a gallery of them read as one picture repeated.
        const recent = [];
        const picked = [];
        for (let i = 0; i < BOARD_STYLES.length; i += 1) {
            const style = pickBoardStyle({ recent });
            picked.push(style.id);
            recent.unshift(style.id);
        }
        expect(new Set(picked).size).toBe(BOARD_STYLES.length);

        // Past the end of the catalog the previous board is still the one look
        // ruled out, which is the case that matters for a long-standing user.
        for (let i = 0; i < 30; i += 1) {
            const style = pickBoardStyle({ recent });
            expect(style.id).not.toBe(recent[0]);
            recent.unshift(style.id);
            if (recent.length > STYLE_MEMORY) recent.pop();
        }
    });

    test('it is a real pick, not a fixed queue', () => {
        // Same history, different random numbers, different boards: a rotation
        // that always ran in the same order would be its own kind of boring.
        expect(pickBoardStyle({ recent: [], rand: () => 0 }).id)
            .not.toBe(pickBoardStyle({ recent: [], rand: () => 0.999 }).id);
    });

    test('the steer can ask for a look by name', () => {
        expect(pickBoardStyle({ hint: 'vivid pop, no people' })).toMatchObject({ id: 'vivid-pop', source: 'asked' });
        expect(pickBoardStyle({ hint: 'make it feel like evening' })).toMatchObject({ id: 'evening-city', source: 'asked' });
        // …and asking wins over the rotation, which is the point of asking: a
        // board you liked has to be gettable again.
        expect(pickBoardStyle({ hint: 'pastel please', recent: ['soft-pastel'] }))
            .toMatchObject({ id: 'soft-pastel', source: 'asked' });
        expect(pickBoardStyle({}).source).toBe('picked');
    });

    test('"no <look>" rules it out, and is never read as a request for it', () => {
        // The same trap as "no people": the phrase contains the keyword.
        for (let i = 0; i < 40; i += 1) {
            const style = pickBoardStyle({ hint: 'no neon, no pastel' });
            expect(['evening-city', 'soft-pastel']).not.toContain(style.id);
        }
    });

    test('words that are not a look do not hijack the steer', () => {
        // "film photography" and "mountains" describe a mood and a subject, not a
        // look in this catalog — a keyword that ate them would send every steer to
        // the same look, which is the bug the catalog exists to fix.
        for (const hint of ['film photography, mountains', 'warm light', 'photographic, aspirational']) {
            expect(pickBoardStyle({ hint, rand: () => 0 }).source).toBe('picked');
        }
    });

    test('an unknown style id still produces a board, and an object is used as given', () => {
        expect(BOARD_STYLES.map((s) => s.id)).toContain(resolveBoardStyle('not-a-style', '').id);
        const mine = { id: 'mine', name: 'Mine', lines: ['- x'], mood: 'm', palette: 'p' };
        expect(resolveBoardStyle(mine)).toBe(mine);
        expect(buildVisionBoardPrompt(goals, { style: mine })).toContain('Mine');
        // A record with no style given is still a record with a look in it, so the
        // gallery never has to render a nameless board.
        expect(BOARD_STYLES.map((s) => s.id)).toContain(buildBoardRecord({
            scope: 'all', goals, prompt: 'x', url: 'u', s3Key: 'k', bytes: 1,
        }).style.id);
    });
});

describe('visionBoard · the two defaults, and the one input that changes them', () => {
    const goals = [{ slug: 'a', title: 'Retire by the coast', horizon: 'life', vision: '' }];

    test('an ordinary steer leaves both defaults alone', () => {
        expect(resolveBoardRules('')).toEqual({ allowPeople: false, allowText: false });
        expect(resolveBoardRules('warm film photography, mountains')).toEqual({ allowPeople: false, allowText: false });
        expect(resolveBoardRules(null)).toEqual({ allowPeople: false, allowText: false });
    });

    test('asking for people switches the face rule on', () => {
        const rules = resolveBoardRules('a family on the beach');
        expect(rules.allowPeople).toBe(true);
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', hint: 'a family on the beach', rules });
        expect(prompt).toMatch(/People may appear/);
        expect(prompt).not.toMatch(/NO faces anywhere/);
        // A likeness of a real person stays banned whatever the user asked for,
        // and the face denial lifts with the rule that asked for people.
        expect(prompt).toMatch(/no likeness of any real or famous person/);
        expect(boardNegativePrompt(rules)).not.toMatch(/faces|portraits/i);
    });

    test('"no people" is read as a refusal, not as a request for faces', () => {
        // The trap: the phrase contains the word. Reading it as a request would do
        // the exact opposite of what was asked — and `no persons` slipped through
        // the first version of this check, because its subject list only knew the
        // singular while the request list knew both.
        for (const hint of ['no people', 'without faces', 'avoid people', 'no persons', 'nothing with kids']) {
            expect(resolveBoardRules(hint)).toEqual({ allowPeople: false, allowText: false });
        }
        const rules = resolveBoardRules('no people');
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', hint: 'no people', rules });
        expect(prompt).toMatch(/NO faces anywhere/);
        expect(boardNegativePrompt(rules)).toMatch(/faces, portraits/);
    });

    test('a refusal about one subject does not cancel a request for the other', () => {
        // "no text, a family in the background" is one ordinary hint that asks for
        // one thing and refuses another; a single global "was anything refused"
        // flag would have cancelled the family.
        const rules = resolveBoardRules('warm film, no text, a family in the background');
        expect(rules).toEqual({ allowPeople: true, allowText: false });
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', rules });
        expect(prompt).toMatch(/People may appear/);
        expect(prompt).toMatch(/NO text, letters, numbers/);
        const negative = boardNegativePrompt(rules);
        expect(negative).not.toMatch(/faces|portraits/i);
        expect(negative).toMatch(/text, words, numbers, letters/);
    });

    test('asking for words switches the text rule on, in the brief and the negative prompt', () => {
        const hint = 'put the words "our beach house" on it';
        const rules = resolveBoardRules(hint);
        expect(rules.allowText).toBe(true);
        const prompt = buildVisionBoardPrompt(goals, { scope: 'dream', hint, rules });
        expect(prompt).toMatch(/The person asked for words/);
        expect(prompt).toMatch(/SHORT handwritten-style phrases/);
        expect(prompt).not.toMatch(/NO text, letters, numbers/);
        expect(boardNegativePrompt(rules)).not.toMatch(/text|words|letters/i);
        // Marks of the trade are still refused: a signed photograph is not a board.
        expect(boardNegativePrompt(rules)).toMatch(/watermark, signature, logo/);
    });

    test('both can be switched on at once', () => {
        const hint = 'a couple with a handwritten caption';
        expect(resolveBoardRules(hint)).toEqual({ allowPeople: true, allowText: true });
        const negative = boardNegativePrompt(resolveBoardRules(hint));
        expect(negative).not.toMatch(/faces|text|words/i);
        // …and the list is still only the marks of a photograph, nothing else.
        expect(negative).toBe('watermark, signature, logo');
    });

    test('the record stores the rules and the negative prompt that were used', () => {
        const rules = resolveBoardRules('a family');
        const record = buildBoardRecord({
            scope: 'dream',
            goals,
            prompt: 'A cork board covered in overlapping photographs.',
            hint: 'a family',
            rules,
            url: 'https://cdn.example/a.png',
            s3Key: 'users/u1/generated/a.png',
            bytes: 10,
        });
        expect(record.rules).toEqual({ allowPeople: true, allowText: false });
        expect(record.negativePrompt).toBe('text, words, numbers, letters, watermark, signature, logo');
        // A board made with the defaults is recorded with the defaults.
        expect(buildBoardRecord({ scope: 'dream', goals, prompt: 'x', url: 'u', s3Key: 'k', bytes: 1 }).rules)
            .toEqual({ allowPeople: false, allowText: false });
    });
});

describe('visionBoard · normalizing the answer', () => {
    const goals = [{ slug: 'a', title: 'Retire by the coast', horizon: 'life', vision: '' }];

    test('a clean answer is passed through untouched', () => {
        const raw = 'A wide empty beach at golden hour, warm film tones, a small boat moored at the tideline.';
        expect(normalizeBoardPrompt(raw, goals, 'dream')).toEqual({ prompt: raw, source: 'model' });
    });

    test('fences, a label, quotes and markdown emphasis come off', () => {
        const raw = 'Here is the prompt:\n```\n"A **wide** beach at golden hour, calm water."\n```';
        expect(normalizeBoardPrompt(raw, goals, 'dream').prompt)
            .toBe('A wide beach at golden hour, calm water.');
    });

    test('a trailing offer to help is a reply, not part of the prompt', () => {
        const raw = 'A sunlit studio with sketches pinned to the wall. Let me know if you\'d like it warmer!';
        expect(normalizeBoardPrompt(raw, goals, 'dream').prompt)
            .toBe('A sunlit studio with sketches pinned to the wall.');
    });

    test('newlines and bullet leftovers collapse to one line', () => {
        const raw = '- A kitchen at dawn,\n\n  bread on the counter,   soft light  ';
        expect(normalizeBoardPrompt(raw, goals, 'dream').prompt)
            .toBe('A kitchen at dawn, bread on the counter, soft light');
    });

    test('an over-long answer is cut at a sentence, not mid-word', () => {
        const sentence = 'A warm room with a wooden desk and morning light through linen curtains. ';
        const { prompt, source } = normalizeBoardPrompt(sentence.repeat(20), goals, 'dream');
        expect(source).toBe('model');
        expect(prompt.length).toBeLessThanOrEqual(1200);
        expect(prompt.endsWith('.')).toBe(true);
        expect(prompt).not.toMatch(/ $/);
    });

    test('an empty or useless answer falls back to a real prompt built from the goals', () => {
        for (const raw of ['', '   ', 'Okay!', '```\n```']) {
            const { prompt, source } = normalizeBoardPrompt(raw, goals, 'dream');
            expect(source).toBe('fallback');
            expect(prompt).toContain('retire by the coast');
            expect(prompt).toMatch(/no text or lettering/);
        }
    });

    test('the fallback is the same KIND of picture the brief asks for', () => {
        // A fallback that drew a single scene, or a board of stationery, would
        // quietly undo the picture the feature was corrected to produce.
        const dreams = fallbackBoardPrompt(goals, 'dream', {}, 'golden-warm');
        const all = fallbackBoardPrompt(goals, 'all', {}, 'golden-warm');
        expect(dreams).toMatch(/A photo collage filling the frame/);
        expect(dreams).toMatch(/three to six large/);
        expect(dreams).toMatch(/edges crossing/);
        expect(dreams).toMatch(/no faces at all/);
        expect(dreams).toMatch(/the life they are aiming at/);
        expect(all).toMatch(/this week to a lifetime away/);
        expect(fallbackBoardPrompt([], 'dream')).toContain('an open horizon');
        // …and it follows the rules too, when the user switched one on.
        expect(fallbackBoardPrompt(goals, 'dream', { allowPeople: true }))
            .toMatch(/people kept distant and unidentifiable/);
        // No props here either: the deterministic prompt is not allowed to be the
        // one place a cork board survives.
        expect(dreams).not.toMatch(/cork|pinboard|push ?pin|washi|scrapbook|mock-up/i);
    });

    test('the fallback keeps the look it was given, so one board is not the odd one out', () => {
        const p = fallbackBoardPrompt(goals, 'dream', {}, 'evening-city');
        expect(p).toMatch(/blue-hour evening light, lit windows and warm glow/);
        expect(p).toMatch(/deep blue, violet, warm amber and pink neon/);
        expect(p).not.toMatch(/golden-hour/);
    });
});

describe('visionBoard · the record', () => {
    test('a board is named and slugged per scope', () => {
        expect(boardName('dream')).toMatch(/dreams/i);
        expect(boardName('all')).toMatch(/all goals/i);
        expect(BOARD_SCOPES).toEqual(['dream', 'all']);
        expect(Object.keys(SCOPE_LABELS)).toEqual(['dream', 'all']);
    });

    test('the slug is store-legal, unique per board, and says what it is', () => {
        const slug = boardSlug('2026-09-16T10:23:55.123Z', 'dream', 'A1b2C3');
        expect(slug).toBe('board-20260916-102355-dreams-a1b2c3');
        expect(slug).toMatch(/^[a-z0-9][a-z0-9_-]{0,99}$/);
        // Two boards of the same scope in the same second must not collide.
        const other = boardSlug('2026-09-16T10:23:55.123Z', 'dream', 'ffff');
        expect(other).not.toBe(slug);
        expect(boardSlug('2026-09-16T10:23:55.123Z', 'all', 'x')).toContain('-all-');
    });

    test('the record says what it was made from, in which look, with what prompt', () => {
        const record = buildBoardRecord({
            scope: 'dream',
            goals: [{ slug: 'a', title: 'Retire by the coast', horizon: 'life' }],
            prompt: 'A wide beach at golden hour.',
            hint: 'film photography',
            style: 'rich-jewel',
            url: 'https://cdn.example/a.png',
            s3Key: 'users/u1/generated/a.png',
            bytes: 1234,
            recordId: 'vision_board_u1_1_abcd',
            aspects: { total: 9, truncated: 8, model: 'stability.sd3-5-large-v1:0', seed: 42 },
            at: '2026-09-16T10:23:55.123Z',
        });

        expect(record).toMatchObject({
            version: 1,
            scope: 'dream',
            prompt: 'A wide beach at golden hour.',
            promptSource: 'model',
            aspectRatio: '16:9',
            generatedAt: '2026-09-16T10:23:55.123Z',
        });
        // The look travels with the board: it is what the gallery line shows, and
        // what the next board refuses to repeat.
        expect(record.style).toEqual({ id: 'rich-jewel', name: 'Rich jewel' });
        // The provenance is the honest part: what it was made from, and what the
        // user asked for on top.
        expect(record.source.goals).toEqual([{ slug: 'a', title: 'Retire by the coast', horizon: 'life' }]);
        expect(record.source).toMatchObject({ total: 9, used: 1, truncated: 8 });
        expect(record.hint).toBe('film photography');
        // Bytes and the record id travel with the board: deleting the board has to
        // be able to release both the object and the quota.
        expect(record.image).toMatchObject({ s3Key: 'users/u1/generated/a.png', bytes: 1234, recordId: 'vision_board_u1_1_abcd' });
        expect(record.negativePrompt).toMatch(/watermark/);
        expect(record.rules).toEqual({ allowPeople: false, allowText: false });
    });

    test('a record survives a JSON round-trip inside the item size cap', () => {
        const goals = Array.from({ length: 24 }, (_, i) => ({ slug: `g${i}`, title: `Aim ${i}`, horizon: 'life' }));
        const record = buildBoardRecord({
            scope: 'all',
            goals,
            prompt: 'x'.repeat(1200),
            url: 'https://cdn.example/a.png',
            s3Key: 'users/u1/generated/a.png',
            bytes: 1500000,
            aspects: { total: 24, truncated: 0, model: 'stability.sd3-5-large-v1:0', seed: 1 },
        });
        const bytes = Buffer.byteLength(JSON.stringify(record), 'utf-8');
        expect(JSON.parse(JSON.stringify(record)).source.goals).toHaveLength(24);
        // KIND_SIZE_CAP_BYTES.vision is 32KB — a full board must fit with room to
        // spare, or the biggest boards would silently fail to store.
        expect(bytes).toBeLessThan(32 * 1024);
    });
});
