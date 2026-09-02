import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import {
  clamp,
  COLISEUM_LADDER_SIZE,
  COLISEUM_RANK_REACH,
  coliseumOpponentLevel,
  coliseumRank,
  coliseumTeamName,
  cityById,
  type City,
} from '../core';

export class ColiseumScene extends BaseScene {
  private cityId = '';
  private scrollY = 0;
  private dragStartY = 0;
  private dragScrollY = 0;

  constructor() {
    super('Coliseum');
  }

  create(data: { cityId?: string }): void {
    this.cityId = data?.cityId ?? '';
    this.scrollY = 0;
    this.registerScrolling();
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private layout(compact: boolean): { rowH: number; listTop: number; listBottom: number } {
    const rowH = compact ? 56 : 44;
    const listTop = compact ? 152 : 132;
    const listBottom = this.h - (compact ? 28 : 36);
    return { rowH, listTop, listBottom };
  }

  private maxScroll(): number {
    const { rowH, listTop, listBottom } = this.layout(this.compact);
    return Math.max(0, COLISEUM_LADDER_SIZE * rowH - (listBottom - listTop));
  }

  private setScroll(y: number): void {
    const next = clamp(y, 0, this.maxScroll());
    if (next !== this.scrollY) {
      this.scrollY = next;
      this.render();
    }
  }

  private scrollBy(delta: number): void {
    this.setScroll(this.scrollY + delta);
  }

  private registerScrolling(): void {
    this.input.on('wheel', (_pointer: unknown, _over: unknown, _dx: number, dy: number) => {
      this.scrollBy(dy);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartY = pointer.y;
      this.dragScrollY = this.scrollY;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      this.setScroll(this.dragScrollY + (this.dragStartY - pointer.y));
    });
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const city = cityById(this.cityId);
    if (!city) {
      this.scene.start('Main');
      return;
    }
    this.cityBack(city.id);
    this.goldText();

    this.header(`${city.name.toUpperCase()} COLISEUM`);
    const rank = coliseumRank(this.gameState, city.id);
    const winsToChampion = Math.ceil((rank - 1) / COLISEUM_RANK_REACH);
    addText(
      this,
      this.cx,
      96,
      `Your rank: ${rank} of ${COLISEUM_LADDER_SIZE} — ${winsToChampion} more win${winsToChampion === 1 ? '' : 's'} to reach #1`,
      { fontSize: '16px', color: '#f2d98c', wordWrap: { width: this.w - 40 } },
    );
    addText(
      this,
      this.cx,
      118,
      `Challenge anyone within ${COLISEUM_RANK_REACH} ranks above you, or any team below you.`,
      { fontSize: '13px', color: '#b8aa94', wordWrap: { width: this.w - 40 } },
    );

    const compact = this.compact;
    const { rowH, listTop, listBottom } = this.layout(compact);
    this.scrollY = clamp(this.scrollY, 0, this.maxScroll());

    // Scrollable contenders list (viewport panel).
    const panelW = compact ? this.w - 20 : 620;
    this.add
      .rectangle(this.cx, (listTop + listBottom) / 2, panelW, listBottom - listTop, this.theme.panel, 1)
      .setStrokeStyle(2, this.theme.panelStroke);

    const floor = rank - COLISEUM_RANK_REACH; // best rank you may fight
    for (let ladderRank = 1; ladderRank <= COLISEUM_LADDER_SIZE; ladderRank += 1) {
      const y = listTop + (ladderRank - 1) * rowH - this.scrollY + rowH / 2;
      if (y - rowH / 2 < listTop - 1 || y + rowH / 2 > listBottom + 1) continue;
      if (ladderRank === rank) {
        this.playerRow(rank, y, compact);
      } else {
        this.teamRow(city, ladderRank, ladderRank >= floor, y, compact);
      }
    }

    // Up / down scroll controls.
    const ax = compact ? this.w - 24 : this.cx + 324;
    this.button(ax, listTop - 16, '▲', () => this.scrollBy(-rowH), { width: 40, height: 30, fontSize: 15 });
    this.button(ax, listBottom + 16, '▼', () => this.scrollBy(rowH), { width: 40, height: 30, fontSize: 15 });

    if (this.maxScroll() > 0) {
      addText(this, this.cx, listBottom + 16, 'Scroll for more teams', {
        fontSize: '12px',
        color: '#6a6258',
      });
    }
  }

  /** The player's own team, slotted at its current ladder rank. */
  private playerRow(rank: number, y: number, compact: boolean): void {
    const lead = this.gameState.roster[0];
    const name = this.gameState.teamName || lead?.name || 'Your Team';
    const level = lead?.level ?? 1;
    const labelX = compact ? this.cx - 150 : this.cx - 280;
    const lvX = compact ? this.cx + 40 : this.cx;
    const btnX = compact ? this.cx + 140 : this.cx + 250;

    addText(this, labelX, y, `${rank}. ${name}`, {
      fontSize: compact ? '13px' : '15px',
      color: '#f2d98c',
    }).setOrigin(0, 0.5);
    addText(this, lvX, y, `Lv ${level}`, {
      fontSize: compact ? '12px' : '13px',
      color: '#f2d98c',
    });
    addText(this, btnX, y, 'YOU', {
      fontSize: compact ? '12px' : '14px',
      color: '#f2d98c',
    }).setOrigin(0.5, 0.5);
  }

  /** One row of the 16-team ladder (1 = champion at the top, 16 = weakest). */
  private teamRow(city: City, ladderRank: number, fightable: boolean, y: number, compact: boolean): void {
    const level = coliseumOpponentLevel(city, ladderRank);
    const name = coliseumTeamName(city, ladderRank);
    const label = `${ladderRank}. ${name}`;
    const labelX = compact ? this.cx - 150 : this.cx - 280;
    const lvX = compact ? this.cx + 40 : this.cx;
    const btnX = compact ? this.cx + 140 : this.cx + 250;

    addText(this, labelX, y, label, {
      fontSize: compact ? '13px' : '15px',
      color: fightable ? '#e8dcc8' : '#6a6258',
    }).setOrigin(0, 0.5);
    addText(this, lvX, y, `Lv ${level}`, {
      fontSize: compact ? '12px' : '13px',
      color: fightable ? '#b8aa94' : '#6a6258',
    });
    if (fightable) {
      this.button(btnX, y, 'FIGHT', () => this.fight(ladderRank, level), {
        width: compact ? 90 : 110,
        height: compact ? 30 : 32,
        fontSize: compact ? 13 : 15,
      });
    } else {
      addText(this, btnX, y, 'LOCKED', { fontSize: compact ? '12px' : '14px', color: '#c0392b' }).setOrigin(0.5, 0.5);
    }
  }

  private fight(ladderRank: number, level: number): void {
    this.scene.start('Battle', { enemyRank: level, cityId: this.cityId, ladderRank });
  }
}
