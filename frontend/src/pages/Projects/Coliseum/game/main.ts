import Phaser from 'phaser';
import { createGameConfig } from './config';
import { getSettings } from './settings';
import { applyDemoCampaign } from './state/store';
import { detectLayoutMode, getThemeColors, setLayoutMode } from './theme';

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

/**
 * DEV ONLY — `__coliseumDemo()` in the browser console replaces the save with a
 * fully-stocked campaign (see `core/demoSave.ts`), so the inventory grid, the drag
 * targets and the fighter overlays can be exercised without buying gear by hand.
 * Reload afterwards: scenes read the state when they are created.
 */
function exposeDevHooks(): void {
  if (!isDevBuild()) return;
  (window as unknown as Record<string, unknown>).__coliseumDemo = applyDemoCampaign;
}

/** `import.meta.env` without adding the vite/client types just for this one flag. */
function isDevBuild(): boolean {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}

export function createGame(parent: HTMLElement): GameHandle {
  // The design box is chosen once, here, BEFORE Phaser exists. Every scene
  // reads it while laying out, so it must not change while this instance lives —
  // rotating the device destroys the game and the shell builds a new one.
  setLayoutMode(detectLayoutMode());
  exposeDevHooks();

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
