import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { cityById } from '../core';

export class CityScene extends BaseScene {
  constructor() {
    super('City');
  }

  create(data: { cityId?: string }): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    this.backButton('WorldMap');
    const city = cityById(data?.cityId ?? '');
    if (!city) {
      this.scene.start('WorldMap');
      return;
    }

    const { width } = this.scale;
    this.header(city.name.toUpperCase());
    this.goldText();
    addText(this, width / 2, 110, city.description, { fontSize: '16px', color: '#b8aa94' });

    const cx = width / 2;
    this.button(cx, 220, 'COLISEUM', () => this.scene.start('Coliseum', { cityId: city.id }));
    this.button(cx, 300, 'SHOP', () => this.scene.start('Shop', { tier: city.shopTier, cityId: city.id }));
    this.button(cx, 380, 'SLAVE MARKET', () => this.scene.start('Recruit', { tier: city.shopTier, cityId: city.id }));
    this.button(cx, 460, 'BLACKSMITH', () => this.scene.start('Blacksmith', { cityId: city.id }));
    this.button(cx, 540, 'INFIRMARY', () => this.scene.start('Infirmary', { cityId: city.id }));
  }
}
