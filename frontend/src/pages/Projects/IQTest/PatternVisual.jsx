import React from 'react';

// Renders visual IQ-test items (dice, shapes, arrows) from small plain-object
// "tokens" instead of text, so the Pattern Matching category can look like the
// classic dice/shape/color visual reasoning puzzles rather than number series.
//
// Token shapes:
//   { type: 'die', value: 1-6 }
//   { type: 'shape', shape: 'circle'|'square'|'triangle'|'pentagon'|'hexagon'|'star'|'diamond', color }
//   { type: 'shapes', shape, color, count }              -- a cluster of N shapes
//   { type: 'arrow', dir: 'up'|'down'|'left'|'right'|'upright'|'downright'|'downleft'|'upleft', color }
//   { type: 'polydots', shape, dots, color }              -- polygon outline with N dots inside
//   { type: 'blank' }                                     -- "?" placeholder

export const COLORS = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#27ae60',
  yellow: '#f1c40f',
  purple: '#9b59b6',
  orange: '#e67e22',
  gray: '#7f8c8d',
};

const DIE_PIP_LAYOUT = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};

function DieFace({ value, size = 64 }) {
  const pips = DIE_PIP_LAYOUT[value] || [];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="pv-die" role="img" aria-label={`Die showing ${value}`}>
      <rect x="4" y="4" width="92" height="92" rx="16" fill="#fff" stroke="#2c3e50" strokeWidth="5" />
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="9" fill="#2c3e50" />
      ))}
    </svg>
  );
}

function regularPolygonPoints(sides, rotationDeg = -90) {
  const cx = 50;
  const cy = 50;
  const r = 40;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 * i) / sides + (rotationDeg * Math.PI) / 180;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts.map((p) => p.join(',')).join(' ');
}

function starPoints() {
  const cx = 50;
  const cy = 50;
  const rOuter = 42;
  const rInner = 18;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI * i) / 5 - Math.PI / 2;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts.map((p) => p.join(',')).join(' ');
}

// Maps each named shape to the outline it should render. Square/diamond both
// use a 4-gon but with different starting rotation so one renders axis-aligned
// (square) and the other point-up (diamond).
function shapeOutline(shape) {
  switch (shape) {
    case 'circle': return null; // handled specially below
    case 'triangle': return regularPolygonPoints(3);
    case 'square': return regularPolygonPoints(4, -45);
    case 'diamond': return regularPolygonPoints(4, -90);
    case 'pentagon': return regularPolygonPoints(5);
    case 'hexagon': return regularPolygonPoints(6);
    case 'star': return starPoints();
    default: return regularPolygonPoints(4, -45);
  }
}

function ShapeIcon({ shape, color = 'gray', size = 64 }) {
  const fill = COLORS[color] || color;
  const label = `${color} ${shape}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="pv-shape" role="img" aria-label={label}>
      {shape === 'circle' ? (
        <circle cx="50" cy="50" r="38" fill={fill} stroke="#2c3e50" strokeWidth="3" />
      ) : (
        <polygon points={shapeOutline(shape)} fill={fill} stroke="#2c3e50" strokeWidth="3" />
      )}
    </svg>
  );
}

function ShapeGroup({ shape, color, count, size = 64 }) {
  const mini = Math.max(16, Math.min(28, Math.floor((size * 1.6) / Math.max(count, 1))));
  return (
    <div className="pv-shape-group" style={{ width: size, height: size }} aria-label={`${count} ${color} ${shape}${count === 1 ? '' : 's'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <ShapeIcon key={i} shape={shape} color={color} size={mini} />
      ))}
    </div>
  );
}

const ARROW_ROTATION = {
  up: 0,
  upright: 45,
  right: 90,
  downright: 135,
  down: 180,
  downleft: 225,
  left: 270,
  upleft: 315,
};

function ArrowIcon({ dir, color = 'gray', size = 64 }) {
  const rotation = ARROW_ROTATION[dir] ?? 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="pv-arrow"
      style={{ transform: `rotate(${rotation}deg)` }}
      role="img"
      aria-label={`arrow pointing ${dir}`}
    >
      <polygon points="50,8 86,50 64,50 64,92 36,92 36,50 14,50" fill={COLORS[color] || color} stroke="#2c3e50" strokeWidth="3" />
    </svg>
  );
}

function PolyDots({ shape, dots, color = 'gray', size = 64 }) {
  const layout = DIE_PIP_LAYOUT[dots] || DIE_PIP_LAYOUT[6];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="pv-polydots" role="img" aria-label={`${shape} with ${dots} dots`}>
      {shape === 'circle' ? (
        <circle cx="50" cy="50" r="38" fill="#fff" stroke={COLORS[color] || color} strokeWidth="4" />
      ) : (
        <polygon points={shapeOutline(shape)} fill="#fff" stroke={COLORS[color] || color} strokeWidth="4" />
      )}
      {layout.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill={COLORS[color] || color} />
      ))}
    </svg>
  );
}

function Blank({ size = 64 }) {
  return (
    <div className="pv-blank" style={{ width: size, height: size }} aria-label="unknown, to be determined">
      <span>?</span>
    </div>
  );
}

export function PatternCell({ token, size = 64 }) {
  if (!token || token.type === 'blank') return <Blank size={size} />;
  switch (token.type) {
    case 'die':
      return <DieFace value={token.value} size={size} />;
    case 'shape':
      return <ShapeIcon shape={token.shape} color={token.color} size={size} />;
    case 'shapes':
      return <ShapeGroup shape={token.shape} color={token.color} count={token.count} size={size} />;
    case 'arrow':
      return <ArrowIcon dir={token.dir} color={token.color} size={size} />;
    case 'polydots':
      return <PolyDots shape={token.shape} dots={token.dots} color={token.color} size={size} />;
    default:
      return null;
  }
}

// A left-to-right row of prompt cells followed by a "?" cell representing the
// missing next item the player must pick from the options.
export function PatternSequence({ items, size = 64 }) {
  return (
    <div className="pv-sequence">
      {items.map((tok, i) => (
        <React.Fragment key={i}>
          <div className="pv-cell"><PatternCell token={tok} size={size} /></div>
          <span className="pv-arrow-sep" aria-hidden="true">→</span>
        </React.Fragment>
      ))}
      <div className="pv-cell pv-cell-blank"><PatternCell token={{ type: 'blank' }} size={size} /></div>
    </div>
  );
}

// A 3x3 Raven's-matrix-style grid. `items` is expected to have 9 entries, one
// of which is `{ type: 'blank' }` marking the missing cell to solve for.
export function PatternGrid({ items, size = 64 }) {
  return (
    <div className="pv-grid">
      {items.map((tok, i) => (
        <div className={`pv-cell${!tok || tok.type === 'blank' ? ' pv-cell-blank' : ''}`} key={i}>
          <PatternCell token={tok} size={size} />
        </div>
      ))}
    </div>
  );
}

export function PatternOptionContent({ token, size = 56 }) {
  return <PatternCell token={token} size={size} />;
}
