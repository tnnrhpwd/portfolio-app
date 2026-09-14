import {
  shuffle,
  formatTime,
  ordinal,
  scoreTraits,
  traitRows,
  topKeys,
  bandFor,
  strengthLabel,
  itemLean,
  compareResponses,
  selectItemIndices,
} from './quizEngine';

describe('shuffle', () => {
  it('keeps every element and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input);
    expect(out).not.toBe(input);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['a'])).toEqual(['a']);
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [65, '1:05'],
    [600, '10:00'],
  ])('renders %p seconds as %p', (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });

  it('treats junk as zero rather than rendering NaN', () => {
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });
});

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [111, '111th'],
    [112, '112th'],
  ])('renders %p as %p', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });
});

describe('scoreTraits', () => {
  // 5-point agreement scale → highest index 4.
  const max = 4;
  const agrees = (dim, key = 1) => ({ dim, key, value: 4 });
  const disagrees = (dim, key = 1) => ({ dim, key, value: 0 });

  it('returns an empty map for no answers', () => {
    expect(scoreTraits([], max)).toEqual({});
    expect(scoreTraits(undefined, max)).toEqual({});
  });

  it('scores a forward-keyed agreement as fully toward the dimension', () => {
    const scores = scoreTraits([agrees('E'), agrees('E')], max);
    expect(scores.E.pct).toBe(100);
    expect(scores.E.points).toBe(8);
    expect(scores.E.pointsMax).toBe(8);
    expect(scores.E.count).toBe(2);
  });

  it('scores a reverse-keyed agreement toward the opposite pole', () => {
    // key -1 means agreement is evidence AGAINST the dimension
    const scores = scoreTraits([agrees('E', -1), agrees('E', -1)], max);
    expect(scores.E.pct).toBe(0);
    // ...but the raw points still count the answer as given
    expect(scores.E.points).toBe(0);
  });

  it('splits a mixed set evenly down the middle', () => {
    const scores = scoreTraits([agrees('E'), disagrees('E')], max);
    expect(scores.E.pct).toBe(50);
  });

  it('treats a mid-scale answer as neutral', () => {
    const scores = scoreTraits([{ dim: 'O', key: 1, value: 2 }], max);
    expect(scores.O.pct).toBe(50);
  });

  it('counts a skipped item as neutral, not as disagreement', () => {
    // A skipped reverse-keyed item must not push the score to its high pole.
    const scores = scoreTraits([{ dim: 'EI', key: -1, value: null }], max);
    expect(scores.EI.pct).toBe(50);
    expect(scores.EI.skipped).toBe(1);
    // and a skip can never add raw points
    expect(scores.EI.points).toBe(0);
    expect(scores.EI.pointsMax).toBe(0);
  });

  it('excludes skipped items from pointsMax without affecting pct', () => {
    const scores = scoreTraits([agrees('A'), { dim: 'A', key: 1, value: null }], max);
    expect(scores.A.count).toBe(2);
    expect(scores.A.points).toBe(4);
    expect(scores.A.pointsMax).toBe(4);
    expect(scores.A.pct).toBe(75);
  });

  it('ignores answers with no dimension', () => {
    const scores = scoreTraits([{ key: 1, value: 4 }, { dim: '', value: 4 }], max);
    expect(scores).toEqual({});
  });

  it('clamps out-of-range values instead of over/under-scoring', () => {
    const scores = scoreTraits([{ dim: 'X', key: 1, value: 99 }], max);
    expect(scores.X.pct).toBe(100);
    expect(scores.X.points).toBe(4);
  });

  it('keeps dimensions independent', () => {
    const scores = scoreTraits([agrees('E'), disagrees('I')], max);
    expect(Object.keys(scores).sort()).toEqual(['E', 'I']);
    expect(scores.E.pct).toBe(100);
    expect(scores.I.pct).toBe(0);
  });

  it('accumulates raw symptom points for a screening-style quiz', () => {
    // 4-point scale (0..3), all forward-keyed: points are the symptom count.
    const scores = scoreTraits([
      { dim: 'total', key: 1, value: 3 },
      { dim: 'total', key: 1, value: 2 },
      { dim: 'total', key: 1, value: 0 },
    ], 3);
    expect(scores.total.points).toBe(5);
    expect(scores.total.pointsMax).toBe(9);
    expect(scores.total.pct).toBe(55.6);
  });
});

describe('traitRows', () => {
  const defs = [
    { key: 'E', name: 'Extraversion' },
    { key: 'N', name: 'Neuroticism', note: 'reactivity' },
    { key: 'X', name: 'Never answered' },
  ];

  it('renders only the dimensions that were answered', () => {
    const scores = scoreTraits([{ dim: 'E', key: 1, value: 4 }], 4);
    const rows = traitRows(scores, defs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'E', name: 'Extraversion', note: '', pct: 100 });
  });

  it('preserves the definition order, not the score order', () => {
    const scores = scoreTraits([
      { dim: 'N', key: 1, value: 4 },
      { dim: 'E', key: 1, value: 0 },
    ], 4);
    expect(traitRows(scores, defs).map((r) => r.key)).toEqual(['E', 'N']);
  });
});

describe('topKeys', () => {
  it('ranks by points, falling back to the given order for ties', () => {
    const scores = scoreTraits([
      { dim: 'a', key: 1, value: 3 },
      { dim: 'b', key: 1, value: 4 },
      { dim: 'c', key: 1, value: 1 },
    ], 4);
    expect(topKeys(scores, 2, ['c', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('breaks exact ties using the caller-supplied order', () => {
    const scores = scoreTraits([
      { dim: 'x', key: 1, value: 2 },
      { dim: 'y', key: 1, value: 2 },
    ], 4);
    expect(topKeys(scores, 1, ['y', 'x'])).toEqual(['y']);
  });

  it('skips dimensions that were never answered', () => {
    const scores = scoreTraits([{ dim: 'only', key: 1, value: 4 }], 4);
    scores.ghost = { raw: 0, max: 0, pct: 0, points: 0, pointsMax: 0, count: 0, skipped: 0 };
    expect(topKeys(scores, 5)).toEqual(['only']);
  });
});

describe('itemLean', () => {
  it('maps a forward-keyed answer straight onto 0..1', () => {
    expect(itemLean(0, 1, 4)).toBe(0);
    expect(itemLean(2, 1, 4)).toBe(0.5);
    expect(itemLean(4, 1, 4)).toBe(1);
  });

  it('flips a reverse-keyed answer, which is what makes two people comparable', () => {
    // Agreeing with a reverse-keyed item is evidence toward the LOW pole.
    expect(itemLean(4, -1, 4)).toBe(0);
    expect(itemLean(0, -1, 4)).toBe(1);
  });

  it('returns null for a skipped answer so it can be excluded', () => {
    expect(itemLean(null, 1, 4)).toBeNull();
    expect(itemLean(undefined, 1, 4)).toBeNull();
  });

  it('clamps out-of-range values', () => {
    expect(itemLean(99, 1, 4)).toBe(1);
    expect(itemLean(-3, 1, 4)).toBe(0);
  });

  it('never divides by zero when the scale has a single point', () => {
    expect(itemLean(0, 1, 0)).toBe(0);
  });
});

describe('compareResponses', () => {
  const max = 4;
  // A full response, as QuizPage builds it: the item plus the chosen value.
  const r = (text, dim, value, key = 1) => ({ text, dim, key, value });

  it('scores identical answers as perfect alignment', () => {
    const a = [r('Save vs spend', 'money', 4), r('Children', 'family', 0)];
    const b = [r('Save vs spend', 'money', 4), r('Children', 'family', 0)];
    const { overallPct, byDim, items } = compareResponses(a, b, max);
    expect(overallPct).toBe(100);
    expect(byDim.money.pct).toBe(100);
    expect(byDim.family.pct).toBe(100);
    expect(items.every((i) => i.gap === 0)).toBe(true);
    expect(items[0].text).toBe('Save vs spend');
  });

  it('scores opposite poles as no alignment', () => {
    const { overallPct, items } = compareResponses([r('x', 'money', 4)], [r('x', 'money', 0)], max);
    expect(overallPct).toBe(0);
    expect(items[0].gap).toBe(1);
  });

  it('scores a one-step difference as partially aligned', () => {
    const { overallPct } = compareResponses([r('x', 'money', 4)], [r('x', 'money', 3)], max);
    expect(overallPct).toBe(75);
  });

  it('honours reverse-keying when comparing', () => {
    // Agreeing with a reverse-keyed item and disagreeing with its forward twin
    // are the SAME lean, so these two must come out fully aligned.
    const same = compareResponses([r('x', 'd', 4, -1)], [r('x', 'd', 0, 1)], max);
    expect(same.overallPct).toBe(100);
    // ...whereas agreeing with both is a genuine disagreement.
    const opposite = compareResponses([r('x', 'd', 4, -1)], [r('x', 'd', 4, 1)], max);
    expect(opposite.overallPct).toBe(0);
  });

  it('drops items either person skipped rather than calling them a mismatch', () => {
    const { overallPct, items, byDim } = compareResponses(
      [r('a', 'money', 4), r('b', 'family', null)],
      [r('a', 'money', 4), r('b', 'family', 0)],
      max,
    );
    expect(items).toHaveLength(1);
    expect(overallPct).toBe(100);
    expect(byDim.family).toBeUndefined();
  });

  it('averages per area and overall independently', () => {
    const a = [r('a', 'money', 4), r('b', 'money', 4), r('c', 'family', 4), r('d', 'family', 4)];
    const b = [r('a', 'money', 4), r('b', 'money', 4), r('c', 'family', 0), r('d', 'family', 0)];
    const { overallPct, byDim } = compareResponses(a, b, max);
    expect(byDim.money.pct).toBe(100);
    expect(byDim.family.pct).toBe(0);
    expect(overallPct).toBe(50);
  });

  it('exposes the gap so the biggest differences can be surfaced first', () => {
    const a = [r('a', 'money', 4), r('b', 'family', 3)];
    const b = [r('a', 'money', 0), r('b', 'family', 2)];
    const { items } = compareResponses(a, b, max);
    const sorted = items.slice().sort((x, y) => y.gap - x.gap);
    expect(sorted[0].text).toBe('a');
    expect(sorted[0].gap).toBe(1);
    expect(sorted[1].gap).toBeCloseTo(0.25);
  });

  it('carries both partners’ leans through for display', () => {
    const { items } = compareResponses([r('a', 'money', 4)], [r('a', 'money', 0)], max);
    expect(items[0]).toMatchObject({ aValue: 4, bValue: 0, leanA: 1, leanB: 0 });
  });

  it('returns an empty, non-crashing result for no answers', () => {
    expect(compareResponses([], [], max)).toEqual({ overallPct: 0, byDim: {}, items: [] });
    expect(compareResponses(undefined, undefined, max).overallPct).toBe(0);
  });
});

describe('bandFor', () => {
  const bands = [
    { min: 0, max: 9, label: 'Low' },
    { min: 10, max: 19, label: 'Moderate' },
    { min: 20, max: 100, label: 'High' },
  ];

  it('picks the band containing the value', () => {
    expect(bandFor(0, bands).label).toBe('Low');
    expect(bandFor(9, bands).label).toBe('Low');
    expect(bandFor(10, bands).label).toBe('Moderate');
    expect(bandFor(20, bands).label).toBe('High');
  });

  it('falls back to the last band above the range rather than returning nothing', () => {
    expect(bandFor(999, [{ min: 0, max: 10, label: 'Only' }]).label).toBe('Only');
  });

  it('returns null when there are no bands', () => {
    expect(bandFor(5, [])).toBeNull();
    expect(bandFor(5, undefined)).toBeNull();
  });
});

describe('strengthLabel', () => {
  it.each([
    [0, 'Low'],
    [39.9, 'Low'],
    [40, 'Balanced'],
    [69.9, 'Balanced'],
    [70, 'High'],
    [100, 'High'],
  ])('labels %p as %p', (pct, expected) => {
    expect(strengthLabel(pct)).toBe(expected);
  });
});

describe('selectItemIndices', () => {
  // A stand-in for a real config: 4 dimensions, 6 items each, half reverse-keyed.
  const build = (dims = 4, perDim = 6) => {
    const items = [];
    for (let d = 0; d < dims; d += 1) {
      for (let i = 0; i < perDim; i += 1) {
        items.push({ dim: `d${d}`, key: i % 2 === 0 ? 1 : -1, text: `d${d}-${i}` });
      }
    }
    return items;
  };

  const dimsOf = (items, indices) => new Set(indices.map((i) => items[i].dim));

  it('returns everything when the count is missing, zero, or the whole set', () => {
    const items = build();
    const all = items.map((_, i) => i);
    expect(selectItemIndices(items, null)).toEqual(all);
    expect(selectItemIndices(items, 0)).toEqual(all);
    expect(selectItemIndices(items, undefined)).toEqual(all);
    expect(selectItemIndices(items, items.length)).toEqual(all);
    expect(selectItemIndices(items, items.length + 10)).toEqual(all);
  });

  it('returns exactly the requested number of items', () => {
    const items = build();
    [4, 8, 12, 16, 20].forEach((n) => {
      expect(selectItemIndices(items, n)).toHaveLength(n);
    });
  });

  it('keeps every dimension represented, however short the quiz gets', () => {
    const items = build(4, 6);
    [4, 8, 12, 16].forEach((n) => {
      expect(dimsOf(items, selectItemIndices(items, n)).size).toBe(4);
    });
  });

  it('splits an uneven count across dimensions rather than dumping it on one', () => {
    const items = build(4, 6);
    const counts = {};
    selectItemIndices(items, 10).forEach((i) => {
      counts[items[i].dim] = (counts[items[i].dim] || 0) + 1;
    });
    const spread = Object.values(counts);
    expect(spread.reduce((a, b) => a + b, 0)).toBe(10);
    // 10 across 4 dimensions: 3/3/2/2, never 10/0/0/0 or 4/4/1/1.
    expect(Math.max(...spread) - Math.min(...spread)).toBeLessThanOrEqual(1);
  });

  it('preserves the forward / reverse key mix inside a dimension', () => {
    // The whole point: a short quiz must not become all forward-keyed.
    const items = build(4, 6); // 3 forward + 3 reverse per dimension
    const selected = selectItemIndices(items, 8); // 2 per dimension
    const perDim = {};
    selected.forEach((i) => {
      const d = items[i].dim;
      perDim[d] = perDim[d] || { fwd: 0, rev: 0 };
      if (items[i].key >= 0) perDim[d].fwd += 1;
      else perDim[d].rev += 1;
    });
    Object.values(perDim).forEach(({ fwd, rev }) => {
      expect(fwd).toBe(1);
      expect(rev).toBe(1);
    });
  });

  it('spaces its picks through a dimension instead of taking the first n', () => {
    const items = build(1, 6);
    const shortest = selectItemIndices(items, 2);
    expect(shortest).not.toEqual([0, 1]);
    // 3 forward (0,2,4) + 3 reverse (1,3,5): one of each, taken from the MIDDLE
    // of each half — so the pick is not the opening pair of the block.
    expect(shortest).toEqual([2, 3]);
    expect(selectItemIndices(items, 3)).not.toEqual([0, 1, 2]);
  });

  it('always includes items flagged core, and counts them against the budget', () => {
    // The ADHD screener: 6 core items (its Part A) then 12 ordinary ones.
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({ dim: i < 3 ? 'attention' : 'energy', key: 1, text: `core${i}`, core: true })),
      ...Array.from({ length: 6 }, (_, i) => ({ dim: 'attention', key: 1, text: `b${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ dim: 'energy', key: 1, text: `b${i + 6}` })),
    ];
    const set = selectItemIndices(items, 6);
    expect(set).toHaveLength(6);
    expect(set).toEqual([0, 1, 2, 3, 4, 5]);
    expect(set.every((i) => items[i].core)).toBe(true);

    const longer = selectItemIndices(items, 12);
    expect(longer).toHaveLength(12);
    // The six core items are all still there...
    expect([0, 1, 2, 3, 4, 5].every((i) => longer.includes(i))).toBe(true);
    // ...and the remaining six are split evenly across the two dimensions.
    const extras = longer.filter((i) => i >= 6);
    expect(extras.filter((i) => items[i].dim === 'attention')).toHaveLength(3);
    expect(extras.filter((i) => items[i].dim === 'energy')).toHaveLength(3);
  });

  it('never drops a core item to hit a smaller target', () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => ({ dim: 'a', key: 1, text: `c${i}`, core: true })),
      ...Array.from({ length: 4 }, (_, i) => ({ dim: 'a', key: 1, text: `r${i}` })),
    ];
    expect(selectItemIndices(items, 2)).toEqual([0, 1, 2, 3]);
  });

  it('groups the guided quiz by set, since its questions have no dimension', () => {
    const items = Array.from({ length: 36 }, (_, i) => ({ set: 'I', text: `q${i}` }))
      .map((item, i) => ({ ...item, set: i < 12 ? 'I' : i < 24 ? 'II' : 'III' }));
    const picked = selectItemIndices(items, 12);
    expect(picked).toHaveLength(12);
    const sets = new Set(picked.map((i) => items[i].set));
    expect(sets.size).toBe(3);
    expect(picked.filter((i) => items[i].set === 'I')).toHaveLength(4);
  });

  it('is deterministic, so a re-take only varies by the shuffle the page applies', () => {
    const items = build();
    expect(selectItemIndices(items, 12)).toEqual(selectItemIndices(items, 12));
  });

  it('returns ascending indices so the original order is preserved', () => {
    const indices = selectItemIndices(build(), 12);
    expect(indices).toEqual(indices.slice().sort((a, b) => a - b));
  });

  it('keeps every scoreable dimension scoreable at the shortest setting', () => {
    // The real check: a shortened run must still produce a pct per dimension.
    const items = build(4, 6);
    const indices = selectItemIndices(items, 4);
    const responses = indices.map((i) => ({ ...items[i], value: 4 }));
    const scores = scoreTraits(responses, 4);
    expect(Object.keys(scores).sort()).toEqual(['d0', 'd1', 'd2', 'd3']);
    Object.values(scores).forEach((bucket) => expect(bucket.count).toBe(1));
  });

  it('copes with an empty list and a list with no dimensions', () => {
    expect(selectItemIndices([], 5)).toEqual([]);
    expect(selectItemIndices(undefined, 5)).toEqual([]);
    const flat = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }];
    expect(selectItemIndices(flat, 2)).toHaveLength(2);
  });
});
