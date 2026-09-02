import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { ATTRIBUTE_DEFS, ATTRIBUTE_KEYS, STAT_CAPS, spendAttributePoint, type AttributeKey } from '../core';

export class TrainScene extends BaseScene {
  constructor() {
    super('Train');
  }

  create(): void {
    this.render();
  }

  private render(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('TRAIN');
    this.backButton('Main');
    this.goldText();

    const { width } = this.scale;
    const fighter = this.gameState.roster[0];
    addText(this, width / 2, 110, `Unspent attribute points: ${fighter.attributePoints}`, {
      fontSize: '22px',
      color: '#f2d98c',
    });

    const startY = 170;
    ATTRIBUTE_KEYS.forEach((key: AttributeKey, i: number) => {
      const y = startY + i * 70;
      addText(this, width / 2 - 220, y, `${ATTRIBUTE_DEFS[key].label}: ${fighter.attributes[key]}`, {
        fontSize: '22px',
      }).setOrigin(0, 0.5);
      const btn = this.button(width / 2 + 200, y, '+', () => this.spend(key), {
        width: 64,
        height: 48,
        fontSize: 22,
      });
      if (fighter.attributePoints <= 0 || fighter.attributes[key] >= STAT_CAPS[key]) {
        btn.setEnabled(false);
      }
    });
  }

  private spend(key: AttributeKey): void {
    try {
      const next = spendAttributePoint(this.gameState.roster[0], key);
      this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    } catch {
      // no points remaining or already at cap — button is disabled anyway
    }
    this.render();
  }
}
