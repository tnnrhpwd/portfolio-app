import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import {
  ATTRIBUTE_DEFS,
  ATTRIBUTE_KEYS,
  resetAttributes,
  spendAttributePoint,
  STAT_CAPS,
  type AttributeKey,
} from '../core';

export class TrainScene extends BaseScene {
  constructor() {
    super('Train');
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
    this.header('TRAIN');
    this.backButton('Main');
    this.goldText();

    const fighter = this.gameState.roster[0];
    const tip = createTooltip(this);
    const compact = this.compact;

    addText(this, this.cx, 110, `Unspent attribute points: ${fighter.attributePoints}`, {
      fontSize: '22px',
      color: '#f2d98c',
    });

    const startY = 170;
    ATTRIBUTE_KEYS.forEach((key: AttributeKey, i: number) => {
      const y = startY + i * (compact ? 84 : 68);
      const labelX = compact ? this.cx : this.cx - 220;
      const btnX = compact ? this.cx : this.cx + 200;
      const labelY = compact ? y - 22 : y;
      const btnY = compact ? y + 22 : y;
      addText(this, labelX, labelY, `${ATTRIBUTE_DEFS[key].label}: ${fighter.attributes[key]}`, {
        fontSize: '22px',
      }).setOrigin(compact ? 0.5 : 0, 0.5);
      const btn = this.button(btnX, btnY, '+', () => this.spend(key), {
        width: 64,
        height: 48,
        fontSize: 22,
        hover: () => tip.show(this.cx, y - 42, ATTRIBUTE_DEFS[key].blurb),
        blur: () => tip.hide(),
      });
      if (fighter.attributePoints <= 0 || fighter.attributes[key] >= STAT_CAPS[key]) {
        btn.setEnabled(false);
      }
    });

    const spent = ATTRIBUTE_KEYS.reduce(
      (acc, key) => acc + (fighter.attributes[key] - fighter.baseAttributes[key]),
      0,
    );
    const resetBtn = this.button(this.cx, this.h - 56, `RESET (${spent} spent)`, () => this.reset(), {
      width: 240,
      height: 48,
      fontSize: 18,
    });
    if (spent <= 0) resetBtn.setEnabled(false);
  }

  private spend(key: AttributeKey): void {
    try {
      const next = spendAttributePoint(this.gameState.roster[0], key);
      this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    } catch {
      // no points remaining or at cap — button is disabled anyway
    }
    this.render();
  }

  private reset(): void {
    this.confirm('Reset attributes?', 'Refund all spent attribute points.', () => {
      const next = resetAttributes(this.gameState.roster[0]);
      this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
      this.render();
    });
  }
}
