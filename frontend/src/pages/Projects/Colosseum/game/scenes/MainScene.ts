import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { createCampaignStart, currentHp, totalHp } from '../core';

export class MainScene extends BaseScene {
  constructor() {
    super('Main');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('COLOSSEUM');
    this.goldText();

    const { width } = this.scale;
    const fighter = this.gameState.roster[0];
    addText(this, width - 24, 70, `Fame: ${this.gameState.fame}`, {
      fontSize: '18px',
      color: '#b8aa94',
    }).setOrigin(1, 0.5);

    addText(this, width / 2, 130, fighter.name, {
      fontSize: '28px',
      color: '#f2d98c',
      fontStyle: 'bold',
    });
    addText(this, width / 2, 168, `Level ${fighter.level} · ${fighter.style.toUpperCase()}`, {
      fontSize: '18px',
      color: '#b8aa94',
    });
    addText(
      this,
      width / 2,
      202,
      `HP ${currentHp(fighter)}/${totalHp(fighter)}    MP ${fighter.morale}/${fighter.maxMorale}`,
      { fontSize: '18px' },
    );
    addText(
      this,
      width / 2,
      232,
      `STR ${fighter.attributes.strength}  DEX ${fighter.attributes.dexterity}  SPD ${fighter.attributes.speed}  DEF ${fighter.attributes.defense}  VIT ${fighter.attributes.vitality}  CHA ${fighter.attributes.charisma}`,
      { fontSize: '16px', color: '#b8aa94' },
    );
    addText(
      this,
      width / 2,
      262,
      `Unspent: ${fighter.attributePoints} attribute pts · ${fighter.skillPoints} skill pts`,
      { fontSize: '16px' },
    );

    const cx = width / 2;
    this.button(cx, 340, 'TRAIN', () => this.scene.start('Train'));
    this.button(cx, 410, 'SKILL', () => this.scene.start('Skill'));
    this.button(cx, 480, 'WORLD MAP', () => this.scene.start('WorldMap'));
    this.button(cx, 550, 'FIGHT', () => this.scene.start('Battle'));
    this.button(cx - 180, 640, 'TROPHIES', () => this.scene.start('Achievements'), {
      width: 160,
      height: 48,
      fontSize: 16,
    });
    this.button(cx, 640, 'SETTINGS', () => this.scene.start('Settings'), {
      width: 160,
      height: 48,
      fontSize: 16,
    });
    this.button(
      cx + 180,
      640,
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
  }
}
