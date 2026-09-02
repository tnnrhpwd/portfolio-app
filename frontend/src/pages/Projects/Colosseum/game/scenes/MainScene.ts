import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { isLoggedIn } from '../state/cloudSync';
import { createCampaignStart, currentHp, totalHp } from '../core';

export class MainScene extends BaseScene {
  constructor() {
    super('Main');
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
    this.header('COLOSSEUM');
    this.goldText();

    const fighter = this.gameState.roster[0];
    addText(this, this.w - 24, 70, `Fame: ${this.gameState.fame}`, {
      fontSize: '18px',
      color: '#b8aa94',
    }).setOrigin(1, 0.5);

    addText(this, this.cx, 130, fighter.name, {
      fontSize: '28px',
      color: '#f2d98c',
      fontStyle: 'bold',
    });
    addText(this, this.cx, 168, `Level ${fighter.level} · ${fighter.style.toUpperCase()}`, {
      fontSize: '18px',
      color: '#b8aa94',
    });
    addText(
      this,
      this.cx,
      202,
      `HP ${currentHp(fighter)}/${totalHp(fighter)}    MP ${fighter.morale}/${fighter.maxMorale}`,
      { fontSize: '18px' },
    );
    addText(
      this,
      this.cx,
      232,
      `STR ${fighter.attributes.strength}  DEX ${fighter.attributes.dexterity}  SPD ${fighter.attributes.speed}  DEF ${fighter.attributes.defense}  VIT ${fighter.attributes.vitality}  CHA ${fighter.attributes.charisma}`,
      { fontSize: '16px', color: '#b8aa94', wordWrap: { width: this.w - 60 } },
    );
    addText(
      this,
      this.cx,
      262,
      `Unspent: ${fighter.attributePoints} attribute pts · ${fighter.skillPoints} skill pts`,
      { fontSize: '16px' },
    );

    this.button(this.cx, 340, 'TRAIN', () => this.scene.start('Train'));
    this.button(this.cx, 410, 'SKILL', () => this.scene.start('Skill'));
    this.button(this.cx, 480, 'WORLD MAP', () => this.scene.start('WorldMap'));
    this.button(this.cx, 550, 'FIGHT', () => this.scene.start('Battle'));

    // Utility row: side-by-side when wide, stacked + bottom-anchored when narrow.
    const compact = this.compact;
    const utilX = compact ? [this.cx, this.cx, this.cx] : [this.cx - 180, this.cx, this.cx + 180];
    const utilY = compact ? [this.h - 134, this.h - 82, this.h - 30] : [640, 640, 640];
    this.button(utilX[0], utilY[0], 'TROPHIES', () => this.scene.start('Achievements'), {
      width: 160,
      height: 48,
      fontSize: 16,
    });
    this.button(utilX[1], utilY[1], 'SETTINGS', () => this.scene.start('Settings'), {
      width: 160,
      height: 48,
      fontSize: 16,
    });
    this.button(
      utilX[2],
      utilY[2],
      'RESET SAVE',
      () =>
        this.confirm(
          'Reset save?',
          'This wipes your school and starts a new game.',
          () => {
            this.gameState = createCampaignStart();
            this.scene.start('Tutorial');
          },
        ),
      { width: 160, height: 48, fontSize: 16 },
    );

    if (!compact) {
      addText(
        this,
        this.cx,
        this.h - 24,
        isLoggedIn()
          ? 'Cloud save on — progress syncs automatically.'
          : 'Log in to save your progress across devices.',
        { fontSize: '14px', color: '#6a6258' },
      );
    }
  }
}
