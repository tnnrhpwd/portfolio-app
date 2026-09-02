import Phaser from 'phaser';
import type { GameState } from '../core';
import { getState, setState } from '../state/store';
import { addText, createButton, type ButtonOpts, type GameButton } from '../ui/button';

/** Shared helpers for the menu scenes. */
export abstract class BaseScene extends Phaser.Scene {
  protected get gameState(): GameState {
    return getState();
  }

  protected set gameState(next: GameState) {
    setState(next);
  }

  protected header(text: string): void {
    const { width } = this.scale;
    addText(this, width / 2, 40, text, {
      fontSize: '36px',
      color: '#e8b84b',
      fontStyle: 'bold',
    });
  }

  protected goldText(): void {
    const { width } = this.scale;
    addText(this, width - 24, 40, `Gold: ${this.gameState.gold}`, {
      fontSize: '22px',
      color: '#f2d98c',
    }).setOrigin(1, 0.5);
  }

  protected button(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts?: ButtonOpts,
  ): GameButton {
    return createButton(this, x, y, label, onClick, opts);
  }

  protected backButton(sceneKey: string): GameButton {
    return this.button(96, 40, 'BACK', () => this.scene.start(sceneKey), {
      width: 120,
      height: 44,
      fontSize: 18,
    });
  }

  /** Returns to the owning city (or the hub when launched directly). */
  protected cityBack(cityId: string): GameButton {
    return this.button(96, 40, 'BACK', () => {
      if (cityId) this.scene.start('City', { cityId });
      else this.scene.start('Main');
    }, { width: 120, height: 44, fontSize: 18 });
  }
}
