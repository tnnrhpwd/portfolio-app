import Phaser from 'phaser';
import { createGameConfig } from './config';

export interface GameHandle {
  game: Phaser.Game;
  destroy: () => void;
}

export function createGame(parent: HTMLElement): GameHandle {
  const game = new Phaser.Game(createGameConfig(parent));
  return {
    game,
    destroy: () => {
      game.destroy(true);
    },
  };
}
