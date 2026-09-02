import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { forge, forgeCost, type EquipmentSlot, type MetalId } from '../core';

const SLOTS: EquipmentSlot[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'mainHand', 'offHand'];
const METALS: MetalId[] = ['bronze', 'iron', 'silver', 'gold'];

export class BlacksmithScene extends BaseScene {
  private slot: EquipmentSlot = 'head';
  private cityId = '';

  constructor() {
    super('Blacksmith');
  }

  create(data: { cityId?: string } = {}): void {
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  private render(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('BLACKSMITH');
    this.cityBack(this.cityId);
    this.goldText();

    const { width } = this.scale;
    addText(this, width / 2, 105, `Forge slot: ${this.slot}`, { fontSize: '20px', color: '#f2d98c' });

    SLOTS.forEach((slot, i) => {
      const x = 180 + (i % 4) * 230;
      const y = 165 + Math.floor(i / 4) * 50;
      const btn = this.button(x, y, slot, () => {
        this.slot = slot;
        this.render();
      }, { width: 200, height: 40, fontSize: 15 });
      if (slot !== this.slot) btn.container.setAlpha(0.55);
    });

    addText(this, width / 2, 260, 'Metals:', { fontSize: '18px', color: '#f2d98c' });
    METALS.forEach((metal, i) => {
      const y = 310 + i * 50;
      const have = this.gameState.metals[metal] ?? 0;
      addText(this, width / 2 - 240, y, `${metal} x${have} — ${forgeCost(metal)} gp`, {
        fontSize: '17px',
      }).setOrigin(0, 0.5);
      const btn = this.button(width / 2 + 220, y, 'FORGE', () => this.forgeItem(metal), {
        width: 130,
        height: 44,
        fontSize: 17,
      });
      if (have < 1 || this.gameState.gold < forgeCost(metal)) btn.setEnabled(false);
    });
  }

  private forgeItem(metal: MetalId): void {
    try {
      this.gameState = forge(this.gameState, this.slot, metal);
    } catch {
      // missing gold or metal — button is disabled anyway
    }
    this.render();
  }
}
