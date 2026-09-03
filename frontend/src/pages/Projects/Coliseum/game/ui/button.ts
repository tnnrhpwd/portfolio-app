import Phaser from 'phaser';
import { getSettings } from '../settings';
import { getThemeColors, type ThemeColors } from '../theme';

/**
 * Maps the dark-theme hex literals used across scenes to their resolved
 * palette value, so every screen recolors automatically in light mode without
 * touching each call site. In dark mode these are identity lookups.
 */
type StringColorKey = 'text' | 'heading' | 'goldText' | 'muted' | 'dim' | 'danger' | 'disabled';

const COLOR_MAP: Record<string, StringColorKey> = {
  '#e8dcc8': 'text',
  '#f2d98c': 'goldText',
  '#e8b84b': 'heading',
  '#b8aa94': 'muted',
  '#6a6258': 'dim',
  '#c0392b': 'danger',
  '#55504a': 'disabled',
};

function translateColor(color: string, colors: ThemeColors): string {
  const key = COLOR_MAP[color.toLowerCase()];
  return key ? colors[key] : color;
}

/**
 * Uniform UI scale derived from the live canvas size, so controls and text
 * stay proportional whether the game is on a phone, tablet, or large monitor.
 * Layout positions stay absolute (scenes reflow around `cx`/`cy`), so this
 * only governs the size of controls, not their placement.
 */
function uiScale(scene: Phaser.Scene): number {
  const s = Math.min(scene.scale.width / 1280, scene.scale.height / 720);
  return Phaser.Math.Clamp(s, 0.6, 1.3);
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  hoverFill?: number;
  disabledFill?: number;
  /** Label color (defaults to the light-gold used across menus). */
  textColor?: string;
  /** Called when the pointer enters (for tooltips). */
  hover?: () => void;
  /** Called when the pointer leaves. */
  blur?: () => void;
}

export interface GameButton {
  container: Phaser.GameObjects.Container;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  activate: () => void;
}

/** A themed ribbon-style button drawn entirely inside the game frame. */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): GameButton {
  const us = uiScale(scene);
  const width = (opts.width ?? 260) * us;
  const height = (opts.height ?? 56) * us;
  const fontSize = Math.round((opts.fontSize ?? 24) * getSettings().textScale * us);
  const fill = opts.fill ?? 0x8c1f28;
  const hoverFill = opts.hoverFill ?? 0xa52a34;
  const disabledFill = opts.disabledFill ?? 0x555555;
  const textColor = opts.textColor ?? '#f2d98c';

  const bg = scene.add.rectangle(0, 0, width, height, fill).setStrokeStyle(2, 0xe8b84b);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: `${fontSize}px`,
      color: textColor,
      fontStyle: 'bold',
    })
    .setOrigin(0.5);

  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(width, height);

  let enabled = true;
  const onOver = (): void => {
    if (enabled) {
      bg.setFillStyle(hoverFill);
      opts.hover?.();
    }
  };
  const onOut = (): void => {
    if (enabled) {
      bg.setFillStyle(fill);
      opts.blur?.();
    }
  };
  const onDown = (): void => {
    if (enabled) onClick();
  };

  const setEnabled = (value: boolean): void => {
    enabled = value;
    bg.setFillStyle(value ? fill : disabledFill);
    text.setAlpha(value ? 1 : 0.5);
    if (value) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', onOver);
      bg.on('pointerout', onOut);
      bg.on('pointerdown', onDown);
    } else {
      bg.removeAllListeners('pointerover');
      bg.removeAllListeners('pointerout');
      bg.removeAllListeners('pointerdown');
      bg.disableInteractive();
    }
  };

  setEnabled(true);

  const activate = (): void => {
    if (enabled) onClick();
  };
  const isEnabled = (): boolean => enabled;

  return { container, setEnabled, activate, isEnabled };
}

export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  const settings = getSettings();
  const colors = getThemeColors();
  const defaultColor = settings.highContrast ? (colors.isLight ? '#000000' : '#ffffff') : colors.text;
  const merged: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: 'Arial, sans-serif',
    fontSize: '20px',
    color: defaultColor,
    ...style,
  };
  // Conditional styles often pass `color: undefined` to mean "use the default".
  // Phaser's TextStyle keeps an explicit `undefined` instead of falling back,
  // which fills glyphs with an invalid color and renders them invisible on dark
  // backgrounds — restore the default whenever no real color is supplied.
  if (merged.color === undefined || merged.color === null) {
    merged.color = defaultColor;
  }
  if (typeof merged.color === 'string') {
    merged.color = translateColor(merged.color, colors);
  }
  if (typeof merged.fontSize === 'string' && merged.fontSize.endsWith('px')) {
    const base = parseInt(merged.fontSize, 10) || 20;
    merged.fontSize = `${Math.round(base * settings.textScale * uiScale(scene))}px`;
  }
  return scene.add.text(x, y, text, merged).setOrigin(0.5);
}

export interface Tooltip {
  show: (x: number, y: number, text: string) => void;
  hide: () => void;
  destroy: () => void;
}

/** A floating description box for hover previews. */
export function createTooltip(scene: Phaser.Scene): Tooltip {
  const colors = getThemeColors();
  const bg = scene.add
    .rectangle(0, 0, 10, 10, colors.panel, 1)
    .setStrokeStyle(1, colors.panelStroke)
    .setDepth(800)
    .setVisible(false);
  const text = scene.add
    .text(0, 0, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: colors.text,
      wordWrap: { width: 320 },
    })
    .setDepth(801)
    .setVisible(false);

  const show = (x: number, y: number, content: string): void => {
    text.setText(content).setPosition(x, y).setOrigin(0.5).setVisible(true);
    bg.setPosition(x, y).setSize(text.width + 24, text.height + 16).setVisible(true);
  };
  const hide = (): void => {
    bg.setVisible(false);
    text.setVisible(false);
  };
  const destroy = (): void => {
    bg.destroy();
    text.destroy();
  };

  return { show, hide, destroy };
}
