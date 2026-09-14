import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { cityById } from '../core';

export class CityScene extends BaseScene {
  private cityId = '';

  constructor() {
    super('City');
  }

  create(data: { cityId?: string }): void {
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.backButton('Main');
    const city = cityById(this.cityId);
    if (!city) {
      this.scene.start('Main');
      return;
    }

    this.header(city.name.toUpperCase());
    this.goldText();
    addText(this, this.cx, 110, city.description, {
      fontSize: '16px',
      color: '#b8aa94',
      wordWrap: { width: this.w - 60 },
    });

    // The tall box spreads the five facilities down the screen with roomier
    // targets; the wide box keeps them as a tight centred column.
    const portrait = this.portrait;
    const step = portrait ? 118 : 80;
    const top = portrait ? 330 : 220;
    const size = { width: portrait ? 400 : 260, height: portrait ? 68 : 56 };
    this.button(this.cx, top, 'COLISEUM', () => this.scene.start('Coliseum', { cityId: city.id }), size);
    this.button(this.cx, top + step, 'SHOP', () => this.scene.start('Shop', { tier: city.shopTier, cityId: city.id }), size);
    this.button(this.cx, top + step * 2, 'RECRUIT', () => this.scene.start('Recruit', { tier: city.shopTier, cityId: city.id }), size);
    this.button(this.cx, top + step * 3, 'BLACKSMITH', () => this.scene.start('Blacksmith', { cityId: city.id }), size);
    this.button(this.cx, top + step * 4, 'INFIRMARY', () => this.scene.start('Infirmary', { cityId: city.id }), size);
  }
}
