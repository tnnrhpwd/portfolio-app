/**
 * Original vector art for the Colosseum rebuild.
 *
 * Every SVG here is original work: a stylized, flat-shaded cartoon gladiator
 * figure drawn from scratch (no tracing, no copied reference art). The five
 * figures share one body template and differ by weapon silhouette + accent
 * color, matching the five in-game play styles. All strings are ASCII-only so
 * they can be base64-encoded into Phaser textures at runtime.
 *
 * See docs/implementation/ASSET-LICENSES.md for provenance + the asset budget.
 */

import type { StyleKey } from '../core';

/** Body template shared by all five styles (original, stylized front view). */
const BODY = `
  <g>
    <rect x="60" y="120" width="18" height="70" rx="7" fill="#8a5a2b" stroke="#5d3b1b" stroke-width="2"/>
    <rect x="82" y="120" width="18" height="70" rx="7" fill="#8a5a2b" stroke="#5d3b1b" stroke-width="2"/>
    <rect x="56" y="188" width="20" height="10" rx="3" fill="#5d3b1b"/>
    <rect x="84" y="188" width="20" height="10" rx="3" fill="#5d3b1b"/>
    <rect x="44" y="68" width="13" height="48" rx="6" fill="#d9a066" stroke="#b07842" stroke-width="2"/>
    <rect x="103" y="68" width="13" height="48" rx="6" fill="#d9a066" stroke="#b07842" stroke-width="2"/>
    <rect x="60" y="66" width="40" height="56" rx="9" fill="#8c1f28" stroke="#5d121a" stroke-width="2"/>
    <rect x="60" y="104" width="40" height="8" fill="#6b4a2f"/>
    <rect x="70" y="104" width="20" height="8" fill="#e8b84b"/>
    <circle cx="80" cy="42" r="20" fill="#d9a066" stroke="#b07842" stroke-width="2"/>
    <path d="M58 36 Q80 4 102 36 L102 34 Q80 6 58 34 Z" fill="#b0763a" stroke="#7d4f22" stroke-width="2"/>
    <rect x="60" y="12" width="40" height="10" rx="5" fill="#8c1f28" stroke="#5d121a" stroke-width="2"/>
  </g>
`;

interface WeaponSpec {
  main: string;
  accent: string;
}

const WEAPONS: Record<StyleKey, WeaponSpec> = {
  // Spear + round shield (support / control).
  provocator: {
    accent: '#e8b84b',
    main: `
      <line x1="116" y1="14" x2="116" y2="206" stroke="#6b4a2f" stroke-width="5"/>
      <path d="M116 6 L109 22 L123 22 Z" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>
      <circle cx="42" cy="108" r="26" fill="#8c1f28" stroke="#5d121a" stroke-width="3"/>
      <circle cx="42" cy="108" r="10" fill="#e8b84b" stroke="#b8891f" stroke-width="2"/>
    `,
  },
  // Tower shield + one-handed blade (protector / tank).
  murmillo: {
    accent: '#d9a066',
    main: `
      <rect x="38" y="80" width="30" height="70" rx="8" fill="#8c1f28" stroke="#5d121a" stroke-width="3"/>
      <rect x="47" y="92" width="12" height="46" rx="4" fill="#e8b84b" stroke="#b8891f" stroke-width="2"/>
      <rect x="108" y="88" width="8" height="44" rx="2" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>
      <rect x="102" y="84" width="20" height="5" rx="2" fill="#e8b84b"/>
      <rect x="106" y="130" width="12" height="12" rx="3" fill="#6b4a2f"/>
    `,
  },
  // Trident + net (controller / thrower).
  retiarius: {
    accent: '#7fb3d5',
    main: `
      <line x1="118" y1="16" x2="118" y2="206" stroke="#6b4a2f" stroke-width="5"/>
      <path d="M112 8 L118 28 L124 8 L118 14 Z" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>
      <path d="M106 4 L110 30 M112 4 L118 32 M120 4 L126 30" stroke="#9aa4ad" stroke-width="3" fill="none"/>
      <path d="M30 84 L52 110 L30 136 M52 110 L70 84 L70 136 Z" stroke="#d9d9d9" stroke-width="2" fill="none"/>
    `,
  },
  // Dual blades (burst attacker).
  dimachaerus: {
    accent: '#c9a227',
    main: `
      <rect x="40" y="84" width="7" height="40" rx="2" fill="#9aa4ad" stroke="#6a7278" stroke-width="2" transform="rotate(-14 43 104)"/>
      <rect x="34" y="80" width="18" height="4" rx="2" fill="#e8b84b" transform="rotate(-14 43 82)"/>
      <rect x="113" y="84" width="7" height="40" rx="2" fill="#9aa4ad" stroke="#6a7278" stroke-width="2" transform="rotate(14 117 104)"/>
      <rect x="108" y="80" width="18" height="4" rx="2" fill="#e8b84b" transform="rotate(14 117 82)"/>
    `,
  },
  // Two-handed great weapon (heavy single hit).
  thraex: {
    accent: '#c0392b',
    main: `
      <line x1="114" y1="10" x2="114" y2="202" stroke="#6b4a2f" stroke-width="6"/>
      <rect x="108" y="20" width="12" height="72" rx="3" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>
      <rect x="104" y="16" width="20" height="6" rx="2" fill="#e8b84b"/>
      <rect x="108" y="92" width="12" height="20" rx="2" fill="#6b4a2f"/>
      <rect x="100" y="112" width="28" height="8" rx="3" fill="#e8b84b"/>
    `,
  },
};

function buildStyleSprite(style: StyleKey): string {
  const weapon = WEAPONS[style];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 160 240">
  <ellipse cx="80" cy="216" rx="52" ry="12" fill="${weapon.accent}" opacity="0.25"/>
  ${BODY}
  <g stroke-width="2">${weapon.main}</g>
</svg>`;
}

/** One original sprite per play style, keyed by StyleKey. */
export const STYLE_SPRITES: Record<StyleKey, string> = {
  provocator: buildStyleSprite('provocator'),
  murmillo: buildStyleSprite('murmillo'),
  retiarius: buildStyleSprite('retiarius'),
  dimachaerus: buildStyleSprite('dimachaerus'),
  thraex: buildStyleSprite('thraex'),
};

/** Original arena backdrop (flat, stylized - no copied reference art). */
export const ARENA_BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#1a1410"/>
  <rect y="0" width="1280" height="170" fill="#2b2118"/>
  <g fill="#3a2c1e">
    <rect x="60" y="24" width="130" height="146" rx="66"/>
    <rect x="380" y="24" width="130" height="146" rx="66"/>
    <rect x="700" y="24" width="130" height="146" rx="66"/>
    <rect x="1020" y="24" width="130" height="146" rx="66"/>
  </g>
  <g fill="#120d0a">
    <rect x="60" y="24" width="130" height="146" rx="66" opacity="0.55"/>
    <rect x="380" y="24" width="130" height="146" rx="66" opacity="0.55"/>
    <rect x="700" y="24" width="130" height="146" rx="66" opacity="0.55"/>
    <rect x="1020" y="24" width="130" height="146" rx="66" opacity="0.55"/>
  </g>
  <rect y="170" width="1280" height="14" fill="#4a3626"/>
  <rect y="184" width="1280" height="536" fill="#c9a86a"/>
  <g stroke="#a9884f" stroke-width="3" opacity="0.5">
    <line x1="0" y1="300" x2="1280" y2="300"/>
    <line x1="0" y1="420" x2="1280" y2="420"/>
    <line x1="0" y1="540" x2="1280" y2="540"/>
    <line x1="0" y1="660" x2="1280" y2="660"/>
  </g>
  <rect y="680" width="1280" height="40" fill="#2b2118"/>
</svg>`;

/** Encode an SVG string as a Phaser-loadable data URI. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
