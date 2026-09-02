import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { currentHp, healCost, healToFull, totalHp } from '../core';

export class InfirmaryScene extends BaseScene {
  private cityId = '';

  constructor() {
    super('Infirmary');
  }

  create(data: { cityId?: string } = {}): void {
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('INFIRMARY');
    this.cityBack(this.cityId);
    this.goldText();

    const { width } = this.scale;
    const fighter = this.gameState.roster[0];
    const hp = currentHp(fighter);
    const maxHp = totalHp(fighter);
    const cost = healCost(fighter);

    addText(this, width / 2, 140, `${fighter.name}: HP ${hp}/${maxHp}`, { fontSize: '22px' });
    addText(this, width / 2, 180, `Full treatment costs ${cost} gp`, { fontSize: '18px', color: '#f2d98c' });

    const btn = this.button(width / 2, 260, 'HEAL TO FULL', () => this.heal());
    if (hp >= maxHp || this.gameState.gold < cost) btn.setEnabled(false);
    if (hp >= maxHp) {
      addText(this, width / 2, 320, 'Already at full health.', { fontSize: '16px', color: '#b8aa94' });
    }
  }

  private heal(): void {
    try {
      this.gameState = healToFull(this.gameState);
    } catch {
      // not enough gold — button is disabled anyway
    }
    this.render();
  }
}
