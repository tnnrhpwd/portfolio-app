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

/** Original parchment world-map backdrop (abstract, no copied reference geography). */
export const WORLD_MAP_BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#c9b585"/>
  <g fill="#b89d68" opacity="0.35">
    <ellipse cx="210" cy="180" rx="230" ry="150"/>
    <ellipse cx="1040" cy="500" rx="260" ry="180"/>
    <ellipse cx="640" cy="700" rx="300" ry="120"/>
    <ellipse cx="920" cy="90" rx="180" ry="90"/>
  </g>
  <path d="M0,0 L1280,0 L1280,720 L0,720 Z M100,540 C320,470 600,490 760,600 C900,700 1080,700 1240,640 L1240,720 L100,720 Z" fill="#7fa7bd" opacity="0.6"/>
  <g fill="#a9824d" stroke="#7c5a2e" stroke-width="3">
    <path d="M60,80 C220,40 400,60 520,140 C640,220 620,340 500,400 C380,460 220,430 120,360 C40,300 20,160 60,80 Z"/>
    <path d="M720,60 C900,20 1080,60 1200,160 C1260,220 1260,320 1180,380 C1080,440 920,400 820,320 C720,240 680,120 720,60 Z"/>
    <path d="M240,560 C400,520 560,560 640,640 C700,700 600,760 440,760 C300,760 180,700 200,620 C220,580 240,560 240,560 Z"/>
  </g>
  <g transform="translate(1080,600)">
    <circle r="46" fill="none" stroke="#6b4a1f" stroke-width="2"/>
    <path d="M0,-38 L10,0 L0,38 L-10,0 Z" fill="#8a2b22"/>
    <path d="M-38,0 L0,10 L38,0 L0,-10 Z" fill="#6b4a1f"/>
  </g>
  <rect x="14" y="14" width="1252" height="692" fill="none" stroke="#6b4a1f" stroke-width="4" opacity="0.5"/>
</svg>`;

/** Original dark-red marbled menu backdrop. */
export const MENU_BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="mg" cx="50%" cy="38%" r="85%">
      <stop offset="0%" stop-color="#4d1419"/>
      <stop offset="100%" stop-color="#200a0d"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#mg)"/>
  <g fill="none" stroke="#651d23" stroke-width="3" opacity="0.28">
    <path d="M-40,120 C200,80 420,180 640,140 C880,100 1080,180 1320,120"/>
    <path d="M-40,300 C220,260 460,360 700,320 C940,280 1100,360 1320,300"/>
    <path d="M-40,520 C240,480 500,580 760,540 C1000,500 1140,560 1320,520"/>
    <path d="M-40,660 C260,630 520,690 780,650 C1020,610 1160,670 1320,640"/>
  </g>
</svg>`;

// ─────────────────────────────────────────────────────────────────────────
// Layered character & equipment sprites (original vector art).
//
// A fighter is a stack of layers sharing one 160×240 canvas so they overlay
// at the same position: base human (skin + robe + hair) on the bottom, then
// legs → torso → arms → head armor, then off-hand (shield / 2nd weapon) and
// main-hand weapon on top. The same shapes are reused as standalone "icon"
// SVGs for the shop / inventory / loot boxes.
// ─────────────────────────────────────────────────────────────────────────

export type SkinTone = 'light' | 'tan' | 'brown' | 'dark';
export type HairStyle = 'short' | 'long' | 'tied' | 'curly' | 'bald';

const SKIN: Record<SkinTone, { base: string; shade: string }> = {
  light: { base: '#e8b78a', shade: '#c9945f' },
  tan: { base: '#d9a066', shade: '#b07842' },
  brown: { base: '#a8703e', shade: '#7c4f28' },
  dark: { base: '#6d4726', shade: '#4b2f17' },
};

function hairMarkup(style: HairStyle, color: string): string {
  switch (style) {
    case 'long':
      return `<path d="M62 30 Q64 10 80 10 Q96 10 98 30 L98 58 Q90 66 80 66 Q70 66 62 58 Z" fill="${color}"/>`;
    case 'tied':
      return `<path d="M62 28 Q64 10 80 10 Q96 10 98 28 Q90 18 80 18 Q70 18 62 28 Z" fill="${color}"/><rect x="75" y="8" width="10" height="28" rx="5" fill="${color}"/>`;
    case 'curly':
      return `<path d="M62 28 Q58 8 80 8 Q102 8 98 28 Q90 12 80 14 Q70 12 62 28 Z" fill="${color}"/><circle cx="68" cy="14" r="6" fill="${color}"/><circle cx="92" cy="14" r="6" fill="${color}"/>`;
    case 'bald':
      return '';
    case 'short':
    default:
      return `<path d="M62 30 Q64 12 80 12 Q96 12 98 30 Q90 20 80 20 Q70 20 62 30 Z" fill="${color}"/>`;
  }
}

export interface HumanVariant {
  id: string;
  skin: SkinTone;
  hairStyle: HairStyle;
  hairColor: string;
  robe: string;
  robeShade: string;
}

/** A curated set of base fighters (skin tones × hair styles/colors × robes). */
export const HUMAN_VARIANTS: HumanVariant[] = [
  { id: 'h0', skin: 'light', hairStyle: 'short', hairColor: '#3a2416', robe: '#8c1f28', robeShade: '#5d121a' },
  { id: 'h1', skin: 'tan', hairStyle: 'long', hairColor: '#b0763a', robe: '#3a5a8c', robeShade: '#27406b' },
  { id: 'h2', skin: 'brown', hairStyle: 'tied', hairColor: '#20120b', robe: '#3a7d44', robeShade: '#28592f' },
  { id: 'h3', skin: 'dark', hairStyle: 'curly', hairColor: '#20120b', robe: '#6b4a8c', robeShade: '#4a3066' },
  { id: 'h4', skin: 'light', hairStyle: 'long', hairColor: '#d9a066', robe: '#8c6a1f', robeShade: '#665014' },
  { id: 'h5', skin: 'tan', hairStyle: 'short', hairColor: '#6b4a2f', robe: '#8c3a1f', robeShade: '#662a14' },
  { id: 'h6', skin: 'brown', hairStyle: 'bald', hairColor: '#20120b', robe: '#2b6b6b', robeShade: '#1e4a4a' },
  { id: 'h7', skin: 'dark', hairStyle: 'tied', hairColor: '#3a2416', robe: '#4a3a2b', robeShade: '#332818' },
];

function buildHumanSprite(v: HumanVariant): string {
  const skin = SKIN[v.skin].base;
  const shade = SKIN[v.skin].shade;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 160 240">
  <rect x="60" y="150" width="15" height="48" rx="6" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  <rect x="85" y="150" width="15" height="48" rx="6" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  <rect x="58" y="196" width="19" height="9" rx="3" fill="#5d3b1b"/>
  <rect x="83" y="196" width="19" height="9" rx="3" fill="#5d3b1b"/>
  <path d="M52 80 Q50 60 80 58 Q110 60 108 80 L116 152 L44 152 Z" fill="${v.robe}" stroke="${v.robeShade}" stroke-width="2"/>
  <rect x="44" y="74" width="12" height="44" rx="6" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  <rect x="104" y="74" width="12" height="44" rx="6" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  <rect x="48" y="116" width="64" height="8" rx="2" fill="#5d3b1b"/>
  <rect x="72" y="46" width="16" height="14" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  <circle cx="80" cy="36" r="17" fill="${skin}" stroke="${shade}" stroke-width="2"/>
  ${hairMarkup(v.hairStyle, v.hairColor)}
</svg>`;
}

export const HUMAN_SPRITES: Record<string, string> = {};
for (const v of HUMAN_VARIANTS) HUMAN_SPRITES[v.id] = buildHumanSprite(v);

// ── Armor (head / torso / arms / legs), tinted by material tier ──

const METAL_GROUPS = [
  { base: '#8a5a2b', shade: '#5d3b1b' }, // bronze
  { base: '#9aa4ad', shade: '#6a7278' }, // iron / steel
  { base: '#e8b84b', shade: '#b8891f' }, // gold
];

const ARMOR_POS: Record<string, [number, number]> = {
  head: [80, 30],
  torso: [80, 94],
  leftArm: [50, 96],
  rightArm: [110, 96],
  legs: [80, 174],
};

function armorPiece(slot: string, base: string, shade: string): string {
  switch (slot) {
    case 'head':
      return `<path d="M-18 -2 Q-18 -24 0 -26 Q18 -24 18 -2 L18 8 L-18 8 Z" fill="${base}" stroke="${shade}" stroke-width="2"/><rect x="-18" y="2" width="36" height="3" fill="${shade}"/>`;
    case 'torso':
      return `<path d="M-26 -32 Q-26 -44 0 -44 Q26 -44 26 -32 L30 10 L-30 10 Z" fill="${base}" stroke="${shade}" stroke-width="2"/><rect x="-10" y="-46" width="20" height="3" rx="1" fill="${shade}"/>`;
    case 'leftArm':
    case 'rightArm':
      return `<rect x="-10" y="-24" width="20" height="50" rx="8" fill="${base}" stroke="${shade}" stroke-width="2"/>`;
    case 'legs':
      return `<rect x="-31" y="-24" width="23" height="50" rx="6" fill="${base}" stroke="${shade}" stroke-width="2"/><rect x="8" y="-24" width="23" height="50" rx="6" fill="${base}" stroke="${shade}" stroke-width="2"/>`;
    default:
      return '';
  }
}

function fullSvg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 160 240">${inner}</svg>`;
}

function iconSvg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${inner}</svg>`;
}

export const ARMOR_OVERLAYS: Record<string, string> = {};
export const ARMOR_ICONS: Record<string, string> = {};
for (const slot of Object.keys(ARMOR_POS)) {
  const [px, py] = ARMOR_POS[slot];
  METAL_GROUPS.forEach((m, g) => {
    const piece = armorPiece(slot, m.base, m.shade);
    ARMOR_OVERLAYS[`${slot}-${g}`] = fullSvg(`<g transform="translate(${px},${py})">${piece}</g>`);
    ARMOR_ICONS[`${slot}-${g}`] = iconSvg(`<g transform="translate(60,60) scale(1.15)">${piece}</g>`);
  });
}

// ── Weapons (main / off hand) ──

function weaponMarkup(kind: string): string {
  switch (kind) {
    case 'axe':
      return `<rect x="-2" y="-4" width="4" height="40" rx="2" fill="#6b4a2f"/><path d="M-16 -14 Q0 -30 16 -14 L16 -2 L-16 -2 Z" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>`;
    case 'mace':
      return `<rect x="-2" y="4" width="4" height="36" rx="2" fill="#6b4a2f"/><circle cx="0" cy="-7" r="12" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/><path d="M-6 -15 L-8 -21 M0 -19 L0 -26 M6 -15 L8 -21" stroke="#6a7278" stroke-width="2"/>`;
    case 'spear':
      return `<rect x="-2" y="-34" width="4" height="52" rx="2" fill="#6b4a2f"/><path d="M0 -46 L6 -30 L0 -22 L-6 -30 Z" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>`;
    case 'dagger':
      return `<rect x="-2" y="-20" width="4" height="22" fill="#c9ced6" stroke="#8a929c" stroke-width="1.5"/><rect x="-6" y="-2" width="12" height="3" fill="#e8b84b"/><rect x="-2" y="1" width="4" height="10" rx="2" fill="#6b4a2f"/>`;
    case 'trident':
      return `<rect x="-2" y="-30" width="4" height="46" rx="2" fill="#6b4a2f"/><path d="M-8 -34 L-6 -14 M0 -36 L0 -14 M8 -34 L6 -14" stroke="#9aa4ad" stroke-width="3" fill="none"/>`;
    case 'greatsword':
      return `<rect x="-4" y="-40" width="8" height="50" fill="#c9ced6" stroke="#8a929c" stroke-width="1.5"/><rect x="-12" y="8" width="24" height="5" rx="1" fill="#e8b84b"/><rect x="-3" y="13" width="6" height="18" rx="3" fill="#6b4a2f"/>`;
    case 'maul':
      return `<rect x="-2" y="-2" width="4" height="38" rx="2" fill="#6b4a2f"/><rect x="-16" y="-14" width="32" height="14" rx="3" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/>`;
    case 'halberd':
      return `<rect x="-2" y="-30" width="4" height="52" rx="2" fill="#6b4a2f"/><path d="M-14 -26 L0 -38 L14 -26 L14 -14 L0 -20 L-14 -14 Z" fill="#9aa4ad" stroke="#6a7278" stroke-width="2"/><path d="M0 -44 L4 -34 L0 -30 L-4 -34 Z" fill="#9aa4ad"/>`;
    case 'gladius':
    default:
      return `<rect x="-3" y="-30" width="6" height="32" fill="#c9ced6" stroke="#8a929c" stroke-width="1.5"/><rect x="-9" y="-4" width="18" height="4" rx="1" fill="#e8b84b"/><rect x="-2" y="0" width="4" height="12" rx="2" fill="#6b4a2f"/><circle cx="0" cy="12" r="3" fill="#e8b84b"/>`;
  }
}

const WEAPON_KIND_LIST = ['gladius', 'axe', 'mace', 'spear', 'dagger', 'trident', 'greatsword', 'maul', 'halberd'];
export const WEAPON_OVERLAYS: Record<string, string> = {};
export const WEAPON_ICONS: Record<string, string> = {};
for (const kind of WEAPON_KIND_LIST) {
  WEAPON_OVERLAYS[kind] = fullSvg(`<g transform="translate(116,92)">${weaponMarkup(kind)}</g>`);
  WEAPON_ICONS[kind] = iconSvg(`<g transform="translate(60,60) scale(1.5)">${weaponMarkup(kind)}</g>`);
}

// ── Shields (off hand) ──

function shieldMarkup(kind: string): string {
  switch (kind) {
    case 'round':
      return `<circle cx="0" cy="0" r="24" fill="#8c1f28" stroke="#5d121a" stroke-width="3"/><circle cx="0" cy="0" r="10" fill="#e8b84b"/>`;
    case 'tower':
      return `<rect x="-14" y="-26" width="28" height="52" rx="8" fill="#8c1f28" stroke="#5d121a" stroke-width="3"/><rect x="-6" y="-16" width="12" height="32" rx="4" fill="#e8b84b"/>`;
    case 'net':
      return `<circle cx="0" cy="0" r="24" fill="none" stroke="#d9d9d9" stroke-width="2"/><path d="M-18 -12 L18 -12 M-18 0 L18 0 M-18 12 L18 12 M-8 -20 L-8 20 M0 -20 L0 20 M8 -20 L8 20" stroke="#d9d9d9" stroke-width="1.5"/>`;
    case 'buckler':
    default:
      return `<circle cx="0" cy="0" r="15" fill="#8c1f28" stroke="#5d121a" stroke-width="2"/><circle cx="0" cy="0" r="6" fill="#e8b84b"/>`;
  }
}

const SHIELD_KIND_LIST = ['buckler', 'round', 'tower', 'net'];
export const SHIELD_OVERLAYS: Record<string, string> = {};
export const SHIELD_ICONS: Record<string, string> = {};
for (const kind of SHIELD_KIND_LIST) {
  SHIELD_OVERLAYS[kind] = fullSvg(`<g transform="translate(44,100)">${shieldMarkup(kind)}</g>`);
  SHIELD_ICONS[kind] = iconSvg(`<g transform="translate(60,60) scale(1.4)">${shieldMarkup(kind)}</g>`);
}

// ── Mannequin wireframe (the drop-target silhouette) ──

export const MANNEQUIN_FRAME = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 160 240">
  <g fill="none" stroke="#e8b84b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.8">
    <circle cx="80" cy="36" r="16"/>
    <path d="M56 68 L104 68 L114 150 L46 150 Z"/>
    <path d="M54 72 L42 112 L40 146"/>
    <path d="M106 72 L118 112 L120 146"/>
    <path d="M62 150 L60 196 L57 204"/>
    <path d="M98 150 L100 196 L103 204"/>
  </g>
</svg>`;

/** Encode an SVG string as a Phaser-loadable data URI. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
