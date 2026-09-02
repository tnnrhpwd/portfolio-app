import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { cityById, coliseumOpponentLevels } from '../core';

export class ColiseumScene extends BaseScene {
  private cityId = '';

  constructor() {
    super('Coliseum');
  }

  create(data: { cityId?: string }): void {
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const city = cityById(this.cityId);
    if (!city) {
      this.scene.start('WorldMap');
      return;
    }
    this.cityBack(city.id);
    this.goldText();

    this.header(`${city.name.toUpperCase()} COLISEUM`);
    addText(this, this.cx, 110, 'Challenge a contender:', { fontSize: '18px', color: '#f2d98c' });

    const compact = this.compact;
    const levels = coliseumOpponentLevels(city);
    levels.forEach((level, i) => {
      const y = 160 + i * (compact ? 88 : 60);
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 20 : y,
        `Contender ${i + 1} — level ${level}`,
        { fontSize: '18px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      this.button(compact ? this.cx : this.cx + 210, compact ? y + 20 : y, 'FIGHT', () =>
        this.scene.start('Battle', { enemyRank: level }),
      {
        width: 130,
        height: 44,
        fontSize: 18,
      });
    });
  }
}
