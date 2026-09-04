import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { addLayeredFighter, humanVariantFor } from '../assets/textures';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_TEAM_NAME,
  GENDER_CHARISMA_BONUS,
  GENDER_STRENGTH_BONUS,
  HAIR_COLORS,
  HAIR_STYLES,
  ROBE_OPTIONS,
  SKIN_TONES,
  applyGenderBonus,
  type Appearance,
  type Fighter,
  type Gender,
} from '../core';
import { announce } from '../accessibility';

const SKIN_LABELS = ['Light', 'Tan', 'Brown', 'Dark'] as const;
const HAIR_STYLE_LABELS = ['Short', 'Long', 'Tied', 'Curly', 'Bald'] as const;
const HAIR_COLOR_LABELS = ['Dark', 'Auburn', 'Blond', 'Brown', 'Black'] as const;
const ROBE_LABELS = ['Crimson', 'Blue', 'Green', 'Purple', 'Gold', 'Rust', 'Teal', 'Leather'] as const;

type Step = 'gender' | 'customize';

/** First-run character creation: gender (stat bonus) then appearance + names. */
export class CreationScene extends BaseScene {
  private step: Step = 'gender';
  private customizeOnly = false;
  private fighterIndex = 0;
  private gender: Gender = 'male';
  private appearance: Appearance = { ...DEFAULT_APPEARANCE };
  private fighterName = 'Recruit';
  private teamName = DEFAULT_TEAM_NAME;

  constructor() {
    super('Creation');
  }

  create(data: { customize?: boolean; fighterIndex?: number } = {}): void {
    this.customizeOnly = !!data.customize;
    const index = Math.max(0, Math.min(data.fighterIndex ?? 0, this.gameState.roster.length - 1));
    this.loadFighter(index);
    this.teamName = this.gameState.teamName ?? DEFAULT_TEAM_NAME;
    this.step = this.customizeOnly ? 'customize' : 'gender';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private loadFighter(index: number): void {
    this.fighterIndex = index;
    const fighter = this.gameState.roster[index];
    this.gender = fighter?.gender ?? 'male';
    this.appearance = fighter?.appearance
      ? { ...fighter.appearance }
      : { ...humanVariantFor(fighter ?? { id: 'preview' }) };
    this.fighterName = fighter?.name ?? 'Recruit';
  }

  /** Persists the current look + name back onto the selected fighter. */
  private commitEditing(): void {
    const roster = [...this.gameState.roster];
    const fighter = roster[this.fighterIndex];
    if (!fighter) return;
    roster[this.fighterIndex] = {
      ...fighter,
      name: this.fighterName.trim() || fighter.name,
      appearance: { ...this.appearance },
    };
    this.gameState = { ...this.gameState, roster };
  }

  private cycleFighter(dir: number): void {
    const n = this.gameState.roster.length;
    if (n <= 1) return;
    this.commitEditing();
    this.loadFighter((this.fighterIndex + dir + n) % n);
    this.render();
  }

  private previewFighter(): { id: string; gender: Gender; appearance: Appearance | null; loadout: Fighter['loadout'] } {
    const fighter = this.gameState.roster[this.fighterIndex];
    return {
      id: fighter?.id ?? 'creation-preview',
      gender: this.gender,
      appearance: this.appearance,
      loadout: fighter?.loadout ?? ({} as Fighter['loadout']),
    };
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header(this.step === 'gender' ? 'CHOOSE YOUR GLADIATOR' : 'CUSTOMIZE');

    if (this.step === 'gender') this.renderGender();
    else this.renderCustomize();
  }

  // ── Step 1: gender select ──
  private renderGender(): void {
    const compact = this.compact;
    this.renderPreview(compact ? this.cx : this.w * 0.32, compact ? 210 : this.h * 0.38, compact ? 0.95 : 1.3);

    const x = compact ? this.cx : this.w * 0.66;
    const y0 = compact ? 330 : 240;
    const gap = compact ? 66 : 86;
    addText(this, x, compact ? y0 - 40 : 170, 'MALES START WITH MORE STRENGTH.', {
      fontSize: compact ? '14px' : '16px',
      color: '#b8aa94',
      wordWrap: { width: compact ? 300 : 320 },
    });
    const male = this.button(x, y0, this.gender === 'male' ? '\u2713 MALE (+STR)' : 'MALE (+STR)', () => {
      this.gender = 'male';
      announce(`Male. +${GENDER_STRENGTH_BONUS} Strength.`);
      this.render();
    }, { width: compact ? 260 : 300, height: 54, fontSize: 18, fill: this.gender === 'male' ? 0xa52a34 : 0x8c1f28 });
    void male;

    addText(this, x, y0 + gap - 34, 'FEMALES START WITH MORE CHARISMA.', {
      fontSize: compact ? '14px' : '16px',
      color: '#b8aa94',
      wordWrap: { width: compact ? 300 : 320 },
    });
    this.button(x, y0 + gap, this.gender === 'female' ? '\u2713 FEMALE (+CHA)' : 'FEMALE (+CHA)', () => {
      this.gender = 'female';
      announce(`Female. +${GENDER_CHARISMA_BONUS} Charisma.`);
      this.render();
    }, { width: compact ? 260 : 300, height: 54, fontSize: 18, fill: this.gender === 'female' ? 0xa52a34 : 0x8c1f28 });

    this.button(this.w - 110, this.h - 56, 'DONE', () => {
      this.step = 'customize';
      this.render();
    }, { width: 150, height: 52, fontSize: 18 });
  }

  // ── Step 2: appearance + names ──
  private renderCustomize(): void {
    const compact = this.compact;
    const px = compact ? this.cx : this.w * 0.26;
    const py = compact ? 230 : this.h * 0.44;
    this.renderPreview(px, py, compact ? 0.8 : 1.3);

    if (this.gameState.roster.length > 1) {
      const arrowX = compact ? 90 : 130;
      this.button(px - arrowX, py, '\u25C0', () => this.cycleFighter(-1), { width: 46, height: 46, fontSize: 20 });
      this.button(px + arrowX, py, '\u25B6', () => this.cycleFighter(1), { width: 46, height: 46, fontSize: 20 });
      addText(this, px, py - (compact ? 110 : 150), `${this.fighterIndex + 1} / ${this.gameState.roster.length}`, {
        fontSize: '14px',
        color: '#b8aa94',
      });
    }

    const cx = compact ? this.cx : this.w * 0.66;
    const y0 = compact ? 380 : 150;
    const gap = compact ? 46 : 54;

    this.button(cx, y0, `TEAM: ${this.teamName}`, () => this.promptTeamName(), {
      width: compact ? 300 : 360,
      height: 44,
      fontSize: 15,
    });
    this.button(cx, y0 + gap, `NAME: ${this.fighterName}`, () => this.promptFighterName(), {
      width: compact ? 300 : 360,
      height: 44,
      fontSize: 15,
    });

    const rows: { label: string; value: string }[] = [
      { label: 'SKIN', value: SKIN_LABELS[SKIN_TONES.indexOf(this.appearance.skin)] },
      { label: 'HEAD', value: HAIR_STYLE_LABELS[HAIR_STYLES.indexOf(this.appearance.hairStyle)] },
      { label: 'HAIR', value: HAIR_COLOR_LABELS[HAIR_COLORS.indexOf(this.appearance.hairColor)] },
      {
        label: 'CLOTH',
        value: ROBE_LABELS[ROBE_OPTIONS.findIndex((r) => r.robe === this.appearance.robe)],
      },
    ];
    rows.forEach((row, i) => {
      const y = y0 + gap * 2 + i * gap;
      this.optionRow(cx, y, row.label, row.value, () => this.cycleOption(i, -1), () => this.cycleOption(i, 1));
    });

    this.button(cx, y0 + gap * 2 + rows.length * gap + 10, 'RANDOM', () => {
      this.randomize();
      this.render();
    }, { width: 150, height: 44, fontSize: 15 });

    if (compact) {
      this.button(this.cx - 90, this.h - 48, 'BACK', () => this.backFromCustomize(), { width: 140, height: 44, fontSize: 15 });
      this.button(this.cx + 90, this.h - 48, 'DONE', () => this.finish(), { width: 140, height: 44, fontSize: 15 });
    } else {
      this.button(this.w * 0.66 - 110, this.h - 56, 'BACK', () => this.backFromCustomize(), { width: 150, height: 52, fontSize: 18 });
      this.button(this.w * 0.66 + 110, this.h - 56, 'DONE', () => this.finish(), { width: 150, height: 52, fontSize: 18 });
    }
  }

  private backFromCustomize(): void {
    if (this.customizeOnly) {
      this.scene.start('Main');
      return;
    }
    this.step = 'gender';
    this.render();
  }

  private optionRow(
    x: number,
    y: number,
    label: string,
    value: string,
    onPrev: () => void,
    onNext: () => void,
  ): void {
    addText(this, x - 150, y, label, { fontSize: '16px', color: '#e8b84b', fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.button(x - 40, y, '\u25C0', onPrev, { width: 46, height: 40, fontSize: 16 });
    addText(this, x + 40, y, value, { fontSize: '17px', color: '#f2d98c', fontStyle: 'bold' }).setOrigin(0.5, 0.5);
    this.button(x + 120, y, '\u25B6', onNext, { width: 46, height: 40, fontSize: 16 });
  }

  /** Renders the live appearance preview (addLayeredFighter swaps textures in place). */
  private renderPreview(x: number, y: number, scale: number): void {
    addLayeredFighter(this, x, y, this.previewFighter(), scale);
  }

  private cycleOption(row: number, dir: 1 | -1): void {
    const clamp = (n: number, len: number): number => (n + dir + len) % len;
    if (row === 0) {
      this.appearance.skin = SKIN_TONES[clamp(SKIN_TONES.indexOf(this.appearance.skin), SKIN_TONES.length)];
    } else if (row === 1) {
      this.appearance.hairStyle = HAIR_STYLES[clamp(HAIR_STYLES.indexOf(this.appearance.hairStyle), HAIR_STYLES.length)];
    } else if (row === 2) {
      this.appearance.hairColor = HAIR_COLORS[clamp(HAIR_COLORS.indexOf(this.appearance.hairColor), HAIR_COLORS.length)];
    } else {
      const idx = ROBE_OPTIONS.findIndex((r) => r.robe === this.appearance.robe);
      const robe = ROBE_OPTIONS[clamp(idx, ROBE_OPTIONS.length)];
      this.appearance.robe = robe.robe;
      this.appearance.robeShade = robe.robeShade;
    }
    this.render();
  }

  private randomize(): void {
    this.appearance = {
      skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
      hairStyle: HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)],
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
      ...ROBE_OPTIONS[Math.floor(Math.random() * ROBE_OPTIONS.length)],
    };
  }

  private promptTeamName(): void {
    this.promptText('Team name', this.teamName, (value) => {
      if (value) this.teamName = value;
      this.render();
    });
  }

  private promptFighterName(): void {
    this.promptText('Gladiator name', this.fighterName, (value) => {
      if (value) this.fighterName = value;
      this.render();
    });
  }

  private finish(): void {
    if (this.customizeOnly) {
      this.commitEditing();
      this.gameState = { ...this.gameState, teamName: this.teamName.trim() || DEFAULT_TEAM_NAME };
      announce('Gladiator updated.');
      this.scene.start('Main');
      return;
    }
    const state = this.gameState;
    const roster = [...state.roster];
    const base = { ...roster[0] };
    base.name = this.fighterName.trim() || 'Recruit';
    base.gender = this.gender;
    base.appearance = { ...this.appearance };
    roster[0] = applyGenderBonus(base, this.gender);
    this.gameState = { ...state, roster, teamName: this.teamName.trim() || DEFAULT_TEAM_NAME, tutorialSeen: false };
    announce('Gladiator created. Beginning the tutorial.');
    this.scene.start('Tutorial');
  }
}
