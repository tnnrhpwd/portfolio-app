import Phaser from 'phaser';
import { createGameConfig } from './config';
import { getSettings } from './settings';
import { getThemeColors } from './theme';

export interface GameHandle {
  game: Phaser.Game;
  destroy: () => void;
}

/**
 * Watches the site's light/dark toggle (a class on `document.body`) so the
 * game follows it live when the game's own theme setting is 'system'. Menu
 * scenes redraw in place; an in-progress battle only repaints its backdrop so
 * the fight state is never lost.
 */
function observeThemeChanges(game: Phaser.Game): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  let lastIsLight = getThemeColors().isLight;
  const observer = new MutationObserver(() => {
    if (getSettings().theme !== 'system') return;
    const colors = getThemeColors();
    if (colors.isLight === lastIsLight) return;
    lastIsLight = colors.isLight;
    const scene = game.scene.getScenes(true)[0];
    if (!scene) return;
    scene.cameras.main.setBackgroundColor(scene.scene.key === 'Battle' ? colors.bgAlt : colors.bg);
    if (scene.scene.key !== 'Battle') scene.scene.restart();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function createGame(parent: HTMLElement): GameHandle {
  const game = new Phaser.Game(createGameConfig(parent));
  const stopObserving = observeThemeChanges(game);
  return {
    game,
    destroy: () => {
      stopObserving();
      game.destroy(true);
    },
  };
}
