import Phaser from 'phaser';
import { getThemeColors, VIEW_HEIGHT, VIEW_WIDTH } from './theme';
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
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: getThemeColors().bg,
    scale: {
      // FIT scales the whole fixed design box to the parent and CENTER_BOTH
      // letterboxes the remainder, which the page paints. Because the box never
      // changes while the game is alive, no scene needs a resize path: a scene
      // lays itself out once in `create()` and is done. Rotating the device
      // rebuilds the game in the other box (the React shell owns that).
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
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
