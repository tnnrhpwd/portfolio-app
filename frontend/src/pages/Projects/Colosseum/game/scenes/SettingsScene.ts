import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { getSettings, setSetting, type ThemeMode } from '../settings';
import { setMuted } from '../audio/sfx';

const TEXT_SIZES = [1, 1.2, 0.85] as const;
const TEXT_LABELS: Record<number, string> = { 1: 'Normal', 1.2: 'Large', 0.85: 'Small' };
const THEME_ORDER: readonly ThemeMode[] = ['dark', 'light', 'system'];
const THEME_LABELS: Record<ThemeMode, string> = { dark: 'Dark', light: 'Light', system: 'System' };

export class SettingsScene extends BaseScene {
  constructor() {
    super('Settings');
  }

  create(): void {
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.header('SETTINGS');
    this.backButton('Main');

    const settings = getSettings();
    const gap = this.compact ? 96 : 80;

    addText(this, this.cx, 115, 'These preferences apply instantly and are saved.', {
      fontSize: '16px',
      color: '#b8aa94',
    });

    this.row(180, 'Text size', TEXT_LABELS[settings.textScale] ?? 'Normal', () => this.cycleTextSize());
    this.row(180 + gap, 'High contrast', settings.highContrast ? 'ON' : 'OFF', () => this.toggle('highContrast'));
    this.row(180 + gap * 2, 'Reduced motion', settings.reducedMotion ? 'ON' : 'OFF', () => this.toggle('reducedMotion'));
    this.row(180 + gap * 3, 'Sound', settings.muted ? 'OFF' : 'ON', () => this.toggleSound());
    this.row(180 + gap * 4, 'Theme', THEME_LABELS[settings.theme], () => this.cycleTheme());
  }

  private row(y: number, label: string, value: string, onToggle: () => void): void {
    const compact = this.compact;
    addText(this, compact ? this.cx : this.cx - 220, compact ? y - 24 : y, label, { fontSize: '20px' }).setOrigin(
      compact ? 0.5 : 0,
      0.5,
    );
    this.button(compact ? this.cx : this.cx + 200, compact ? y + 24 : y, value, onToggle, {
      width: 180,
      height: 48,
      fontSize: 18,
    });
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

  private cycleTheme(): void {
    const current = getSettings().theme;
    const index = THEME_ORDER.indexOf(current);
    const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
    setSetting('theme', next);
    this.render();
  }
}
