import Phaser from 'phaser';
import { getState } from '../state/store';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // First-time players get the guided tutorial; everyone else goes to the hub.
    this.scene.start(getState().tutorialSeen ? 'Main' : 'Tutorial');
  }
}
