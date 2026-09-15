/**
 * goalMapUtils.js — pure geometry + shape helpers for the /plans Map view.
 *
 * The map is produced by the AI (`backend/services/goalMap.js`) and stored as the
 * `map/goal-map` workspace item. Its shape is:
 *
 *   {
 *     version: 1,
 *     generatedAt: ISO string,
 *     categories: [{ id, label }],              // AI's order; 'other' always last
 *     nodes: [{ slug, title, category, order, dependsOn: [slug] }],
 *     stats: { categoryCount, edgeCount, totalGoals, mappedGoals, truncated }
 *   }
 *
 * This module turns that into pixel positions and nothing else — the maths stays
 * out of the component so a lane/edge regression is testable without mounting an
 * SVG (see `goalMapUtils.test.js`).
 *
 * LAYOUT: one lane per category, running left → right in the order the AI
 * returned them, so a lane's position is itself part of the answer ("these five
 * belong together, and this group comes first"). Nodes stack down a lane in the
 * AI's `order`. A lane longer than `maxRows` wraps into a second sub-column
 * inside the same lane rather than becoming a 100-row strip to scroll through.
 *
 * EDGES point PREREQUISITE → DEPENDENT. `dependsOn` on a node names what has to
 * happen first, so the arrow is drawn FROM `dependsOn[i]` TO the node — i.e. in
 * the direction the work flows — and it enters the dependent node. Worth stating
 * plainly because the source array reads the other way round.
 */

/** Geometry defaults. Every value is overridable per call (tests use small ones). */
export const MAP_GEOMETRY = {
  colWidth: 208,   // node width, and the width of one sub-column
  colGap: 24,      // gap between wrapped sub-columns inside one lane
  laneGap: 32,     // gap between lanes
  lanePadX: 14,
  lanePadY: 12,
  laneHeader: 28,  // room for the lane's title bar
  nodeHeight: 44,
  nodeGap: 10,
  maxRows: 12,     // wrap a lane into another sub-column past this
  pad: 6,          // outer margin of the whole canvas
  hueCount: 8,     // hues defined in GoalMap.css; lanes cycle through them
};

const EMPTY = { width: 0, height: 0, lanes: [], nodes: [], edges: [] };

/** Lane id/label used for a node whose category the map never declared. */
const UNMAPPED = { id: '__unmapped__', label: 'Uncategorised' };

/** Sort key inside a lane: the AI's sequence first, then title for ties. */
function byOrderThenTitle(a, b) {
  const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return String(a.title || a.slug).localeCompare(String(b.title || b.slug));
}

/** Ellipsize `text` to `max` characters (SVG text has no text-overflow). */
export function truncateLabel(text, max = 26) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Lay out a map for rendering.
 *
 * @param {object|null} map - the stored map (see the shape above)
 * @param {object} [geometry] - overrides for MAP_GEOMETRY
 * @returns {{width:number, height:number, lanes:Array, nodes:Array, edges:Array,
 *   laneCount:number, nodeCount:number, edgeCount:number}} `lanes` and `nodes`
 *   carry pixel positions; `nodes` keeps every field of the source node (title,
 *   slug, category, order, dependsOn) so the renderer can read them directly.
 */
export function layoutGoalMap(map, geometry = MAP_GEOMETRY) {
  const g = { ...MAP_GEOMETRY, ...geometry };
  const source = Array.isArray(map?.nodes) ? map.nodes.filter((n) => n && n.slug) : [];
  if (!source.length) return { ...EMPTY, laneCount: 0, nodeCount: 0, edgeCount: 0 };

  // Lane order is the AI's category order. A category a node names but the map
  // never declared still gets a lane at the end, so no node is ever dropped.
  const declared = (Array.isArray(map?.categories) ? map.categories : []).filter((c) => c && c.id);
  const laneOrder = declared.map((c) => c.id);
  const laneLabels = new Map(declared.map((c) => [c.id, c.label || c.id]));
  for (const n of source) {
    const id = n.category || UNMAPPED.id;
    if (!laneOrder.includes(id)) {
      laneOrder.push(id);
      if (!laneLabels.has(id)) laneLabels.set(id, UNMAPPED.label);
    }
  }

  // Keep only lanes that actually hold a node: an empty lane is a column of
  // whitespace that makes the eye hunt for a group that isn't there.
  const lanes = [];
  let cursorX = g.pad;
  let tallest = 0;

  for (const id of laneOrder) {
    const members = source.filter((n) => (n.category || UNMAPPED.id) === id).sort(byOrderThenTitle);
    if (!members.length) continue;

    const cols = Math.max(1, Math.ceil(members.length / g.maxRows));
    const rows = Math.min(members.length, g.maxRows);
    const contentWidth = cols * g.colWidth + (cols - 1) * g.colGap;
    const width = contentWidth + g.lanePadX * 2;
    const height = g.laneHeader + g.lanePadY * 2 + rows * g.nodeHeight + (rows - 1) * g.nodeGap;
    const x = cursorX;
    const y = g.pad;
    const laneIndex = lanes.length;
    const lane = {
      id,
      label: laneLabels.get(id) || id,
      index: laneIndex,
      hue: laneIndex % g.hueCount,
      x,
      y,
      width,
      height,
      contentWidth,
      cols,
      count: members.length,
      nodeIds: members.map((n) => n.slug),
    };
    lanes.push(lane);
    cursorX += width + g.laneGap;
    tallest = Math.max(tallest, height);
  }

  // Node blocks, positioned inside their lane.
  const nodes = [];
  const bySlug = new Map();
  for (const lane of lanes) {
    const members = source.filter((n) => (n.category || UNMAPPED.id) === lane.id).sort(byOrderThenTitle);
    members.forEach((n, i) => {
      const col = Math.floor(i / g.maxRows);
      const row = i % g.maxRows;
      const x = lane.x + g.lanePadX + col * (g.colWidth + g.colGap);
      const y = lane.y + g.laneHeader + g.lanePadY + row * (g.nodeHeight + g.nodeGap);
      const node = {
        ...n,
        laneId: lane.id,
        laneIndex: lane.index,
        hue: lane.hue,
        row,
        col,
        x,
        y,
        width: g.colWidth,
        height: g.nodeHeight,
        centerX: x + g.colWidth / 2,
        centerY: y + g.nodeHeight / 2,
      };
      nodes.push(node);
      bySlug.set(n.slug, node);
    });
  }

  // Edges: prerequisite → dependent, deduped, self/unknown references dropped.
  const edges = [];
  const seen = new Set();
  for (const to of nodes) {
    for (const dep of Array.isArray(to.dependsOn) ? to.dependsOn : []) {
      const from = bySlug.get(dep);
      if (!from || from.slug === to.slug) continue;
      const key = `${from.slug}->${to.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let orientation;
      if (from.laneId === to.laneId) orientation = 'down';
      else if (to.x > from.x) orientation = 'right';
      else orientation = 'left';

      let fromX;
      let fromY;
      let toX;
      let toY;
      let c1x;
      let c1y;
      let c2x;
      let c2y;
      let d;

      if (orientation === 'down') {
        // Same lane: leave the bottom of the prerequisite, enter the top of the
        // dependent. A horizontal anchor here would loop backwards over the very
        // column the two nodes share.
        fromX = from.centerX;
        fromY = from.y + from.height;
        toX = to.centerX;
        toY = to.y;
        const dy = Math.max(12, (toY - fromY) / 2);
        d = `M ${fromX} ${fromY} C ${fromX} ${fromY + dy}, ${toX} ${toY - dy}, ${toX} ${toY}`;
      } else {
        const rightward = orientation === 'right';
        fromX = rightward ? from.x + from.width : from.x;
        toX = rightward ? to.x : to.x + to.width;
        fromY = from.centerY;
        toY = to.centerY;
        const dx = Math.max(24, Math.abs(toX - fromX) / 2);
        c1x = rightward ? fromX + dx : fromX - dx;
        c2x = rightward ? toX - dx : toX + dx;
        d = `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`;
      }

      edges.push({
        id: key,
        from: from.slug,
        to: to.slug,
        orientation,
        fromX,
        fromY,
        toX,
        toY,
        d,
      });
    }
  }

  return {
    width: Math.max(0, cursorX - g.laneGap + g.pad),
    height: g.pad * 2 + tallest,
    lanes,
    nodes,
    edges,
    laneCount: lanes.length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

/**
 * How the stored map differs from the goals on screen right now.
 *
 * A map is a snapshot: the AI ran once, and goals have been added or deleted
 * since. The view says so instead of pretending the snapshot is current, and
 * this is also what makes the Update button worth pressing.
 *
 * @param {object|null} map - the stored map
 * @param {Array} goals - current goal items (each with `_id` = slug)
 * @returns {{added:string[], removed:string[], stale:boolean}}
 */
export function goalMapDrift(map, goals) {
  const mapped = new Set((Array.isArray(map?.nodes) ? map.nodes : []).map((n) => n && n.slug).filter(Boolean));
  const current = (Array.isArray(goals) ? goals : []).map((g) => g?._id).filter(Boolean);
  const currentSet = new Set(current);
  const added = current.filter((slug) => !mapped.has(slug));
  const removed = [...mapped].filter((slug) => !currentSet.has(slug));
  return { added, removed, stale: added.length > 0 || removed.length > 0 };
}
