/**
 * The load set is the contract between the sprite pipeline and the game.
 *
 * `assets.queueGameSprites` loads exactly what `requiredSprites()` returns and
 * nothing else, so a sprite that the game draws but that is missing from that
 * list is never fetched. Phaser then quietly renders its own green
 * "missing texture" placeholder, and because the affected screen is usually not
 * the one being worked on (ships live on the menu, shop icons between waves),
 * the bug ships easily.
 *
 * Both of those happened during the first build. These tests are the tripwire.
 */

import manifest from '../../../../../../public/rocket/manifest.json';
import { SHIPS } from './ships';
import { requiredSprites } from './tables';
import { UPGRADES } from './upgrades';

const manifestNames = new Set(manifest.assets.map((asset) => asset.name));

describe('sprite load set', () => {
  it('only asks for sprites that the shipped manifest provides', () => {
    const unknown = requiredSprites().filter((name) => !manifestNames.has(name));
    expect(unknown).toEqual([]);
  });

  it('loads the playable ships', () => {
    const required = new Set(requiredSprites());
    const missing = Object.values(SHIPS)
      .map((ship) => ship.sprite)
      .filter((sprite) => !required.has(sprite));
    expect(missing).toEqual([]);
  });

  it('loads the shop icons', () => {
    const required = new Set(requiredSprites());
    const missing = Object.values(UPGRADES)
      .map((upgrade) => upgrade.sprite)
      .filter((sprite) => !required.has(sprite));
    expect(missing).toEqual([]);
  });

  it('asks for each sprite once', () => {
    const names = requiredSprites();
    expect(new Set(names).size).toBe(names.length);
  });
});
