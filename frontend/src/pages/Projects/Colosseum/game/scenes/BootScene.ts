import Phaser from 'phaser';
import { getState, syncCloud } from '../state/store';
import { getSettings } from '../settings';
import { setMuted } from '../audio/sfx';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    setMuted(getSettings().muted);
    // Sync (adopt cloud save if none locally, else push local) before routing.
    void syncCloud().finally(() => {
      this.scene.start(getState().tutorialSeen ? 'Main' : 'Tutorial');
    });
  }
}
