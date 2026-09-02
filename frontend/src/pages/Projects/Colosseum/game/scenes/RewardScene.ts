import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { addXp, postBattleRewards, recomputeDerived, victoryRewards, type MetalId, type Verdict } from '../core';

export class RewardScene extends BaseScene {
  constructor() {
    super('Reward');
  }

  create(data: { enemyLevel?: number }): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    const { width } = this.scale;
    const enemyLevel = data?.enemyLevel ?? 1;
    const base = victoryRewards(enemyLevel);

    this.header('VICTORY!');
    addText(this, width / 2, 150, `Base reward: ${base.gold} gp · ${base.xp} xp`, { fontSize: '20px' });
    addText(this, width / 2, 190, 'The crowd awaits your verdict:', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.button(width / 2, 260, 'MERCY  (+50% xp, +MP growth)', () => this.apply('mercy', enemyLevel));
    this.button(width / 2, 330, 'EXECUTE  (+60% gold)', () => this.apply('execute', enemyLevel));
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
    this.applyAchievements();
    this.scene.start('Main');
  }
}
