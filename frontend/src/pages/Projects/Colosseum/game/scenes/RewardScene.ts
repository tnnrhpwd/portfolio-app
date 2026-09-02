import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import {
  addXp,
  advanceColiseumRank,
  postBattleRewards,
  recomputeDerived,
  victoryRewards,
  type MetalId,
  type Verdict,
} from '../core';

export class RewardScene extends BaseScene {
  private enemyLevel = 1;
  private cityId = '';
  private ladderRank = 0;

  constructor() {
    super('Reward');
  }

  create(data: { enemyLevel?: number; cityId?: string; ladderRank?: number }): void {
    this.enemyLevel = data?.enemyLevel ?? 1;
    this.cityId = data?.cityId ?? '';
    this.ladderRank = data?.ladderRank ?? 0;
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const base = victoryRewards(this.enemyLevel);

    this.header('VICTORY!');
    addText(this, this.cx, 150, `Base reward: ${base.gold} gp · ${base.xp} xp`, { fontSize: '20px' });
    addText(this, this.cx, 190, 'The crowd awaits your verdict:', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.button(this.cx, 260, 'MERCY  (+50% xp, +MP growth)', () => this.apply('mercy', this.enemyLevel));
    this.button(this.cx, 330, 'EXECUTE  (+60% gold)', () => this.apply('execute', this.enemyLevel));
  }

  private apply(verdict: Verdict, enemyLevel: number): void {
    const rewards = postBattleRewards(enemyLevel, verdict);
    let fighter = this.gameState.roster[0];
    const newMaxMorale = fighter.maxMorale + rewards.maxMoraleGain;
    fighter = { ...fighter, maxMorale: newMaxMorale, morale: newMaxMorale };
    fighter = recomputeDerived(addXp(fighter, rewards.xp));
    const metals = { ...this.gameState.metals };
    for (const [key, value] of Object.entries(rewards.metals)) {
      metals[key as MetalId] = (metals[key as MetalId] ?? 0) + (value ?? 0);
    }
    this.gameState = {
      ...this.gameState,
      roster: [fighter, ...this.gameState.roster.slice(1)],
      gold: this.gameState.gold + rewards.gold,
      metals,
      fame: this.gameState.fame + 1,
    };
    if (this.cityId && this.ladderRank > 0) {
      this.gameState = advanceColiseumRank(this.gameState, this.cityId, this.ladderRank);
    }
    this.applyAchievements();
    this.scene.start('Main');
  }
}
