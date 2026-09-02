import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import {
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

  constructor() {
    super('Coliseum');
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
    const city = cityById(this.cityId);
    if (!city) {
      this.scene.start('Main');
      return;
    }
    this.cityBack(city.id);
    this.goldText();

    this.header(`${city.name.toUpperCase()} COLISEUM`);
    const rank = coliseumRank(this.gameState, city.id);
    addText(
      this,
      this.cx,
      96,
      `Your rank: ${rank} of ${COLISEUM_LADDER_SIZE} — challenge teams up to ${COLISEUM_RANK_REACH} ranks above you`,
      { fontSize: '16px', color: '#f2d98c', wordWrap: { width: this.w - 40 } },
    );

    const compact = this.compact;
    const floor = rank - COLISEUM_RANK_REACH; // best rank you may fight
    for (let ladderRank = 1; ladderRank <= COLISEUM_LADDER_SIZE; ladderRank += 1) {
      this.teamRow(city, ladderRank, ladderRank >= floor, compact);
    }
  }

  /** One row of the 16-team ladder (1 = champion at the top, 16 = weakest). */
  private teamRow(city: City, ladderRank: number, fightable: boolean, compact: boolean): void {
    const level = coliseumOpponentLevel(city, ladderRank);
    const name = coliseumTeamName(city, ladderRank);
    const label = `${ladderRank}. ${name}`;

    if (compact) {
      const col = (ladderRank - 1) % 2;
      const row = Math.floor((ladderRank - 1) / 2);
      const x = this.cx - 92 + col * 184;
      const y = 142 + row * 60;
      addText(this, x, y - 16, `${label}${fightable ? `  (Lv ${level})` : ''}`, {
        fontSize: '13px',
        color: fightable ? undefined : '#6a6258',
      }).setOrigin(0.5);
      if (fightable) {
        this.button(x, y + 18, 'FIGHT', () => this.fight(ladderRank, level), {
          width: 120,
          height: 34,
          fontSize: 14,
        });
      } else {
        addText(this, x, y + 18, 'LOCKED', { fontSize: '13px', color: '#c0392b' }).setOrigin(0.5);
      }
      return;
    }

    const y = 132 + (ladderRank - 1) * 34;
    addText(this, this.cx - 310, y, label, {
      fontSize: '15px',
      color: fightable ? undefined : '#6a6258',
    }).setOrigin(0, 0.5);
    addText(this, this.cx, y, `Lv ${level}`, {
      fontSize: '13px',
      color: fightable ? '#b8aa94' : '#6a6258',
    });
    if (fightable) {
      this.button(this.cx + 270, y, 'FIGHT', () => this.fight(ladderRank, level), {
        width: 110,
        height: 30,
        fontSize: 15,
      });
    } else {
      addText(this, this.cx + 270, y, 'LOCKED', { fontSize: '14px', color: '#c0392b' }).setOrigin(0.5);
    }
  }

  private fight(ladderRank: number, level: number): void {
    this.scene.start('Battle', { enemyRank: level, cityId: this.cityId, ladderRank });
  }
}
