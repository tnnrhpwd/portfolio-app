import Phaser from 'phaser';
import { pickBackground } from '../assets';
import { createRng, nextRange } from '../core/rng';
import { PALETTE, VIEW_HEIGHT, VIEW_WIDTH } from './theme';

/**
 * The shared space backdrop for the non-action scenes (menu, shop, game over):
 * one nebula stretched to cover, plus a deterministic field of small stars so
 * every scene looks like it belongs to the same sky.
 */
export function addSpaceBackdrop(
  scene: Phaser.Scene,
  seed: number,
  opts: { stars?: number; alpha?: number } = {},
): void {
  const key = pickBackground(seed);

  if (scene.textures.exists(key)) {
    const image = scene.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, key).setDepth(-20);
    const scale = Math.max(VIEW_WIDTH / image.width, VIEW_HEIGHT / image.height);
    image.setScale(scale).setAlpha(opts.alpha ?? 0.45);
  }

  const rng = createRng(seed ^ 0x9e3779b9);
  const stars = scene.add.graphics().setDepth(-19);
  const count = opts.stars ?? 110;
  for (let i = 0; i < count; i++) {
    stars.fillStyle(0xffffff, nextRange(rng, 0.2, 0.8));
    stars.fillCircle(
      nextRange(rng, 0, VIEW_WIDTH),
      nextRange(rng, 0, VIEW_HEIGHT),
      nextRange(rng, 0.5, 1.9),
    );
  }
}

/** A translucent panel used to group menu content. */
export function addPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 0.82,
): Phaser.GameObjects.Rectangle {
  const panel = scene.add.rectangle(x, y, width, height, PALETTE.panel, alpha);
  panel.setStrokeStyle(2, PALETTE.panelEdge);
  return panel;
}
