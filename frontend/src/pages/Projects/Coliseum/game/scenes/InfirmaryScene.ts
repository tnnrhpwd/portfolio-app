import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { currentHp, healCost, healToFull, totalHp } from '../core';

const PAGE_SIZE = 6;

export class InfirmaryScene extends BaseScene {
  private cityId = '';
  private page = 0;

  constructor() {
    super('Infirmary');
  }

  create(data: { cityId?: string } = {}): void {
    this.cityId = data?.cityId ?? '';
    this.page = 0;
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('INFIRMARY');
    this.cityBack(this.cityId);
    this.goldText();

    const { width } = this.scale;
    const roster = this.gameState.roster;
    const compact = this.compact;

    if (roster.length === 0) {
      addText(this, width / 2, 160, 'No fighters to heal.', { fontSize: '18px', color: '#b8aa94' });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(roster.length / PAGE_SIZE));
    this.page = Math.min(this.page, totalPages - 1);
    const rows = roster.slice(this.page * PAGE_SIZE, this.page * PAGE_SIZE + PAGE_SIZE);

    const rowH = compact ? 58 : 68;
    const topY = compact ? 116 : 128;
    const cardW = compact ? width - 24 : 500;
    const x0 = width / 2 - cardW / 2;

    addText(this, width / 2, topY - 26, 'Each fighter heals every body zone to full.', {
      fontSize: '14px',
      color: '#b8aa94',
    });

    rows.forEach((fighter, i) => {
      const y = topY + i * rowH;
      const hp = currentHp(fighter);
      const maxHp = totalHp(fighter);
      const cost = healCost(fighter);
      const full = hp >= maxHp;

      this.add
        .rectangle(width / 2, y, cardW, rowH - 10, this.theme.panel, 1)
        .setStrokeStyle(1, this.theme.panelStroke, 0.6);

      addText(this, x0 + 16, y - 12, fighter.name, { fontSize: compact ? '15px' : '18px' }).setOrigin(0, 0.5);
      addText(this, x0 + 16, y + 12, `HP ${hp}/${maxHp}`, { fontSize: '13px', color: '#b8aa94' }).setOrigin(0, 0.5);

      if (full) {
        addText(this, x0 + cardW - 16, y, 'FULL HEALTH', { fontSize: '14px', color: '#6a9a6a' }).setOrigin(1, 0.5);
      } else {
        const btn = this.button(x0 + cardW - 16, y, `HEAL ${cost}gp`, () => this.heal(this.page * PAGE_SIZE + i), {
          width: compact ? 110 : 140,
          height: compact ? 40 : 46,
          fontSize: compact ? 13 : 15,
        });
        if (this.gameState.gold < cost) btn.setEnabled(false);
      }
    });

    if (totalPages > 1) {
      const pageY = topY + PAGE_SIZE * rowH + 12;
      const prev = this.button(width / 2 - 80, pageY, '\u25C0', () => this.changePage(-1), { width: 44, height: 36, fontSize: 18 });
      addText(this, width / 2, pageY, `PAGE ${this.page + 1}/${totalPages}`, { fontSize: '14px', color: '#f2d98c' });
      const next = this.button(width / 2 + 80, pageY, '\u25B6', () => this.changePage(1), { width: 44, height: 36, fontSize: 18 });
      if (this.page <= 0) prev.setEnabled(false);
      if (this.page >= totalPages - 1) next.setEnabled(false);
    }
  }

  private changePage(delta: number): void {
    const totalPages = Math.max(1, Math.ceil(this.gameState.roster.length / PAGE_SIZE));
    this.page = Math.max(0, Math.min(this.page + delta, totalPages - 1));
    this.render();
  }

  private heal(index: number): void {
    try {
      this.gameState = healToFull(this.gameState, index);
    } catch {
      // not enough gold — button is disabled anyway
    }
    this.render();
  }
}
