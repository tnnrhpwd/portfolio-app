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

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.backButton('Main');
    const city = cityById(this.cityId);
    if (!city) {
      this.scene.start('WorldMap');
      return;
    }

    this.header(city.name.toUpperCase());
    this.goldText();
    addText(this, this.cx, 110, city.description, {
      fontSize: '16px',
      color: '#b8aa94',
      wordWrap: { width: this.w - 60 },
    });

    this.button(this.cx, 220, 'COLISEUM', () => this.scene.start('Coliseum', { cityId: city.id }));
    this.button(this.cx, 300, 'SHOP', () => this.scene.start('Shop', { tier: city.shopTier, cityId: city.id }));
    this.button(this.cx, 380, 'SLAVE MARKET', () => this.scene.start('Recruit', { tier: city.shopTier, cityId: city.id }));
    this.button(this.cx, 460, 'BLACKSMITH', () => this.scene.start('Blacksmith', { cityId: city.id }));
    this.button(this.cx, 540, 'INFIRMARY', () => this.scene.start('Infirmary', { cityId: city.id }));
  }
}
