import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { getSettings, setSetting } from '../settings';
import { setMuted } from '../audio/sfx';

const TEXT_SIZES = [1, 1.2, 0.85] as const;
const TEXT_LABELS: Record<number, string> = { 1: 'Normal', 1.2: 'Large', 0.85: 'Small' };

export class SettingsScene extends BaseScene {
  constructor() {
    super('Settings');
  }

  create(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('SETTINGS');
    this.backButton('Main');

    const { width } = this.scale;
    const settings = getSettings();

    addText(this, width / 2, 115, 'These preferences apply instantly and are saved.', {
      fontSize: '16px',
      color: '#b8aa94',
    });

    this.row(180, 'Text size', TEXT_LABELS[settings.textScale] ?? 'Normal', () => this.cycleTextSize());
    this.row(260, 'High contrast', settings.highContrast ? 'ON' : 'OFF', () => this.toggle('highContrast'));
    this.row(340, 'Reduced motion', settings.reducedMotion ? 'ON' : 'OFF', () => this.toggle('reducedMotion'));
    this.row(420, 'Sound', settings.muted ? 'OFF' : 'ON', () => this.toggleSound());
  }

  private row(y: number, label: string, value: string, onToggle: () => void): void {
    const { width } = this.scale;
    addText(this, width / 2 - 220, y, label, { fontSize: '20px' }).setOrigin(0, 0.5);
    this.button(width / 2 + 200, y, value, onToggle, { width: 180, height: 48, fontSize: 18 });
  }

  private cycleTextSize(): void {
    const current = getSettings().textScale;
    const index = TEXT_SIZES.indexOf(current as (typeof TEXT_SIZES)[number]);
    const next = TEXT_SIZES[(index + 1) % TEXT_SIZES.length];
    setSetting('textScale', next);
    this.render();
  }

  private toggle(key: 'highContrast' | 'reducedMotion'): void {
    setSetting(key, !getSettings()[key]);
    this.render();
  }

  private toggleSound(): void {
    const muted = !getSettings().muted;
    setSetting('muted', muted);
    setMuted(muted);
    this.render();
  }
}
