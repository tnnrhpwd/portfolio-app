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
      align: 'center',
    });

    // Two columns need 820px, so the wide box gets a 2-column grid and the tall
    // box gets a single column of taller rows (10 cities fit in 1280).
    const portrait = this.portrait;
    const cols = portrait ? 1 : 2;
    const gapX = portrait ? 0 : 300;
    const rowH = portrait ? 86 : 98;
    const top = portrait ? 190 : 170;
    CITIES.forEach((city, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.cx - ((cols - 1) * gapX) / 2 + col * gapX;
      const y = top + row * rowH;
      const unlocked = isCityUnlocked(this.gameState, city.id);
      const label = unlocked ? city.name : `${city.name}  (rank ${city.rank})`;
      const btn = this.button(x, y, label, () => this.scene.start('City', { cityId: city.id }), {
        width: portrait ? 320 : 260,
        height: portrait ? 58 : 54,
        fontSize: 20,
      });
      if (!unlocked) btn.setEnabled(false);
    });
  }
}
