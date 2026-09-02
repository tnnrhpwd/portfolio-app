import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { cityById, coliseumOpponentLevels } from '../core';

export class ColiseumScene extends BaseScene {
  constructor() {
    super('Coliseum');
  }

  create(data: { cityId?: string }): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    const city = cityById(data?.cityId ?? '');
    if (!city) {
      this.scene.start('WorldMap');
      return;
    }
    this.cityBack(city.id);
    this.goldText();

    const { width } = this.scale;
    this.header(`${city.name.toUpperCase()} COLISEUM`);
    addText(this, width / 2, 110, 'Challenge a contender:', { fontSize: '18px', color: '#f2d98c' });

    const levels = coliseumOpponentLevels(city);
    levels.forEach((level, i) => {
      const y = 160 + i * 60;
      addText(this, width / 2 - 240, y, `Contender ${i + 1} — level ${level}`, {
        fontSize: '18px',
      }).setOrigin(0, 0.5);
      this.button(width / 2 + 210, y, 'FIGHT', () => this.scene.start('Battle', { enemyRank: level }), {
        width: 130,
        height: 44,
        fontSize: 18,
      });
    });
  }
}
