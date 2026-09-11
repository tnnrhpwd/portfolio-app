import BANK, { CAT_KEYS, DIFF_TIERS } from './questionBank';

/**
 * Parses a numeric item stem into the known input/output pairs plus the target
 * input, for the two shapes the bank uses:
 *
 *   'Complete the analogy: 3 is to 9 as 4 is to ___?'   -> [[3, 9]], 4
 *   'Complete the pattern: 3 → 9, 4 → 16, so 5 → ___?'  -> [[3, 9], [4, 16]], 5
 *
 * Returns null for items that aren't numeric pair questions.
 */
const parsePairs = (question = '') => {
  const analogy = question.match(/(\d+)\s+is to\s+(\d+)\s+as\s+(\d+)\s+is to/i);
  if (analogy) {
    return { pairs: [[Number(analogy[1]), Number(analogy[2])]], target: Number(analogy[3]) };
  }

  const pattern = question.match(
    /(\d+)\s*→\s*(\d+)\s*,\s*(\d+)\s*→\s*(\d+)\s*,\s*so\s*(\d+)/i
  );
  if (pattern) {
    return {
      pairs: [
        [Number(pattern[1]), Number(pattern[2])],
        [Number(pattern[3]), Number(pattern[4])],
      ],
      target: Number(pattern[5]),
    };
  }

  return null;
};

/** Simple arithmetic rules a test-taker would plausibly read into `a -> b`. */
const candidateRules = [
  {
    name: 'multiply by a constant',
    // only offer the rule when the pair actually describes a whole-number multiple
    derive: ([a, b]) => (a !== 0 && b % a === 0 ? { k: b / a } : null),
    apply: ({ k }, x) => x * k,
  },
  {
    name: 'add a constant',
    derive: ([a, b]) => ({ d: b - a }),
    apply: ({ d }, x) => x + d,
  },
  {
    name: 'square',
    derive: ([a, b]) => (b === a * a ? {} : null),
    apply: (_params, x) => x * x,
  },
  {
    name: 'cube',
    derive: ([a, b]) => (b === a ** 3 ? {} : null),
    apply: (_params, x) => x ** 3,
  },
];

/**
 * Every distinct target value reachable by a rule that explains the WHOLE stem
 * — not just the first pair. The constant is derived from the first pair and
 * then re-checked against the rest, so "multiply by 3" is rejected for
 * `3 → 9, 4 → 16` because 4 × 3 = 12, not 16.
 */
const consistentRuleAnswers = (pairs, target) => {
  const values = new Set();
  for (const rule of candidateRules) {
    const params = rule.derive(pairs[0]);
    if (!params) continue;
    const fitsEveryPair = pairs.every(([a, b]) => rule.apply(params, a) === b);
    if (!fitsEveryPair) continue;
    const value = rule.apply(params, target);
    if (Number.isInteger(value)) values.add(value);
  }
  return values;
};

const textOptions = (item) => item.options.map((option) => String(option));
const numericItems = BANK.map((item) => ({ item, parsed: parsePairs(item.q) })).filter(
  (entry) => entry.parsed && !entry.item.visual && textOptions(entry.item).every((o) => /^\d+$/.test(o))
);

describe('questionBank structure', () => {
  it('has a healthy number of items', () => {
    expect(BANK.length).toBeGreaterThan(100);
  });

  it.each(BANK.map((item, index) => [index, item]))(
    'item %i is well formed',
    (_index, item) => {
      expect(CAT_KEYS).toContain(item.cat);
      expect(DIFF_TIERS).toContain(item.diff);
      expect(typeof item.q).toBe('string');
      expect(item.q.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(item.options)).toBe(true);
      expect(item.options).toHaveLength(4);
      expect(Number.isInteger(item.answer)).toBe(true);
      expect(item.answer).toBeGreaterThanOrEqual(0);
      expect(item.answer).toBeLessThan(item.options.length);
      expect(typeof item.exp).toBe('string');
      expect(item.exp.trim().length).toBeGreaterThan(0);
    }
  );

  it.each(BANK.map((item, index) => [index, item]))(
    'item %i has four unique options',
    (_index, item) => {
      const keys = item.options.map((option) => JSON.stringify(option));
      expect(new Set(keys).size).toBe(4);
    }
  );

  it('covers every difficulty tier in every category', () => {
    for (const cat of CAT_KEYS) {
      const tiers = new Set(BANK.filter((item) => item.cat === cat).map((item) => item.diff));
      for (const tier of DIFF_TIERS) {
        expect({ cat, tier, covered: tiers.has(tier) }).toEqual({ cat, tier, covered: true });
      }
    }
  });
});

describe('numeric pair questions are unambiguous', () => {
  it('finds numeric pair items to check', () => {
    expect(numericItems.length).toBeGreaterThanOrEqual(4);
  });

  it.each(numericItems.map(({ item }) => [item.q, item]))(
    'only one defensible rule fits: %s',
    (_q, item) => {
      const { pairs, target } = parsePairs(item.q);
      const options = textOptions(item);
      const intended = options[item.answer];

      // Values reachable by following a *different* rule that still explains
      // every known pair in the stem. If any of those is offered as an option,
      // the item has two "correct" answers.
      const rivalAnswers = [...consistentRuleAnswers(pairs, target)]
        .map(String)
        .filter((value) => value !== intended);

      expect(rivalAnswers.filter((value) => options.includes(value))).toEqual([]);
    }
  );

  it('keeps the reported 2:4 analogy free of the competing "+2" answer', () => {
    const reported = BANK.find((item) => /2 is to 4 as 5 is to/.test(item.q));
    expect(reported).toBeDefined();
    // "+2" answers the first pair but not the second; offering it made the item
    // look like it had two answers. 7 must stay out of the options.
    expect(textOptions(reported)).not.toContain('7');
    expect(textOptions(reported)[reported.answer]).toBe('10');
  });

  it('keeps the squared-pair pattern free of the competing "x3" answer', () => {
    const squared = BANK.find((item) => /3 → 9, 4 → 16/.test(item.q));
    expect(squared).toBeDefined();
    // 15 (5 x 3) is the shallow reading of the first pair only; it must never be
    // the correct answer.
    expect(textOptions(squared)[squared.answer]).toBe('25');
  });
});
