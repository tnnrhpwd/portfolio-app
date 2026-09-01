import React from 'react';

/**
 * ColosseumArt — original vector artifacts for the game.
 * All shapes/paths/colors are authored from scratch (no copied assets).
 * Every icon uses a 48×48 viewBox so it scales cleanly at any size.
 */

function WeaponBlade({ length = 34, color = '#b8c4d0', glow = null }) {
  return (
    <g>
      {glow && <path d={bladePath(length)} stroke={glow} strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.5} />}
      <path d={bladePath(length)} stroke={color} strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* guard */}
      <line x1={10} y1={27} x2={22} y2={39} stroke="#8a5a2b" strokeWidth={4} strokeLinecap="round" />
      {/* grip */}
      <line x1={6} y1={22} x2={12} y2={29} stroke="#5a3d1c" strokeWidth={4.5} strokeLinecap="round" />
      {/* pommel */}
      <circle cx={5} cy={21} r={3.2} fill="#c9a227" />
    </g>
  );
}

function bladePath(length) {
  // Sword pointing up-right from around (14,32) toward (14,32-length)
  const tip = 32 - length;
  return `M 14 32 L ${14 - 5} ${tip + 6} L 14 ${tip} L ${14 + 5} ${tip + 6} Z`;
}

export function WeaponIcon({ tierId = 'w0', size = 26, title }) {
  const tier = parseInt(String(tierId).slice(1), 10) || 0;
  let body;
  switch (tier) {
    case 0:
      // Bare fist
      body = (
        <g>
          <circle cx="24" cy="26" r="9" fill="#d9a06b" />
          <circle cx="17" cy="20" r="3.4" fill="#d9a06b" />
          <circle cx="24" cy="17" r="3.4" fill="#d9a06b" />
          <circle cx="31" cy="20" r="3.4" fill="#d9a06b" />
        </g>
      );
      break;
    case 1:
      body = <WeaponBlade length={22} color="#cd7f32" />;
      break;
    case 2:
      body = <WeaponBlade length={30} color="#8a8a92" />;
      break;
    case 3:
      body = <WeaponBlade length={34} color="#b8c4d0" />;
      break;
    default:
      body = <WeaponBlade length={34} color="#e8f7ff" glow="#7fd4ff" />;
      break;
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title || 'weapon'}>
      {body}
    </svg>
  );
}

export function ArmorIcon({ tierId = 'a0', size = 26, title }) {
  const tier = parseInt(String(tierId).slice(1), 10) || 0;
  const outline = '#3a3a3a';
  let fill = '#c9b48a';
  let extra = null;
  if (tier === 1) fill = '#8a5a2b';
  if (tier === 2) fill = '#9aa0a8';
  if (tier === 3) fill = '#c0c8d0';
  if (tier >= 4) {
    fill = '#d7f0ff';
    extra = <path d="M 14 24 L 34 24" stroke="#7fd4ff" strokeWidth={3} strokeLinecap="round" opacity={0.9} />;
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title || 'armor'}>
      {/* torso */}
      <path
        d="M 24 12 C 16 14 13 20 13 27 L 13 40 L 20 40 L 20 30 L 28 30 L 28 40 L 35 40 L 35 27 C 35 20 32 14 24 12 Z"
        fill={fill}
        stroke={outline}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* neck */}
      <rect x="21" y="10" width="6" height="5" rx="2" fill={fill} stroke={outline} strokeWidth={2} />
      {/* chain mail rings */}
      {tier === 2 && (
        <g stroke="#6f747c" strokeWidth={1.4} fill="none" opacity={0.8}>
          <path d="M 17 20 q 2 3 0 6 M 24 20 q 2 3 0 6 M 31 20 q 2 3 0 6" />
          <path d="M 17 28 q 2 3 0 6 M 24 28 q 2 3 0 6 M 31 28 q 2 3 0 6" />
        </g>
      )}
      {/* lorica bands */}
      {tier === 3 && (
        <g stroke="#8a929c" strokeWidth={2.4}>
          <path d="M 14 24 L 34 24" />
          <path d="M 13.5 29 L 34.5 29" />
          <path d="M 13.5 34 L 34.5 34" />
        </g>
      )}
      {extra}
    </svg>
  );
}

export function ShieldIcon({ kind = 'round', size = 26, title }) {
  let shape;
  if (kind === 'big') {
    shape = (
      <path
        d="M 24 8 C 30 11 35 18 35 27 L 35 39 L 13 39 L 13 27 C 13 18 18 11 24 8 Z"
        fill="#8a6b3a"
        stroke="#5e451f"
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
    );
  } else if (kind === 'small') {
    shape = (
      <circle cx="24" cy="25" r="13" fill="#8a6b3a" stroke="#5e451f" strokeWidth={2.6} />
    );
  } else {
    shape = (
      <g>
        <circle cx="24" cy="25" r="14" fill="#6b8f4a" stroke="#3f5a2a" strokeWidth={2.6} />
        <circle cx="24" cy="25" r="5" fill="#c9a227" />
      </g>
    );
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title || 'shield'}>
      {shape}
    </svg>
  );
}
