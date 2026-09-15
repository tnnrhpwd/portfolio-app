/**
 * goalMapUtils.test.js — geometry for the /plans Map view.
 *
 * These tests are about promises the renderer relies on: lanes in the AI's
 * order, nodes in the AI's sequence, and — the one that is easy to get backwards
 * — arrows pointing from a prerequisite to the thing that depends on it.
 */

import {
  layoutGoalMap,
  goalMapDrift,
  truncateLabel,
  MAP_GEOMETRY,
} from './goalMapUtils.js';

const node = (slug, category, order, dependsOn = []) => ({
  slug,
  title: slug.toUpperCase(),
  category,
  order,
  dependsOn,
});

const map = (categories, nodes) => ({ version: 1, categories, nodes });

describe('layoutGoalMap', () => {
  test('returns a zeroed shape for a missing or empty map', () => {
    for (const input of [null, undefined, {}, { nodes: [] }]) {
      const layout = layoutGoalMap(input);
      expect(layout.lanes).toEqual([]);
      expect(layout.nodes).toEqual([]);
      expect(layout.edges).toEqual([]);
      expect(layout.width).toBe(0);
      expect(layout.height).toBe(0);
    }
  });

  test('lays out one lane per category, left to right in the AI order', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'art', label: 'Art' }],
      [node('a', 'web', 1), node('b', 'art', 1)],
    ));

    expect(layout.lanes.map((l) => l.id)).toEqual(['web', 'art']);
    expect(layout.lanes[0].label).toBe('Web');
    // Left-to-right, and not overlapping.
    expect(layout.lanes[1].x).toBeGreaterThan(layout.lanes[0].x + layout.lanes[0].width);
  });

  test('the catch-all lane keeps its place at the end', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'other', label: 'Other' }],
      [node('a', 'other', 1), node('b', 'web', 1)],
    ));

    expect(layout.lanes.map((l) => l.id)).toEqual(['web', 'other']);
  });

  test('nodes stack in the AI sequence, not in array order', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }],
      [node('third', 'web', 3), node('first', 'web', 1), node('second', 'web', 2)],
    ));

    const ys = ['first', 'second', 'third'].map((slug) => layout.nodes.find((n) => n.slug === slug).y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  test('a long lane wraps into sub-columns instead of one tall strip', () => {
    const many = Array.from({ length: MAP_GEOMETRY.maxRows + 3 }, (_, i) => node(`g${i}`, 'web', i + 1));
    const layout = layoutGoalMap(map([{ id: 'web', label: 'Web' }], many));

    const lane = layout.lanes[0];
    expect(lane.cols).toBe(2);
    expect(lane.count).toBe(MAP_GEOMETRY.maxRows + 3);

    const wrapped = layout.nodes.filter((n) => n.col === 1);
    expect(wrapped).toHaveLength(3);
    // The wrapped column sits to the right of the first, still inside the lane.
    expect(wrapped[0].x).toBeGreaterThan(layout.nodes.find((n) => n.col === 0).x);
    expect(wrapped[0].x + wrapped[0].width).toBeLessThanOrEqual(lane.x + lane.width);
  });

  test('declared categories with no nodes get no empty lane', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'ghost', label: 'Ghost' }, { id: 'art', label: 'Art' }],
      [node('a', 'web', 1), node('b', 'art', 1)],
    ));

    expect(layout.lanes.map((l) => l.id)).toEqual(['web', 'art']);
  });

  test('a node naming an undeclared category still gets a lane', () => {
    const layout = layoutGoalMap(map([{ id: 'web', label: 'Web' }], [node('a', 'web', 1), node('b', 'mystery', 1)]));

    expect(layout.lanes.map((l) => l.id)).toEqual(['web', 'mystery']);
    expect(layout.nodes.find((n) => n.slug === 'b').laneId).toBe('mystery');
  });

  test('lanes cycle through the hue ramp', () => {
    const cats = Array.from({ length: MAP_GEOMETRY.hueCount + 2 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));
    const layout = layoutGoalMap(map(cats, cats.map((c, i) => node(`g${i}`, c.id, 1))));

    expect(layout.lanes).toHaveLength(MAP_GEOMETRY.hueCount + 2);
    expect(layout.lanes[0].hue).toBe(0);
    expect(layout.lanes[MAP_GEOMETRY.hueCount].hue).toBe(0);
    expect(layout.lanes[MAP_GEOMETRY.hueCount + 1].hue).toBe(1);
  });

  test('the canvas is big enough to hold every lane and node', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'art', label: 'Art' }],
      [node('a', 'web', 1), node('b', 'web', 2), node('c', 'art', 1)],
    ));

    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
    }
    const lastLane = layout.lanes[layout.lanes.length - 1];
    expect(lastLane.x + lastLane.width).toBeLessThanOrEqual(layout.width);
  });
});

describe('layoutGoalMap edges', () => {
  test('an edge runs from the prerequisite to the dependent', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'art', label: 'Art' }],
      [node('setup', 'web', 1), node('ship', 'art', 1, ['setup'])],
    ));

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].from).toBe('setup');
    expect(layout.edges[0].to).toBe('ship');
    // Forward in reading order: it leaves the prerequisite's right edge and
    // enters the dependent's left edge, so it crosses the gap between lanes.
    const setup = layout.nodes.find((n) => n.slug === 'setup');
    const ship = layout.nodes.find((n) => n.slug === 'ship');
    expect(layout.edges[0].orientation).toBe('right');
    expect(layout.edges[0].fromX).toBe(setup.x + setup.width);
    expect(layout.edges[0].toX).toBe(ship.x);
    expect(layout.edges[0].d.startsWith('M ')).toBe(true);
  });

  test('a dependency pointing backwards across the canvas is anchored left', () => {
    // `ship` sits in the FIRST lane but depends on `brand`, which sits in the
    // second — the arrow has to travel right-to-left to reach it.
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'art', label: 'Art' }],
      [node('brand', 'art', 1), node('ship', 'web', 1, ['brand'])],
    ));

    const brand = layout.nodes.find((n) => n.slug === 'brand');
    const ship = layout.nodes.find((n) => n.slug === 'ship');
    expect(layout.edges[0].orientation).toBe('left');
    expect(layout.edges[0].fromX).toBe(brand.x);
    expect(layout.edges[0].toX).toBe(ship.x + ship.width);
  });

  test('a same-lane dependency leaves the bottom and enters the top', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }],
      [node('one', 'web', 1), node('two', 'web', 2, ['one'])],
    ));

    const one = layout.nodes.find((n) => n.slug === 'one');
    const two = layout.nodes.find((n) => n.slug === 'two');
    const edge = layout.edges[0];
    expect(edge.orientation).toBe('down');
    expect(edge.fromY).toBe(one.y + one.height);
    expect(edge.toY).toBe(two.y);
  });

  test('duplicate, self and unknown dependencies are dropped', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }],
      [
        node('one', 'web', 1),
        node('two', 'web', 2, ['one', 'one', 'two', 'ghost']),
      ],
    ));

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].id).toBe('one->two');
  });

  test('a two-way reference produces no self edge and no crash', () => {
    const layout = layoutGoalMap(map(
      [{ id: 'web', label: 'Web' }, { id: 'art', label: 'Art' }],
      [node('a', 'web', 1, ['b']), node('b', 'art', 1, ['a'])],
    ));

    expect(layout.edges.map((e) => e.id).sort()).toEqual(['a->b', 'b->a']);
  });
});

describe('truncateLabel', () => {
  test('leaves short labels alone and ellipsizes long ones', () => {
    expect(truncateLabel('Ship the thing')).toBe('Ship the thing');
    const long = truncateLabel('a'.repeat(40), 10);
    expect(long).toHaveLength(10);
    expect(long.endsWith('…')).toBe(true);
    expect(truncateLabel(null)).toBe('');
  });
});

describe('goalMapDrift', () => {
  const saved = map([{ id: 'web', label: 'Web' }], [node('a', 'web', 1), node('b', 'web', 2)]);
  const item = (slug) => ({ _id: slug, type: 'goal' });

  test('reports nothing when the map matches the goals', () => {
    expect(goalMapDrift(saved, [item('a'), item('b')])).toEqual({ added: [], removed: [], stale: false });
  });

  test('reports goals added and removed since the map was generated', () => {
    const drift = goalMapDrift(saved, [item('a'), item('c')]);
    expect(drift.added).toEqual(['c']);
    expect(drift.removed).toEqual(['b']);
    expect(drift.stale).toBe(true);
  });

  test('treats a missing map as a whole-set drift', () => {
    const drift = goalMapDrift(null, [item('a')]);
    expect(drift.added).toEqual(['a']);
    expect(drift.removed).toEqual([]);
  });
});
