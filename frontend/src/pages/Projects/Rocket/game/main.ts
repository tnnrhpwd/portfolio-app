import Phaser from 'phaser';
import { disposeAudio, initAudio } from './audio/sfx';
import { createGameConfig } from './config';

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
      disposeAudio();
      game.destroy(true);
    },
  };
}
