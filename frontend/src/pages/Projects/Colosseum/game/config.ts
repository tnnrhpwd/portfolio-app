import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TutorialScene } from './scenes/TutorialScene';
import { MainScene } from './scenes/MainScene';
import { TrainScene } from './scenes/TrainScene';
import { SkillScene } from './scenes/SkillScene';
import { WorldMapScene } from './scenes/WorldMapScene';
import { CityScene } from './scenes/CityScene';
import { ColiseumScene } from './scenes/ColiseumScene';
import { ShopScene } from './scenes/ShopScene';
import { RecruitScene } from './scenes/RecruitScene';
import { BlacksmithScene } from './scenes/BlacksmithScene';
import { InfirmaryScene } from './scenes/InfirmaryScene';
import { BattleScene } from './scenes/BattleScene';
import { RewardScene } from './scenes/RewardScene';
import { AchievementsScene } from './scenes/AchievementsScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0c0a08',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [
      BootScene,
      TutorialScene,
      MainScene,
      TrainScene,
      SkillScene,
      WorldMapScene,
      CityScene,
      ColiseumScene,
      ShopScene,
      RecruitScene,
      BlacksmithScene,
      InfirmaryScene,
      BattleScene,
      RewardScene,
      AchievementsScene,
    ],
    title: 'Colosseum',
  };
}
