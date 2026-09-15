/**
 * GoalMap.jsx — the /plans "Map" view: the goals as a node graph.
 *
 * The graph is NOT computed in the browser. A button asks the backend to run the
 * AI over the stored goals once (`POST /csimple/goal-map`), and the result is
 * saved as the `map/goal-map` workspace item, so this view normally renders from
 * a stored snapshot and only spends a credit when you press Update.
 *
 * The AI's answers are on the axes that matter here: categories become LANES
 * (left → right in the order the AI returned them, so position carries "these
 * belong together" and "this group comes first"), the AI's `order` becomes the
 * sequence down a lane, and its `dependsOn` becomes the arrows — drawn from the
 * prerequisite to the thing that depends on it.
 *
 * Deliberate non-features, so they don't get "fixed" back in: a node opens its
 * goal and does nothing else (no running a goal from the map), and hovering a
 * link does not explain the dependency (the AI's reason isn't stored per edge, so
 * anything shown there would be invented).
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWorkspaceItem, generateGoalMapViaBackend } from '../../../services/workspaceApi.js';
import { STATUS_LABELS } from './plansUtils.js';
import { layoutGoalMap, goalMapDrift, truncateLabel } from './goalMapUtils.js';
import './GoalMap.css';

const MAP_KIND = 'map';
const MAP_SLUG = 'goal-map';

/** One glyph per goal status — scannable without reading words. */
const STATUS_GLYPHS = {
  active: '●',
  blocked: '■',
  paused: '‖',
  done: '✓',
  failed: '✕',
};

/** Characters of a goal title that fit a node. Measured, not guessed: at 12.5px
 *  semi-bold a 26-character label ends ~32px short of the node's right edge, so
 *  the cut is set here rather than at the exact fit. A title of nothing but W's
 *  still runs wide — the per-lane clip path in the SVG is the backstop for that,
 *  since measuring real glyph runs per node would mean a layout pass per render. */
const LABEL_CHARS = 26;

/** Parse the stored map out of its workspace item. Bad JSON is an empty state. */
function parseStoredMap(item) {
  if (!item?.content) return null;
  try {
    const parsed = JSON.parse(item.content);
    return parsed && Array.isArray(parsed.nodes) && parsed.nodes.length ? parsed : null;
  } catch {
    return null;
  }
}

/** Local date+time for a generatedAt stamp, or '' when it can't be read. */
function formatStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Category ids are slugs from the backend, but a node can name one the map never
 *  declared, so an id safe to put in an SVG `url(#...)` is built here. */
function clipId(categoryId) {
  return String(categoryId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** The one-line "what changed since" sentence, or '' when the map is current. */
function driftNote(drift) {
  const bits = [];
  if (drift.added.length) bits.push(`${plural(drift.added.length, 'new goal')} since this map was made`);
  if (drift.removed.length) bits.push(`${plural(drift.removed.length, 'goal')} in this map ${drift.removed.length === 1 ? 'is' : 'are'} gone`);
  return bits.length ? `${bits.join(' · ')} — update to rebuild.` : '';
}

export default function GoalMap({ goals = [], token, onOpen }) {
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  // `useId` output is already unique per component instance, but it carries
  // colons — unusable in a `url(#...)` reference, hence the strip.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const arrowId = `${uid}-arrow`;

  // Read the stored map once per session (per token). A missing or unreadable
  // snapshot is an empty state, not an error — the view's job is to offer the
  // Generate button, not to complain.
  useEffect(() => {
    let alive = true;
    if (!token) {
      setMap(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    getWorkspaceItem(token, MAP_KIND, MAP_SLUG)
      .then((item) => { if (alive) setMap(parseStoredMap(item)); })
      .catch(() => { if (alive) setMap(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const generate = useCallback(async () => {
    if (!token || generating) return;
    setGenerating(true);
    setError(null);
    setNotice('');
    try {
      const res = await generateGoalMapViaBackend(token);
      if (res?.map) {
        setMap(res.map);
        const { stats = {} } = res.map;
        setNotice(`Map updated — ${plural(stats.mappedGoals ?? res.map.nodes.length, 'goal')} in ${plural(stats.categoryCount ?? res.map.categories.length, 'group')}.`);
      } else {
        setNotice('There is nothing to map yet — add a goal first.');
      }
    } catch (e) {
      setError({ message: e?.message || 'The map could not be generated.', upgradeUrl: e?.upgradeUrl || null });
    } finally {
      setGenerating(false);
    }
  }, [token, generating]);

  const layout = useMemo(() => layoutGoalMap(map), [map]);
  const drift = useMemo(() => goalMapDrift(map, goals), [map, goals]);
  const goalBySlug = useMemo(
    () => new Map(goals.filter((g) => g?._id).map((g) => [g._id, g])),
    [goals],
  );

  const stats = map?.stats || {};
  // A saved map with no goals left is every node "gone" — it would sit next to
  // the empty state contradicting it. The snapshot stays stored either way, so
  // it comes back the moment a goal does.
  const showMap = Boolean(map) && goals.length > 0;
  const stamp = formatStamp(map?.generatedAt);
  const meta = map
    ? [
      plural(layout.nodeCount, 'goal'),
      plural(layout.laneCount, 'group'),
      layout.edgeCount ? plural(layout.edgeCount, 'link') : 'no links yet',
      stamp ? `generated ${stamp}` : '',
      stats.truncated ? 'longest goals left out' : '',
    ].filter(Boolean).join(' · ')
    : '';
  const driftLine = driftNote(drift);

  return (
    <section className="goal-map" aria-label="Goal map">
      <header className="goal-map-head">
        <div className="goal-map-heading">
          <h2 className="goal-map-title">Goal map</h2>
          <p className="goal-map-meta">
            {loading ? 'Loading saved map…' : meta || 'The AI groups your goals by theme, then orders them by what has to come first.'}
          </p>
        </div>
        <button
          type="button"
          className="plans-btn plans-btn--primary plans-btn--sm goal-map-generate"
          onClick={generate}
          disabled={generating || !token || !goals.length}
          title={!goals.length ? 'Add a goal first' : 'Re-run the AI over your current goals'}
        >
          {generating ? 'Mapping…' : map ? '↻ Update map' : '✨ Generate map'}
        </button>
      </header>

      {generating && (
        <p className="goal-map-progress" role="status">Reading your goals and laying out the graph…</p>
      )}
      {!generating && notice && <p className="goal-map-notice" role="status">{notice}</p>}
      {error && (
        <p className="goal-map-error" role="alert">
          {error.message}
          {' '}
          {error.upgradeUrl && <Link to={error.upgradeUrl}>See plans</Link>}
        </p>
      )}
      {/* Only ever alongside a shown map: with nothing saved, "N new goals since
          this map was made" would be describing a map that doesn't exist. */}
      {showMap && driftLine && !generating && <p className="goal-map-note">⚠️ {driftLine}</p>}

      {!loading && !goals.length && (
        <p className="goal-map-empty">
          No goals yet. Add a goal — or a few related ones — and the map can organise them
          into groups and a sequence.
        </p>
      )}

      {!loading && goals.length > 0 && !map && (
        <p className="goal-map-empty">
          No map yet. Generate one and the AI will sort your goals into thematic groups,
          order them by expected dependency, and draw the links between them.
        </p>
      )}

      {showMap && (
        <div className="goal-map-canvas" tabIndex={0} role="group" aria-label="Goal graph, scrollable">
          <svg
            className="goal-map-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={`${plural(layout.laneCount, 'group')}, ${plural(layout.nodeCount, 'goal')}, ${plural(layout.edgeCount, 'link')}`}
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="goal-map-arrowhead" />
              </marker>
              {/* One clip per lane, so a node label that runs wide is cut at the
                  lane's edge instead of crossing into the next group. The edges
                  are NOT inside these groups — they have to cross lanes. The
                  rect is a pixel proud of the lane on each side so the lane's own
                  1px stroke is not half-clipped. */}
              {layout.lanes.map((lane) => (
                <clipPath key={lane.id} id={`${uid}-lane-${clipId(lane.id)}`}>
                  <rect
                    x={lane.x - 1}
                    y={lane.y - 1}
                    width={lane.width + 2}
                    height={lane.height + 2}
                    rx="16"
                  />
                </clipPath>
              ))}
            </defs>

            {layout.lanes.map((lane) => (
              <g key={lane.id} className="goal-map-lane" data-hue={lane.hue} clipPath={`url(#${uid}-lane-${clipId(lane.id)})`}>
                <rect
                  className="goal-map-lane-bg"
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  rx="16"
                />
                <text className="goal-map-lane-label" x={lane.x + 14} y={lane.y + 19}>
                  {truncateLabel(lane.label, 22).toUpperCase()}
                </text>
                <text
                  className="goal-map-lane-count"
                  x={lane.x + lane.width - 14}
                  y={lane.y + 19}
                  textAnchor="end"
                >
                  {lane.count}
                </text>
              </g>
            ))}

            {/* Links first, so a node always sits on top of its own arrows. */}
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                className="goal-map-edge"
                d={edge.d}
                markerEnd={`url(#${arrowId})`}
              />
            ))}

            {layout.nodes.map((node) => {
              const goal = goalBySlug.get(node.slug);
              const status = goal?.data?.status || 'active';
              const glyph = STATUS_GLYPHS[status] || STATUS_GLYPHS.active;
              const label = truncateLabel(node.title || goal?.data?.title || node.slug, LABEL_CHARS);
              const openable = !!goal && typeof onOpen === 'function';
              const statusWord = STATUS_LABELS[status] || status;
              const fullTitle = node.title || goal?.data?.title || node.slug;
              return (
                <g
                  key={node.slug}
                  className={`goal-map-node ${openable ? 'is-openable' : 'is-gone'}`}
                  data-hue={node.hue}
                  data-status={status}
                  role={openable ? 'button' : undefined}
                  tabIndex={openable ? 0 : undefined}
                  aria-label={openable ? `${fullTitle} — ${statusWord}` : `${fullTitle} — no longer exists`}
                  onClick={openable ? () => onOpen(goal) : undefined}
                  onKeyDown={openable ? (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onOpen(goal);
                    }
                  } : undefined}
                >
                  <rect
                    className="goal-map-node-bg"
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="12"
                  />
                  <rect
                    className="goal-map-node-rail"
                    x={node.x}
                    y={node.y + 9}
                    width="3"
                    height={node.height - 18}
                    rx="1.5"
                  />
                  <text className="goal-map-node-glyph" x={node.x + 14} y={node.centerY + 4}>
                    {glyph}
                  </text>
                  <text className="goal-map-node-title" x={node.x + 32} y={node.centerY + 4}>
                    {label}
                  </text>
                  {/* Native tooltip: the label is ellipsized, the title is not. */}
                  <title>{`${fullTitle} — ${statusWord}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {showMap && (
        <ul className="goal-map-legend" aria-label="Groups">
          {layout.lanes.map((lane) => (
            <li key={lane.id} className="goal-map-legend-item" data-hue={lane.hue}>
              <span className="goal-map-legend-swatch" aria-hidden="true" />
              <span className="goal-map-legend-label">{lane.label}</span>
              <span className="goal-map-legend-count">{lane.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
