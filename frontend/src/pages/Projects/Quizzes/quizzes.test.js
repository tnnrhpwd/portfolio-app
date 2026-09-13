import { QUIZZES, STANDALONE_QUIZZES, HUB_QUIZZES } from './meta';
import { scoreTraits, traitRows, compareResponses } from './quizEngine';
import mbti from './data/mbti';
import bigfive from './data/bigfive';
import enneagram from './data/enneagram';
import autism from './data/autism';
import adhd from './data/adhd';
import attachment from './data/attachment';
import loveLanguages from './data/loveLanguages';
import valuesAlignment from './data/valuesAlignment';
import thirtySixQuestions from './data/thirtySixQuestions';

/**
 * Contract tests for every quiz config. These mount nothing — they call each
 * quiz's `interpret` / `formatComparison` / `formatSession` directly with
 * synthetic inputs, which is where off-by-one errors in a scoring function
 * actually show up and where a config that would render the word "undefined"
 * at a user gets caught.
 *
 * Three shapes are covered, matching the three values of `mode`:
 *   solo (the default) — one person, scored, `interpret(scores, responses)`
 *   compare            — two people answer the same items, `formatComparison`
 *   prompt             — a guided conversation, `formatSession`
 */
const ALL = [
  mbti, bigfive, enneagram, autism, adhd, attachment, loveLanguages,
  valuesAlignment, thirtySixQuestions,
];
const SOLO = ALL.filter((config) => (config.mode || 'solo') === 'solo');
const COMPARE = ALL.filter((config) => config.mode === 'compare');
const PROMPT = ALL.filter((config) => config.mode === 'prompt');

// A full run of answers, so `interpret` can be exercised without React.
const run = (quiz, pick) => quiz.items.map((item, i) => ({
  ...item,
  index: i,
  value: pick(item, i),
}));

const scoreAndInterpret = (quiz, responses) => {
  const scores = scoreTraits(responses, quiz.scale.length - 1);
  return quiz.interpret(scores, responses);
};

describe('quiz catalogue', () => {
  it('gives every quiz a unique slug and path', () => {
    const slugs = QUIZZES.map((q) => q.slug);
    const paths = QUIZZES.map((q) => q.path);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps question text out of the catalogue the hub imports', () => {
    QUIZZES.forEach((quiz) => {
      expect(quiz.items).toBeUndefined();
      expect(JSON.stringify(quiz).length).toBeLessThan(600);
    });
  });

  it('gives every quiz the metadata the hub card renders', () => {
    QUIZZES.forEach((quiz) => {
      ['slug', 'path', 'name', 'shortName', 'emoji', 'tagline', 'minutes', 'accentRole'].forEach((field) => {
        expect(quiz[field]).toBeTruthy();
      });
      expect(quiz.path.startsWith('/')).toBe(true);
      expect(quiz.tags.length).toBeGreaterThan(0);
    });
  });

  it('tints each quiz with a scheme ROLE, never a fixed hue', () => {
    // A fixed `--fg-*` / `--bg-*` here would silently opt that quiz out of the
    // visitor's colour scheme, which is the whole point of `accentRole`.
    [...QUIZZES, ...STANDALONE_QUIZZES].forEach((quiz) => {
      expect(['accent', 'primary']).toContain(quiz.accentRole);
      expect(quiz.accent).toBeUndefined();
    });
  });

  it('lists the standalone quizzes on the hub without giving them a config', () => {
    expect(STANDALONE_QUIZZES.length).toBeGreaterThan(0);
    expect(HUB_QUIZZES).toHaveLength(QUIZZES.length + STANDALONE_QUIZZES.length);
    // A standalone entry must NOT have a config module, or the two lists have
    // drifted and one of them is lying about what exists.
    const configSlugs = new Set(ALL.map((c) => c.slug));
    STANDALONE_QUIZZES.forEach((quiz) => {
      expect(configSlugs.has(quiz.slug)).toBe(false);
      expect(quiz.path.startsWith('/')).toBe(true);
      expect(['accent', 'primary']).toContain(quiz.accentRole);
    });
  });

  it('has exactly one config module per catalogued quiz, with a known mode', () => {
    expect(ALL.map((c) => c.slug).sort()).toEqual(QUIZZES.map((q) => q.slug).sort());
    ALL.forEach((config) => {
      expect(['solo', 'compare', 'prompt']).toContain(config.mode || 'solo');
    });
  });

  it('splits the catalogue across all three modes', () => {
    expect(SOLO).toHaveLength(7);
    expect(COMPARE).toHaveLength(1);
    expect(PROMPT).toHaveLength(1);
  });
});

describe.each(SOLO.map((config) => [config.slug, config]))('%s config (solo)', (slug, quiz) => {
  const scaleMax = quiz.scale.length - 1;

  it('is the same quiz the catalogue advertises', () => {
    const meta = QUIZZES.find((q) => q.slug === slug);
    expect(quiz.name).toBe(meta.name);
    expect(quiz.path).toBe(meta.path);
    expect(quiz.accentRole).toBe(meta.accentRole);
  });

  it('supplies everything QuizPage renders', () => {
    ['slug', 'path', 'name', 'emoji', 'seoTitle', 'seoDescription', 'intro', 'hint', 'scale', 'items', 'disclaimer']
      .forEach((field) => expect(quiz[field]).toBeTruthy());
    expect(typeof quiz.interpret).toBe('function');
    expect(quiz.scale.length).toBeGreaterThanOrEqual(2);
  });

  it('marks exactly one pole of each reverse-keyed pair by giving every item a dim', () => {
    quiz.items.forEach((item) => {
      expect(typeof item.text).toBe('string');
      expect(item.text.length).toBeGreaterThan(10);
      expect(item.dim).toBeTruthy();
      expect([1, -1]).toContain(item.key ?? 1);
    });
  });

  it('does not repeat a statement', () => {
    const texts = quiz.items.map((item) => item.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('scores every dimension it declares items for', () => {
    const responses = run(quiz, () => Math.floor(scaleMax / 2));
    const scores = scoreTraits(responses, scaleMax);
    const declared = new Set(quiz.items.map((item) => item.dim));
    declared.forEach((dim) => expect(scores[dim]).toBeDefined());
  });

  it('renders a result when every answer agrees', () => {
    const responses = run(quiz, () => scaleMax);
    const result = scoreAndInterpret(quiz, responses);
    assertRenderable(result, responses.length);
  });

  it('renders a result when every answer disagrees', () => {
    const responses = run(quiz, () => 0);
    const result = scoreAndInterpret(quiz, responses);
    assertRenderable(result, responses.length);
  });

  it('renders a result when every answer sits in the middle', () => {
    const responses = run(quiz, () => Math.round(scaleMax / 2));
    const result = scoreAndInterpret(quiz, responses);
    assertRenderable(result, responses.length);
  });

  it('renders a result when every item is skipped', () => {
    if (quiz.allowSkip === false) {
      // These quizzes forbid skipping, so the skipped run is not reachable —
      // but the scorer still must not produce NaN if it ever were.
      const responses = run(quiz, () => null);
      expect(() => scoreAndInterpret(quiz, responses)).not.toThrow();
      return;
    }
    const responses = run(quiz, () => null);
    assertRenderable(scoreAndInterpret(quiz, responses), responses.length);
  });

  it('keeps percentages inside 0–100 for every reachable answer pattern', () => {
    // Walk one answer through every position on the scale, which covers every
    // per-item contribution the quiz can produce.
    for (let value = 0; value <= scaleMax; value += 1) {
      const responses = run(quiz, () => value);
      const scores = scoreTraits(responses, scaleMax);
      traitRows(scores, quiz.items.map((i) => ({ key: i.dim, name: i.dim }))).forEach((row) => {
        expect(row.pct).toBeGreaterThanOrEqual(0);
        expect(row.pct).toBeLessThanOrEqual(100);
      });
    }
  });

  it('never puts a pipe into the history record it saves', () => {
    // The record is pipe-delimited, so a "|" in the headline would corrupt it.
    for (let value = 0; value <= scaleMax; value += 1) {
      const result = scoreAndInterpret(quiz, run(quiz, () => value));
      expect(String(result.headline)).not.toContain('|');
      expect(String(result.headlineSub)).not.toContain('|');
    }
  });
});

/** Shared assertions for "this result object would render without blowing up". */
function assertRenderable(result) {
  expect(result).toBeTruthy();
  expect(typeof result.headline).toBe('string');
  expect(result.headline.length).toBeGreaterThan(0);
  expect(typeof result.headlineSub).toBe('string');
  expect(typeof result.summary).toBe('string');
  expect(result.summary.length).toBeGreaterThan(0);

  expect(Array.isArray(result.stats)).toBe(true);
  result.stats.forEach((stat) => {
    expect(stat.val).not.toBeUndefined();
    expect(stat.lbl).not.toBeUndefined();
    expect(String(stat.val)).not.toBe('undefined');
    expect(String(stat.lbl)).not.toBe('undefined');
  });

  // Bars are optional: the guided-conversation mode has nothing to chart. When
  // a mode does provide them, they have to be renderable.
  if (result.bars !== undefined) {
    expect(Array.isArray(result.bars)).toBe(true);
    result.bars.forEach((bar) => {
      // `undefined` here is the classic symptom of a scoring/config mismatch:
      // it renders as the literal word "undefined" on the page.
      expect(bar.label).not.toBeUndefined();
      expect(String(bar.label)).not.toBe('undefined');
      expect(Number.isFinite(bar.pct)).toBe(true);
      expect(bar.pct).toBeGreaterThanOrEqual(0);
      expect(bar.pct).toBeLessThanOrEqual(100);
    });
  }
  // Every mode shows stats, so an empty stats list would leave a bare grid.
  expect(result.stats.length).toBeGreaterThan(0);

  expect(Array.isArray(result.blocks)).toBe(true);
  expect(result.blocks.length).toBeGreaterThan(0);
  result.blocks.forEach((block) => {
    expect(block.title).not.toBeUndefined();
    expect(block.body).not.toBeUndefined();
    expect(String(block.title)).not.toBe('undefined');
    expect(String(block.body).length).toBeGreaterThan(20);
    expect(String(block.body)).not.toContain('undefined');
    expect(String(block.body)).not.toContain('NaN');
  });

  // No result text should ever say "undefined" or "NaN" to the user.
  const rendered = JSON.stringify(result);
  expect(rendered).not.toMatch(/undefined|NaN/);
}

describe.each(COMPARE.map((config) => [config.slug, config]))('%s config (couples, compare)', (slug, quiz) => {
  const scaleMax = quiz.scale.length - 1;
  const ctx = { names: { a: 'Ada', b: 'Sam' }, scale: quiz.scale };
  const compare = (pickA, pickB) => compareResponses(run(quiz, pickA), run(quiz, pickB), scaleMax);

  it('declares the fields CoupleQuizPage renders', () => {
    ['slug', 'path', 'name', 'emoji', 'seoTitle', 'seoDescription', 'intro', 'hint', 'scale', 'items', 'areas', 'disclaimer']
      .forEach((field) => expect(quiz[field]).toBeTruthy());
    expect(typeof quiz.formatComparison).toBe('function');
    // The solo result contract must NOT be what this config implements.
    expect(quiz.interpret).toBeUndefined();
  });

  it('gives every item a text, a declared area, and a discussion prompt', () => {
    const areaKeys = new Set(quiz.areas.map((area) => area.key));
    quiz.items.forEach((item) => {
      expect(typeof item.text).toBe('string');
      expect(item.text.length).toBeGreaterThan(10);
      expect(areaKeys.has(item.dim)).toBe(true);
      expect(typeof item.discuss).toBe('string');
      expect(item.discuss.length).toBeGreaterThan(20);
    });
  });

  it('uses every area it declares items for', () => {
    const used = new Set(quiz.items.map((item) => item.dim));
    quiz.areas.forEach((area) => expect(used.has(area.key)).toBe(true));
  });

  it('does not repeat a statement', () => {
    const texts = quiz.items.map((item) => item.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('renders a comparison when both partners answer identically', () => {
    const result = quiz.formatComparison(compare(() => 0, () => 0), ctx);
    assertRenderable(result);
    expect(result.headline).toBe('100%');
    expect(result.gaps).toEqual([]);
  });

  it('renders a comparison when the partners are polar opposites', () => {
    const result = quiz.formatComparison(compare(() => scaleMax, () => 0), ctx);
    assertRenderable(result);
    expect(result.headline).toBe('0%');
    // Every item is a wide gap, so the list is capped but never empty.
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps.length).toBeLessThanOrEqual(6);
    result.gaps.forEach((gap) => {
      expect(gap.text).not.toBeUndefined();
      expect(gap.aLabel).toBeTruthy();
      expect(gap.bLabel).toBeTruthy();
      expect(gap.prompt.length).toBeGreaterThan(20);
    });
  });

  it('renders a comparison when both partners sit in the middle', () => {
    const mid = Math.round(scaleMax / 2);
    const result = quiz.formatComparison(compare(() => mid, () => mid), ctx);
    assertRenderable(result);
    // Both-neutral is an unopened question, not agreement, so it gets its own count.
    const undecided = result.stats.find((stat) => /neutral/i.test(stat.lbl));
    expect(undecided).toBeDefined();
    expect(Number(undecided.val)).toBe(quiz.items.length);
  });

  it('renders a comparison when every item is skipped', () => {
    const result = quiz.formatComparison(compare(() => null, () => null), ctx);
    assertRenderable(result);
    expect(result.gaps).toEqual([]);
  });

  it('never leaves a partner’s answer label unrenderable for a real difference', () => {
    // Walk one item through every answer pair, which covers every label the
    // gaps list can be asked to render.
    for (let a = 0; a <= scaleMax; a += 1) {
      for (let b = 0; b <= scaleMax; b += 1) {
        const result = quiz.formatComparison(
          compare((_, i) => (i === 0 ? a : 0), (_, i) => (i === 0 ? b : 0)),
          ctx,
        );
        result.gaps.forEach((gap) => {
          expect(gap.aLabel).not.toBe('Skipped');
          expect(gap.bLabel).not.toBe('Skipped');
          expect(String(gap.aLabel)).not.toBe('undefined');
        });
      }
    }
  });

  it('drives the headline from the modelled overall percentage', () => {
    const comparison = compare(() => scaleMax, () => Math.max(scaleMax - 1, 0));
    const result = quiz.formatComparison(comparison, ctx);
    expect(result.headline).toBe(`${Math.round(comparison.overallPct)}%`);
  });
});

describe.each(PROMPT.map((config) => [config.slug, config]))('%s config (couples, prompt)', (slug, quiz) => {
  const session = (a, b) => quiz.formatSession({
    names: { a: 'Ada', b: 'Sam' },
    scale: [],
    ratings: { a, b },
  });

  it('declares the fields CoupleQuizPage renders', () => {
    ['slug', 'path', 'name', 'emoji', 'seoTitle', 'seoDescription', 'intro', 'hint', 'items', 'sets', 'closeness', 'disclaimer']
      .forEach((field) => expect(quiz[field]).toBeTruthy());
    expect(typeof quiz.formatSession).toBe('function');
  });

  it('scores nothing — there is no answer scale and no scoring function', () => {
    expect(quiz.scale).toBeUndefined();
    expect(quiz.interpret).toBeUndefined();
    expect(quiz.formatComparison).toBeUndefined();
    quiz.items.forEach((item) => {
      expect(item.dim).toBeUndefined();
      expect(item.key).toBeUndefined();
    });
  });

  it('puts every question in a set that exists, with no empty sets', () => {
    const setKeys = new Set(quiz.sets.map((set) => set.key));
    quiz.items.forEach((item) => expect(setKeys.has(item.set)).toBe(true));
    quiz.sets.forEach((set) => {
      expect(set.name).toBeTruthy();
      expect(set.blurb.length).toBeGreaterThan(20);
      expect(quiz.items.filter((item) => item.set === set.key).length).toBeGreaterThan(0);
    });
  });

  it('keeps its questions in order, because the sets are the point', () => {
    expect(quiz.shuffle).toBe(false);
  });

  it('asks 36 distinct questions', () => {
    const texts = quiz.items.map((item) => item.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.length).toBe(36);
  });

  it('has a closeness scale CoupleQuizPage can turn into radio buttons', () => {
    expect(quiz.closeness.question).toBeTruthy();
    expect(quiz.closeness.note).toBeTruthy();
    expect(quiz.closeness.scale.length).toBeGreaterThanOrEqual(2);
    quiz.closeness.scale.forEach((step) => {
      expect(typeof step.value).toBe('number');
      expect(step.label).toBeTruthy();
    });
  });

  it('renders a session for every possible pair of ratings', () => {
    const values = quiz.closeness.scale.map((step) => step.value);
    values.forEach((a) => {
      values.forEach((b) => assertRenderable(session(a, b)));
    });
  });

  it('shows both partners’ ratings so neither is hidden behind an average', () => {
    const labels = session(4, 6).stats.map((stat) => stat.lbl);
    expect(labels).toContain('Ada');
    expect(labels).toContain('Sam');
  });

  it('names the gap explicitly when the two ratings diverge', () => {
    const low = quiz.closeness.scale[0].value;
    const high = quiz.closeness.scale[quiz.closeness.scale.length - 1].value;
    expect(session(low, high).blocks.some((block) => /apart/i.test(block.title))).toBe(true);
    expect(session(high, high).blocks.some((block) => /close together/i.test(block.title))).toBe(true);
  });
});
