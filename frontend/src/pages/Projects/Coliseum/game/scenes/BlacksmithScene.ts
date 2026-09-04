import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { forge, forgeCost, type EquipmentSlot, type MetalId } from '../core';

const SLOTS: EquipmentSlot[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'mainHand', 'offHand'];
const METALS: MetalId[] = ['bronze', 'iron', 'silver', 'gold'];

export class BlacksmithScene extends BaseScene {
  private slot: EquipmentSlot = 'head';
  private offhandWeapon = false;
  private cityId = '';

  constructor() {
    super('Blacksmith');
  }

  create(data: { cityId?: string } = {}): void {
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('BLACKSMITH');
    this.cityBack(this.cityId);
    this.goldText();

    const compact = this.compact;
    addText(this, this.cx, 105, `Forge slot: ${this.slot}`, { fontSize: '20px', color: '#f2d98c' });

    const cols = compact ? 2 : 4;
    const slotGap = compact ? 190 : 230;
    SLOTS.forEach((slot, i) => {
      const x = this.cx - ((cols - 1) / 2) * slotGap + (i % cols) * slotGap;
      const y = 165 + Math.floor(i / cols) * 50;
      const btn = this.button(x, y, slot, () => {
        this.slot = slot;
        this.render();
      }, { width: compact ? 170 : 200, height: 40, fontSize: 15 });
      if (slot !== this.slot) btn.container.setAlpha(0.55);
    });

    let metalsY = 165 + Math.ceil(SLOTS.length / cols) * 50 + 30;
    if (this.slot === 'offHand') {
      metalsY += 48;
      const toggleY = 165 + Math.ceil(SLOTS.length / cols) * 50 + 6;
      this.button(
        this.cx,
        toggleY,
        this.offhandWeapon ? 'FORGE: SECOND WEAPON' : 'FORGE: SHIELD',
        () => {
          this.offhandWeapon = !this.offhandWeapon;
          this.render();
        },
        { width: 240, height: 36, fontSize: 13 },
      );
    }
    addText(this, this.cx, metalsY, 'Metals:', { fontSize: '18px', color: '#f2d98c' });
    METALS.forEach((metal, i) => {
      const y = metalsY + 50 + i * (compact ? 78 : 50);
      const have = this.gameState.metals[metal] ?? 0;
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 22 : y,
        `${metal} x${have} — ${forgeCost(metal)} gp`,
        { fontSize: '17px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      const btn = this.button(compact ? this.cx : this.cx + 220, compact ? y + 22 : y, 'FORGE', () =>
        this.confirm(
          'Forge item?',
          `Forge a ${this.slot} using ${metal} for ${forgeCost(metal)} gp?`,
          () => this.forgeItem(metal),
        ),
      { width: 130, height: 44, fontSize: 17 });
      if (have < 1 || this.gameState.gold < forgeCost(metal)) btn.setEnabled(false);
    });
  }

  private forgeItem(metal: MetalId): void {
    try {
      this.gameState = forge(this.gameState, this.slot, metal, Math.random, this.slot === 'offHand' && this.offhandWeapon);
      this.applyAchievements();
    } catch {
      // missing gold or metal — button is disabled anyway
    }
    this.render();
  }
}
