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

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('SETTINGS');
    this.backButton('Main');

    const settings = getSettings();
    const portrait = this.portrait;
    // Each row is a label with its control beneath it in the tall box, and a
    // label with the control beside it in the wide one. The tall box has room
    // for generous spacing, which also gives every tap target extra clearance.
    const gap = portrait ? 152 : 80;
    const top = portrait ? 240 : 180;

    addText(this, this.cx, portrait ? 160 : 115, 'These preferences apply instantly and are saved.', {
      fontSize: '16px',
      color: '#b8aa94',
      wordWrap: { width: this.w - 60 },
      align: 'center',
    });

    this.row(top, 'Text size', TEXT_LABELS[settings.textScale] ?? 'Normal', () => this.cycleTextSize());
    this.row(top + gap, 'High contrast', settings.highContrast ? 'ON' : 'OFF', () => this.toggle('highContrast'));
    this.row(top + gap * 2, 'Reduced motion', settings.reducedMotion ? 'ON' : 'OFF', () => this.toggle('reducedMotion'));
    this.row(top + gap * 3, 'Sound', settings.muted ? 'OFF' : 'ON', () => this.toggleSound());
    this.row(top + gap * 4, 'Theme', THEME_LABELS[settings.theme], () => this.cycleTheme());
    // ── TEMPORARY DEBUG (remove later) ──
    this.row(top + gap * 5, 'Debug gold', '+1000 GOLD', () => this.addDebugGold());
  }

  private row(y: number, label: string, value: string, onToggle: () => void): void {
    const portrait = this.portrait;
    addText(this, portrait ? this.cx : this.cx - 220, portrait ? y - 26 : y, label, {
      fontSize: portrait ? '22px' : '20px',
    }).setOrigin(portrait ? 0.5 : 0, 0.5);
    this.button(portrait ? this.cx : this.cx + 200, portrait ? y + 28 : y, value, onToggle, {
      width: portrait ? 240 : 180,
      height: portrait ? 56 : 48,
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

  /** TEMPORARY DEBUG: grant 1000 gold (remove later). */
  private addDebugGold(): void {
    this.gameState = { ...this.gameState, gold: this.gameState.gold + 1000 };
    this.render();
  }
}
