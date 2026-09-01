import Phaser from 'phaser';

export class MainScene extends Phaser.Scene {
  constructor() {
    super('Main');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x120e0a);
    this.add
      .text(width / 2, height / 2 - 24, 'Colosseum', {
        fontFamily: 'serif',
        fontSize: '64px',
        color: '#e8b84b',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 + 40, 'Phase 1 — playable shell', {
        fontFamily: 'sans-serif',
        fontSize: '24px',
        color: '#d8cbb8',
      })
      .setOrigin(0.5);
  }
}
