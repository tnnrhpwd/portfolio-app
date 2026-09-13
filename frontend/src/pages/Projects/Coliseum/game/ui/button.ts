import Phaser from 'phaser';
import { getSettings } from '../settings';
import { getThemeColors, type ThemeColors } from '../theme';
import { addChromePlate, CHROME_BUTTON_KEY } from '../assets/textures';

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
  /**
   * Draw the label with NO background of its own.
   *
   * For menu items and list rows that sit inside a shared panel: a plate behind
   * every word fights the panel behind the group, and a plate's art can cut
   * through the label (a mid-height seam across the text). A bare button keeps an
   * invisible hit area — so focus, hover and disabled all behave identically — and
   * brightens its text on hover instead of filling.
   */
  bare?: boolean;
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
  // Sizes are authored per design box by the caller: the canvas is always one of
  // the two fixed boxes, so there is nothing to scale dynamically. Only the
  // player's accessibility text-scale preference multiplies a font here.
  const width = opts.width ?? 260;
  const height = opts.height ?? 56;
  const fontSize = Math.round((opts.fontSize ?? 24) * getSettings().textScale);
  const fill = opts.fill ?? 0x8c1f28;
  const hoverFill = opts.hoverFill ?? 0xa52a34;
  const disabledFill = opts.disabledFill ?? 0x555555;
  const textColor = opts.textColor ?? '#f2d98c';

  // Prefer the ornate raster plate; fall back to the drawn rectangle when it is not
  // loaded, so a missing PNG degrades to the old look instead of a green box.
  const bare = opts.bare === true;
  const plate = bare ? null : addChromePlate(scene, CHROME_BUTTON_KEY, 0, 0, width, height);
  const bg: Phaser.GameObjects.Rectangle | Phaser.GameObjects.NineSlice = bare
    ? // A bare button still needs something interactive — keep the rectangle but
      // make it invisible, so focus/hover/disabled all work and only the fill goes.
      scene.add.rectangle(0, 0, width, height, 0x000000, 0)
    : (plate ?? scene.add.rectangle(0, 0, width, height, fill).setStrokeStyle(2, 0xe8b84b));
  const isPlate = plate !== null;
  // A NineSlice has no Tint component, so hover/disabled read as translucent
  // overlays over the plate rather than as a recolour of it (which would flatten
  // the gold trim). The rectangle path keeps recolouring itself.
  const hoverTint = isPlate ? scene.add.rectangle(0, 0, width, height, 0xffffff, 0) : null;
  const dimTint = isPlate ? scene.add.rectangle(0, 0, width, height, 0x000000, 0) : null;
  const paint = (color: number): void => {
    if (bare || isPlate) return;
    (bg as Phaser.GameObjects.Rectangle).setFillStyle(color);
  };

  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: `${fontSize}px`,
      color: textColor,
      fontStyle: 'bold',
    })
    .setOrigin(0.5);

  const parts: Phaser.GameObjects.GameObject[] = isPlate
    ? [bg, hoverTint as Phaser.GameObjects.Rectangle, dimTint as Phaser.GameObjects.Rectangle, text]
    : [bg, text];
  const container = scene.add.container(x, y, parts);
  container.setSize(width, height);
  // Bare buttons sit on a panel, so their resting state is slightly dimmed and
  // hover lifts them to full strength — the only affordance they have left.
  if (bare) text.setAlpha(0.86);

  let enabled = true;
  const onOver = (): void => {
    if (!enabled) return;
    if (bare) text.setAlpha(1);
    else if (hoverTint) hoverTint.setAlpha(0.14);
    else paint(hoverFill);
    opts.hover?.();
  };
  const onOut = (): void => {
    if (!enabled) return;
    if (bare) text.setAlpha(0.86);
    else if (hoverTint) hoverTint.setAlpha(0);
    else paint(fill);
    opts.blur?.();
  };
  const onDown = (): void => {
    if (enabled) onClick();
  };

  const setEnabled = (value: boolean): void => {
    enabled = value;
    if (dimTint) dimTint.setAlpha(value ? 0 : 0.45);
    paint(value ? fill : disabledFill);
    text.setAlpha(value ? (bare ? 0.86 : 1) : bare ? 0.8 : 0.4);
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
    merged.fontSize = `${Math.round(base * settings.textScale)}px`;
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
    .setDepth(960)
    .setVisible(false);
  const text = scene.add
    .text(0, 0, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: colors.text,
      wordWrap: { width: 320 },
    })
    .setDepth(961)
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
