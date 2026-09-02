import Phaser from 'phaser';

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  hoverFill?: number;
  disabledFill?: number;
}

export interface GameButton {
  container: Phaser.GameObjects.Container;
  setEnabled: (enabled: boolean) => void;
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
  const fontSize = opts.fontSize ?? 24;
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
    if (enabled) bg.setFillStyle(hoverFill);
  };
  const onOut = (): void => {
    if (enabled) bg.setFillStyle(fill);
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

  return { container, setEnabled };
}

export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '20px',
      color: '#e8dcc8',
      ...style,
    })
    .setOrigin(0.5);
}
