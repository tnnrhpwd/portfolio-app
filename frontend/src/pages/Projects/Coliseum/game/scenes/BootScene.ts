import Phaser from 'phaser';
import { getState, syncCloud } from '../state/store';
import { getSettings } from '../settings';
import { setMuted } from '../audio/sfx';
import { ensureTextures, loadArenaRaster, loadMapRaster, waitForArtTextures } from '../assets/textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    setMuted(getSettings().muted);
    // Register the original vector art and wait for the async SVG loads to
    // finish so the first rendered frame already has real textures (no
    // `__MISSING` placeholder flicker). Route once art + cloud sync settle.
    ensureTextures(this);
    const artReady = waitForArtTextures(this);
    const mapReady = loadMapRaster(this);
    const arenaReady = loadArenaRaster(this);
    void Promise.all([artReady, mapReady, arenaReady, syncCloud()]).finally(() => {
      this.scene.start(getState().tutorialSeen ? 'Main' : 'Creation');
    });
  }
}
