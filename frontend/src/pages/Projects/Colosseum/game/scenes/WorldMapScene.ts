import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { CITIES, isCityUnlocked } from '../core';

export class WorldMapScene extends BaseScene {
  constructor() {
    super('WorldMap');
  }

  create(): void {
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.header('WORLD MAP');
    this.backButton('Main');
    this.goldText();

    addText(this, this.cx, 100, `Fame: ${this.gameState.fame} — win fights to unlock cities`, {
      fontSize: '18px',
      color: '#f2d98c',
      wordWrap: { width: this.w - 60 },
    });

    const compact = this.compact;
    const cols = compact ? 1 : 2;
    const gapX = compact ? 0 : 300;
    const rowH = compact ? 74 : 98;
    CITIES.forEach((city, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.cx - ((cols - 1) * gapX) / 2 + col * gapX;
      const y = 170 + row * rowH;
      const unlocked = isCityUnlocked(city, this.gameState.fame);
      const label = unlocked ? city.name : `${city.name}  (rank ${city.rank})`;
      const btn = this.button(x, y, label, () => this.scene.start('City', { cityId: city.id }), {
        width: 260,
        height: 54,
        fontSize: 20,
      });
      if (!unlocked) btn.setEnabled(false);
    });
  }
}
