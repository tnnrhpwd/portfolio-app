import Phaser from 'phaser';
import { disposeMusic } from './audio/music';
import { disposeAudio, initAudio } from './audio/sfx';
import { createGameConfig } from './config';
import { detectLayoutMode, setLayoutMode } from './ui/theme';

export interface GameHandle {
  game: Phaser.Game;
  destroy: () => void;
}

/**
 * Boot the game into `parent`.
 *
 * The Coliseum pattern: React owns the page chrome and mounts one container;
 * everything visible inside it is canvas. Audio is unlocked on the first real
 * gesture (a browser requirement) and the AudioContext is closed on teardown so
 * navigating away doesn't leak a running context.
 */
export function createGame(parent: HTMLElement): GameHandle {
  // The design box is chosen once, here, before Phaser exists. Every scene reads
  // it while laying out, so it must not change while a game instance is alive.
  setLayoutMode(detectLayoutMode());

  const game = new Phaser.Game(createGameConfig(parent));

  const unlock = (): void => initAudio();
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  return {
    game,
    destroy: () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
      disposeMusic();
      disposeAudio();
      game.destroy(true);
    },
  };
}
