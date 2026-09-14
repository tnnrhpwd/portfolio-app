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

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('BLACKSMITH');
    this.cityBack(this.cityId);
    this.goldText();

    // Four slot buttons per row needs 890px, so the tall box drops to two per
    // row and stacks each metal's label above its FORGE button.
    const portrait = this.portrait;
    addText(this, this.cx, portrait ? 140 : 105, `Forge slot: ${this.slot}`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    const cols = portrait ? 2 : 4;
    const slotGap = portrait ? 200 : 230;
    const slotTop = portrait ? 215 : 165;
    SLOTS.forEach((slot, i) => {
      const x = this.cx - ((cols - 1) / 2) * slotGap + (i % cols) * slotGap;
      const y = slotTop + Math.floor(i / cols) * (portrait ? 62 : 50);
      const btn = this.button(x, y, slot, () => {
        this.slot = slot;
        this.render();
      }, { width: portrait ? 184 : 200, height: portrait ? 50 : 40, fontSize: 15 });
      if (slot !== this.slot) btn.container.setAlpha(0.55);
    });

    const rowsOfSlots = Math.ceil(SLOTS.length / cols);
    let metalsY = slotTop + rowsOfSlots * (portrait ? 62 : 50) + 30;
    if (this.slot === 'offHand') {
      metalsY += 56;
      const toggleY = slotTop + rowsOfSlots * (portrait ? 62 : 50) + 6;
      this.button(
        this.cx,
        toggleY,
        this.offhandWeapon ? 'FORGE: SECOND WEAPON' : 'FORGE: SHIELD',
        () => {
          this.offhandWeapon = !this.offhandWeapon;
          this.render();
        },
        { width: portrait ? 300 : 240, height: 36, fontSize: 13 },
      );
    }
    addText(this, this.cx, metalsY, 'Metals:', { fontSize: '18px', color: '#f2d98c' });
    METALS.forEach((metal, i) => {
      const y = metalsY + (portrait ? 66 : 50) + i * (portrait ? 112 : 50);
      const have = this.gameState.metals[metal] ?? 0;
      addText(
        this,
        portrait ? this.cx : this.cx - 240,
        portrait ? y - 26 : y,
        `${metal} x${have} — ${forgeCost(metal)} gp`,
        { fontSize: '17px' },
      ).setOrigin(portrait ? 0.5 : 0, 0.5);
      const btn = this.button(portrait ? this.cx : this.cx + 220, portrait ? y + 26 : y, 'FORGE', () =>
        this.confirm(
          'Forge item?',
          `Forge a ${this.slot} using ${metal} for ${forgeCost(metal)} gp?`,
          () => this.forgeItem(metal),
        ),
      { width: portrait ? 200 : 130, height: portrait ? 56 : 44, fontSize: 17 });
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
