/**
 * Rocket — in-canvas UI widgets.
 *
 * Everything is drawn inside the canvas (no DOM layered over the game), which
 * is what keeps the arena, HUD and menus on one scale no matter the device.
 * Because the game runs in Phaser's FIT mode the design size is always
 * 1280×720, so positions are absolute and there is no reflow logic here.
 */

import Phaser from 'phaser';
import { FONT, FONT_UI, PALETTE, TEXT } from './theme';

export interface TextOpts {
  size?: number;
  color?: string;
  font?: string;
  bold?: boolean;
  origin?: [number, number];
  wrap?: number;
  align?: string;
}

/** A single-line text object with the game's defaults applied. */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  opts: TextOpts = {},
): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: opts.font ?? FONT_UI,
    fontSize: `${opts.size ?? 22}px`,
    color: opts.color ?? TEXT.primary,
  };
  if (opts.bold) style.fontStyle = 'bold';
  if (opts.wrap) style.wordWrap = { width: opts.wrap };
  if (opts.align) style.align = opts.align;

  const [ox, oy] = opts.origin ?? [0, 0];
  return scene.add.text(x, y, content, style).setOrigin(ox, oy);
}

/** HUD numbers: monospace so digits don't shuffle the layout as they change. */
export function addHudText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  size = 22,
  color: string = TEXT.primary,
  origin: [number, number] = [0.5, 0.5],
): Phaser.GameObjects.Text {
  return addText(scene, x, y, content, { size, color, font: FONT, bold: true, origin });
}

export interface GameButton {
  container: Phaser.GameObjects.Container;
  /** Replaces the label (used by toggles like Mute / Pause). */
  setLabel: (label: string) => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  hoverFill?: number;
  edge?: number;
  textColor?: string;
  /** Outline-only, for secondary actions. */
  outline?: boolean;
}

/** A pill button. Returns a handle so scenes can enable/disable or relabel it. */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): GameButton {
  const width = opts.width ?? 280;
  const height = opts.height ?? 58;
  const fontSize = opts.fontSize ?? 24;
  const fill = opts.fill ?? PALETTE.panel;
  const hoverFill = opts.hoverFill ?? PALETTE.panelHover;
  const edge = opts.edge ?? PALETTE.panelEdge;
  const textColor = opts.textColor ?? TEXT.primary;

  const bg = scene.add.rectangle(0, 0, width, height, opts.outline ? PALETTE.bg : fill);
  bg.setStrokeStyle(2, edge);

  const text = addText(scene, 0, 0, label, {
    size: fontSize,
    color: textColor,
    bold: true,
    origin: [0.5, 0.5],
  });

  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(width, height);

  let enabled = true;
  const paint = (): void => {
    if (!enabled) bg.setFillStyle(PALETTE.bg, opts.outline ? 0 : 1);
    else bg.setFillStyle(fill);
  };

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => {
    if (enabled) bg.setFillStyle(hoverFill);
  });
  bg.on('pointerout', paint);
  bg.on('pointerdown', () => {
    if (enabled) onClick();
  });

  return {
    container,
    setLabel: (next: string) => text.setText(next),
    setEnabled: (value: boolean) => {
      enabled = value;
      text.setAlpha(value ? 1 : 0.45);
      bg.setStrokeStyle(2, value ? edge : PALETTE.panelEdge);
      paint();
    },
    isEnabled: () => enabled,
    setVisible: (visible: boolean) => {
      container.setVisible(visible);
      // Invisible buttons must not swallow clicks meant for the arena.
      if (visible) bg.setInteractive({ useHandCursor: true });
      else bg.disableInteractive();
    },
    destroy: () => container.destroy(),
  };
}

/** A compact square control (pause, mute, back). */
export function createIconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  glyph: string,
  onClick: () => void,
  size = 44,
): GameButton {
  return createButton(scene, x, y, glyph, onClick, {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.5),
    textColor: TEXT.muted,
  });
}

/** A labelled bar (hull, shield, boss health, wave progress). */
export function createBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): Phaser.GameObjects.Rectangle {
  scene.add
    .rectangle(x, y, width, height, PALETTE.panel)
    .setOrigin(0, 0.5)
    .setStrokeStyle(1, PALETTE.panelEdge);
  return scene.add.rectangle(x, y, width, height, color).setOrigin(0, 0.5);
}

/** Sets a bar's fill ratio (0..1), keeping the left edge anchored. */
export function setBarRatio(bar: Phaser.GameObjects.Rectangle, ratio: number, fullWidth: number): void {
  const clamped = Phaser.Math.Clamp(ratio, 0, 1);
  bar.width = Math.max(0, fullWidth * clamped);
}
