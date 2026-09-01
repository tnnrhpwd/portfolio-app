import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // Phase 1: nothing to preload yet — hand off to the playable shell.
    this.scene.start('Main');
  }
}
