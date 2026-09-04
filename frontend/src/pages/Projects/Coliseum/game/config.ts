import Phaser from 'phaser';
import { getThemeColors } from './theme';
import { BootScene } from './scenes/BootScene';
import { CreationScene } from './scenes/CreationScene';
import { TutorialScene } from './scenes/TutorialScene';
import { MainScene } from './scenes/MainScene';
import { TrainScene } from './scenes/TrainScene';
import { InventoryScene } from './scenes/InventoryScene';
import { TeamScene } from './scenes/TeamScene';
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
import { SettingsScene } from './scenes/SettingsScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: getThemeColors().bg,
    scale: {
      // RESIZE makes the canvas fill its container exactly, so the game's
      // aspect ratio follows the device (portrait, landscape, tablet, …) with
      // no letterboxing. Scenes lay out from `scale.width`/`scale.height`.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [
      BootScene,
      CreationScene,
      TutorialScene,
      MainScene,
      TrainScene,
      InventoryScene,
      TeamScene,
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
      SettingsScene,
    ],
    title: 'Coliseum',
  };
}
