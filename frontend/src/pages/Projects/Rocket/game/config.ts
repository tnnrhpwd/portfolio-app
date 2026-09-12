import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameOverScene } from './scenes/GameOverScene';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import { ShopScene } from './scenes/ShopScene';
import { PALETTE, VIEW_HEIGHT, VIEW_WIDTH } from './ui/theme';

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: PALETTE.bg,
    scale: {
      /**
       * FIT, not RESIZE (which the Coliseum game uses).
       *
       * A shooter's difficulty is a function of how much room you have to
       * dodge: with RESIZE, a wider window would silently make the game easier
       * and a phone in portrait would make it cramped. Fitting a fixed
       * 1280×720 arena letterboxes the remainder instead, so the game plays
       * identically everywhere — and every scene can lay out in absolute
       * coordinates with no reflow logic.
       */
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
    },
    scene: [BootScene, MenuScene, PlayScene, ShopScene, GameOverScene],
    title: 'Rocket',
    // No Phaser sound manager: all audio is synthesized in `audio/sfx.ts`.
    audio: { noAudio: true },
  };
}
