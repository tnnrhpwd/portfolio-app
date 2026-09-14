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

  /**
   * Row geometry for the active design box.
   *
   * The tall box has the vertical budget for roomier rows. Its height is a fixed
   * 1280, so cap the row height to keep all COLISEUM_LADDER_SIZE rows inside the
   * viewport band rather than letting the last rows run off the bottom.
   */
  private layout(portrait: boolean): { rowH: number; listTop: number; listBottom: number } {
    if (!portrait) return { rowH: 44, listTop: 132, listBottom: this.h - 36 };
    const listTop = 196;
    const listBottom = this.h - 44;
    const rowH = Math.min(64, Math.floor((listBottom - listTop) / COLISEUM_LADDER_SIZE));
    return { rowH, listTop, listBottom };
  }

  private maxScroll(): number {
    const { rowH, listTop, listBottom } = this.layout(this.portrait);
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
    this.menuBackground();
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

    const portrait = this.portrait;
    const { rowH, listTop, listBottom } = this.layout(portrait);
    this.scrollY = clamp(this.scrollY, 0, this.maxScroll());

    // Scrollable contenders list (viewport panel).
    const panelW = portrait ? this.w - 20 : 620;
    this.add
      .rectangle(this.cx, (listTop + listBottom) / 2, panelW, listBottom - listTop, this.theme.panel, 1)
      .setStrokeStyle(2, this.theme.panelStroke);

    const floor = rank - COLISEUM_RANK_REACH; // best rank you may fight
    for (let ladderRank = 1; ladderRank <= COLISEUM_LADDER_SIZE; ladderRank += 1) {
      const y = listTop + (ladderRank - 1) * rowH - this.scrollY + rowH / 2;
      if (y - rowH / 2 < listTop - 1 || y + rowH / 2 > listBottom + 1) continue;
      if (ladderRank === rank) {
        this.playerRow(rank, y, portrait);
      } else {
        this.teamRow(city, ladderRank, ladderRank >= floor, y, portrait);
      }
    }

    // Up / down scroll controls, only when the ladder overflows the viewport
    // (the tall box sizes every row to fit, so it needs none).
    if (this.maxScroll() > 0) {
      const ax = portrait ? this.cx + 300 : this.cx + 324;
      this.button(ax, listTop - 16, '▲', () => this.scrollBy(-rowH), { width: 40, height: 30, fontSize: 15 });
      this.button(ax, listBottom + 16, '▼', () => this.scrollBy(rowH), { width: 40, height: 30, fontSize: 15 });
      addText(this, this.cx, listBottom + 16, 'Scroll for more teams', {
        fontSize: '12px',
        color: '#6a6258',
      });
    }
  }

  /** The player's own team, slotted at its current ladder rank. */
  private playerRow(rank: number, y: number, portrait: boolean): void {
    const lead = this.gameState.roster[0];
    const name = this.gameState.teamName || lead?.name || 'Your Team';
    const level = lead?.level ?? 1;
    const labelX = portrait ? this.cx - 320 : this.cx - 280;
    const lvX = portrait ? this.cx + 40 : this.cx;
    const btnX = portrait ? this.cx + 240 : this.cx + 250;

    addText(this, labelX, y, `${rank}. ${name}`, {
      fontSize: portrait ? '18px' : '15px',
      color: '#f2d98c',
    }).setOrigin(0, 0.5);
    addText(this, lvX, y, `Lv ${level}`, {
      fontSize: portrait ? '15px' : '13px',
      color: '#f2d98c',
    });
    addText(this, btnX, y, 'YOU', {
      fontSize: portrait ? '16px' : '14px',
      color: '#f2d98c',
    }).setOrigin(0.5, 0.5);
  }

  /** One row of the 16-team ladder (1 = champion at the top, 16 = weakest). */
  private teamRow(city: City, ladderRank: number, fightable: boolean, y: number, portrait: boolean): void {
    const level = coliseumOpponentLevel(city, ladderRank);
    const name = coliseumTeamName(city, ladderRank);
    const label = `${ladderRank}. ${name}`;
    const labelX = portrait ? this.cx - 320 : this.cx - 280;
    const lvX = portrait ? this.cx + 40 : this.cx;
    const btnX = portrait ? this.cx + 240 : this.cx + 250;

    addText(this, labelX, y, label, {
      fontSize: portrait ? '18px' : '15px',
      color: fightable ? '#e8dcc8' : '#6a6258',
    }).setOrigin(0, 0.5);
    addText(this, lvX, y, `Lv ${level}`, {
      fontSize: portrait ? '15px' : '13px',
      color: fightable ? '#b8aa94' : '#6a6258',
    });
    if (fightable) {
      this.button(btnX, y, 'FIGHT', () => this.fight(ladderRank, level), {
        width: portrait ? 100 : 110,
        height: portrait ? 44 : 32,
        fontSize: portrait ? 16 : 15,
      });
    } else {
      addText(this, btnX, y, 'LOCKED', { fontSize: portrait ? '16px' : '14px', color: '#c0392b' }).setOrigin(0.5, 0.5);
    }
  }

  private fight(ladderRank: number, level: number): void {
    this.scene.start('Battle', { enemyRank: level, cityId: this.cityId, ladderRank });
  }
}
