import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { CITIES, isCityUnlocked } from '../core';

export class WorldMapScene extends BaseScene {
  constructor() {
    super('WorldMap');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('WORLD MAP');
    this.backButton('Main');
    this.goldText();

    const { width } = this.scale;
    addText(this, width / 2, 100, `Fame: ${this.gameState.fame} — win fights to unlock cities`, {
      fontSize: '18px',
      color: '#f2d98c',
    });

    const cols = 2;
    CITIES.forEach((city, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = width / 2 - 140 + col * 280;
      const y = 170 + row * 98;
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
