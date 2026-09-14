import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { generateRecruit, pick, recruitCost, STYLE_KEYS, type Fighter, type StyleKey } from '../core';

export class RecruitScene extends BaseScene {
  private cityId = '';
  private offered: Fighter | null = null;
  private cost = 0;

  constructor() {
    super('Recruit');
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.cityId = data?.cityId ?? '';
    const tier = data?.tier ?? 0;
    const level = 1 + tier + Math.min(2, Math.floor(this.gameState.fame / 3));
    const style: StyleKey = pick(STYLE_KEYS, Math.random);
    this.offered = generateRecruit(level, Math.random, style);
    this.cost = recruitCost(level);
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('RECRUIT');
    this.cityBack(this.cityId);
    this.goldText();

    const recruit = this.offered;
    if (!recruit) return;

    // One centred card. The tall box just spreads the same rows further apart,
    // which keeps the RECRUIT button within thumb reach on a phone.
    const portrait = this.portrait;
    const nameY = portrait ? 300 : 130;

    addText(this, this.cx, nameY, recruit.name, {
      fontSize: '28px',
      color: '#f2d98c',
      fontStyle: 'bold',
      wordWrap: { width: this.w - 60 },
      align: 'center',
    });
    addText(this, this.cx, nameY + (portrait ? 58 : 42), `Level ${recruit.level} · ${this.cost} gp`, {
      fontSize: '20px',
    });
    addText(
      this,
      this.cx,
      nameY + (portrait ? 118 : 76),
      `STR ${recruit.attributes.strength} DEX ${recruit.attributes.dexterity} SPD ${recruit.attributes.speed}`,
      { fontSize: '16px', color: '#b8aa94', wordWrap: { width: this.w - 60 }, align: 'center' },
    );
    addText(
      this,
      this.cx,
      nameY + (portrait ? 146 : 102),
      `DEF ${recruit.attributes.defense} VIT ${recruit.attributes.vitality} CHA ${recruit.attributes.charisma}`,
      { fontSize: '16px', color: '#b8aa94', wordWrap: { width: this.w - 60 }, align: 'center' },
    );

    const affordable = this.gameState.gold >= this.cost && this.gameState.roster.length < 12;
    const btn = this.button(this.cx, nameY + (portrait ? 250 : 170), 'RECRUIT', () =>
      this.confirm('Recruit gladiator?', `Hire ${recruit.name} for ${this.cost} gp?`, () =>
        this.recruit(recruit, this.cost),
      ),
      { width: portrait ? 360 : 260, height: portrait ? 68 : 56 },
    );
    if (!affordable) btn.setEnabled(false);

    addText(this, this.cx, nameY + (portrait ? 340 : 240), `Roster: ${this.gameState.roster.length}/12`, {
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
    this.scene.start('Main');
  }
}
