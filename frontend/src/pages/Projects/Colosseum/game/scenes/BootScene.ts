import Phaser from 'phaser';
import { getState } from '../state/store';
import { getSettings } from '../settings';
import { setMuted } from '../audio/sfx';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    setMuted(getSettings().muted);
    // First-time players get the guided tutorial; everyone else goes to the hub.
    this.scene.start(getState().tutorialSeen ? 'Main' : 'Tutorial');
  }
}
