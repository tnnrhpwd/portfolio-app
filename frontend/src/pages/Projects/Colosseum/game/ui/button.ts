import Phaser from 'phaser';
import { getSettings } from '../settings';

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  hoverFill?: number;
  disabledFill?: number;
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
  const width = opts.width ?? 260;
  const height = opts.height ?? 56;
  const fontSize = Math.round((opts.fontSize ?? 24) * getSettings().textScale);
  const fill = opts.fill ?? 0x8c1f28;
  const hoverFill = opts.hoverFill ?? 0xa52a34;
  const disabledFill = opts.disabledFill ?? 0x555555;

  const bg = scene.add.rectangle(0, 0, width, height, fill).setStrokeStyle(2, 0xe8b84b);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: `${fontSize}px`,
      color: '#f2d98c',
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
  const merged: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: 'Arial, sans-serif',
    fontSize: '20px',
    color: settings.highContrast ? '#ffffff' : '#e8dcc8',
    ...style,
  };
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
  const bg = scene.add
    .rectangle(0, 0, 10, 10, 0x1c1610, 1)
    .setStrokeStyle(1, 0xe8b84b)
    .setDepth(800)
    .setVisible(false);
  const text = scene.add
    .text(0, 0, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#e8dcc8',
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
