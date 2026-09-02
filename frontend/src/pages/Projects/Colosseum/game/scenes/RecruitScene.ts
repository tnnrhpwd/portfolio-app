import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { generateRecruit, pick, recruitCost, STYLE_KEYS, type Fighter, type StyleKey } from '../core';

export class RecruitScene extends BaseScene {
  private cityId = '';

  constructor() {
    super('Recruit');
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.clearScreen();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('SLAVE MARKET');
    this.cityBack(data?.cityId ?? '');
    this.goldText();

    const { width } = this.scale;
    const tier = data?.tier ?? 0;
    const level = 1 + tier + Math.min(2, Math.floor(this.gameState.fame / 3));
    const style: StyleKey = pick(STYLE_KEYS, Math.random);
    const recruit = generateRecruit(level, Math.random, style);
    const cost = recruitCost(level);

    addText(this, width / 2, 130, recruit.name, {
      fontSize: '28px',
      color: '#f2d98c',
      fontStyle: 'bold',
    });
    addText(this, width / 2, 172, `${style.toUpperCase()} · Level ${recruit.level} · ${cost} gp`, { fontSize: '20px' });
    addText(
      this,
      width / 2,
      206,
      `STR ${recruit.attributes.strength} DEX ${recruit.attributes.dexterity} SPD ${recruit.attributes.speed}`,
      { fontSize: '16px', color: '#b8aa94' },
    );
    addText(
      this,
      width / 2,
      232,
      `DEF ${recruit.attributes.defense} VIT ${recruit.attributes.vitality} CHA ${recruit.attributes.charisma}`,
      { fontSize: '16px', color: '#b8aa94' },
    );

    const affordable = this.gameState.gold >= cost && this.gameState.roster.length < 12;
    const btn = this.button(width / 2, 300, 'RECRUIT', () =>
      this.confirm('Recruit gladiator?', `Hire ${recruit.name} for ${cost} gp?`, () =>
        this.recruit(recruit, cost),
      ),
    );
    if (!affordable) btn.setEnabled(false);

    addText(this, width / 2, 370, `Roster: ${this.gameState.roster.length}/12`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
  }

  private recruit(fighter: Fighter, cost: number): void {
    if (this.gameState.gold < cost) return;
    this.gameState = {
      ...this.gameState,
      gold: this.gameState.gold - cost,
      roster: [...this.gameState.roster, fighter],
    };
    this.applyAchievements();
    if (this.cityId) this.scene.start('City', { cityId: this.cityId });
    else this.scene.start('Main');
  }
}
