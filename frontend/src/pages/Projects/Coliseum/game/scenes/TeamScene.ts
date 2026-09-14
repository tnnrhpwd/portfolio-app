import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { addLayeredFighter } from '../assets/textures';
import { currentHp, MAX_ROSTER, totalHp, type Fighter } from '../core';

/**
 * The school roster: field a 3-man team on the left, manage the full school
 * on the right, and rename the school or any gladiator. The first three
 * roster slots are the fighters who enter the arena (Battle uses
 * `roster.slice(0, 3)`), so swapping is simply reordering the roster.
 */
export class TeamScene extends BaseScene {
  constructor() {
    super('Team');
  }

  create(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('TEAM');

    if (this.portrait) {
      this.renderPortrait();
      return;
    }

    const leftX = this.w * 0.3;
    const rightX = this.w * 0.72;
    this.renderTeamColumn(leftX);
    this.renderSchoolPanel(rightX);
  }

  // ── Left column: team name + the three active team slots ──
  private renderTeamColumn(x: number): void {
    addText(this, x, 76, this.gameState.teamName.toUpperCase(), {
      fontSize: '24px',
      color: '#e8b84b',
      fontStyle: 'bold',
      wordWrap: { width: 340 },
    });
    this.button(x, 116, 'RENAME TEAM', () => this.renameTeam(), { width: 160, height: 36, fontSize: 13 });

    for (let i = 0; i < 3; i += 1) {
      const fighter = this.gameState.roster[i] ?? null;
      const y = 250 + i * 160;
      this.renderSlot(fighter, i, x, y);
    }
  }

  private renderSlot(f: Fighter | null, i: number, x: number, y: number): void {
    const has = !!f;
    this.add.rectangle(x, y, 420, 140, 0x1c1610, 1).setStrokeStyle(2, has ? 0xe8b84b : 0x6a6258);
    if (!f) {
      addText(this, x, y, '— empty —', { fontSize: '14px', color: '#6a6258' });
      return;
    }

    addLayeredFighter(this, x - 150, y, f, 0.62);
    addText(this, x - 92, y - 42, f.name.toUpperCase(), { fontSize: '15px', color: '#f2d98c', fontStyle: 'bold' }).setOrigin(0, 0.5);
    addText(this, x - 92, y - 20, `Lv ${f.level}`, { fontSize: '12px' }).setOrigin(0, 0.5);
    addText(this, x - 92, y + 0, `HP ${currentHp(f)}/${totalHp(f)} · MP ${f.morale}/${f.maxMorale}`, {
      fontSize: '12px',
      color: '#b8aa94',
    }).setOrigin(0, 0.5);

    this.button(x + 100, y - 28, '◀', () => this.cycleSlot(i, -1), { width: 40, height: 40, fontSize: 20 });
    this.button(x + 150, y - 28, '▶', () => this.cycleSlot(i, 1), { width: 40, height: 40, fontSize: 20 });
    this.button(x - 40, y + 34, 'CUSTOMIZE', () => this.customizeFighter(i), { width: 90, height: 30, fontSize: 10 });
    this.button(x + 100, y + 34, `ROW ${f.row.toUpperCase()}`, () => this.toggleRow(i), { width: 72, height: 30, fontSize: 11 });
    this.button(x + 178, y + 34, f.auto ? 'AUTO' : 'MANUAL', () => this.toggleAuto(i), { width: 68, height: 30, fontSize: 11 });
  }

  // ── Right column: the full school grid + gold / BACK ──
  private renderSchoolPanel(x: number): void {
    addText(this, x, 76, 'SCHOOL', { fontSize: '22px', color: '#e8b84b', fontStyle: 'bold' });
    addText(this, x, 102, `${this.gameState.roster.length}/${MAX_ROSTER} fighters`, { fontSize: '13px', color: '#b8aa94' });

    const cell = 96;
    const gap = 10;
    const cols = 4;
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = x - gridW / 2 + cell / 2;
    const y0 = 150;
    const activeCount = Math.min(3, this.gameState.roster.length);

    for (let i = 0; i < MAX_ROSTER; i += 1) {
      const fighter = this.gameState.roster[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.renderSchoolCell(fighter, i, i >= activeCount, x0 + col * (cell + gap), y0 + row * (cell + gap), cell);
    }

    addText(this, x, y0 + 3 * (cell + gap) + 18, `Gold: ${this.gameState.gold}`, { fontSize: '18px', color: '#f2d98c' });
    this.button(x, this.h - 44, 'BACK', () => this.scene.start('Main'), { width: 120, height: 44, fontSize: 16 });
  }

  private renderSchoolCell(f: Fighter | null, index: number, isBench: boolean, x: number, y: number, size: number): void {
    const filled = !!f;
    const stroke = f && !isBench ? 0xf2d98c : filled ? 0xe8b84b : 0x6a6258;
    this.add.rectangle(x, y, size, size, filled ? 0x2a241d : 0x1c1610).setStrokeStyle(2, stroke);
    if (!f) return;

    addLayeredFighter(this, x, y - 14, f, 0.4).setAlpha(0.9);
    addText(this, x, y + 22, f.name, { fontSize: '10px', color: !isBench ? '#f2d98c' : '#e8dcc8' });

    if (!isBench) {
      addText(this, x, y + 36, 'ACTIVE', { fontSize: '8px', color: '#6a6258' });
    } else {
      const zone = this.add.rectangle(x, y + 36, size - 8, 16, 0x8c1f28).setStrokeStyle(1, 0xe8b84b).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.promoteToTeam(index));
      addText(this, x, y + 36, 'PUT IN TEAM', { fontSize: '8px', color: '#f2d98c' });
    }
  }

  // ── Portrait: the three arena slots stack down the screen, then the full
  // school becomes a 3-column grid (4 columns of 96px needed a 340px gutter). ──
  private renderPortrait(): void {
    const x = this.cx;
    this.backButton('Main');
    addText(this, x, 96, this.gameState.teamName.toUpperCase(), {
      fontSize: '22px',
      color: '#e8b84b',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: this.w - 80 },
    });
    this.button(x, 148, 'RENAME TEAM', () => this.renameTeam(), { width: 200, height: 44, fontSize: 14 });

    const slotTop = 250;
    const slotStep = 150;
    for (let i = 0; i < 3; i += 1) {
      this.renderSlot(this.gameState.roster[i] ?? null, i, x, slotTop + i * slotStep);
    }

    addText(this, x, 690, 'SCHOOL', { fontSize: '20px', color: '#e8b84b', fontStyle: 'bold' });
    addText(this, x, 716, `${this.gameState.roster.length}/${MAX_ROSTER} fighters`, {
      fontSize: '13px',
      color: '#b8aa94',
    });

    const cell = 110;
    const gap = 12;
    const cols = 3;
    const activeCount = Math.min(3, this.gameState.roster.length);
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = x - gridW / 2 + cell / 2;
    const y0 = 760;
    for (let i = 0; i < MAX_ROSTER; i += 1) {
      const fighter = this.gameState.roster[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.renderSchoolCell(fighter, i, i >= activeCount, x0 + col * (cell + gap), y0 + row * (cell + gap), cell);
    }

    addText(this, x, 1216, `Gold: ${this.gameState.gold}`, { fontSize: '18px', color: '#f2d98c' });
  }

  // ── Actions ──
  private cycleSlot(slot: number, delta: number): void {
    const roster = [...this.gameState.roster];
    const n = roster.length;
    if (n <= 1) return;
    if (delta > 0) {
      const [moved] = roster.splice(slot, 1);
      roster.push(moved);
    } else {
      roster.splice(slot, 0, roster.pop() as Fighter);
    }
    this.gameState = { ...this.gameState, roster };
    this.render();
  }

  /** Moves a bench fighter into the lead slot (swaps with roster[0]). */
  private promoteToTeam(index: number): void {
    const roster = [...this.gameState.roster];
    if (index <= 0 || index >= roster.length) return;
    [roster[0], roster[index]] = [roster[index], roster[0]];
    this.gameState = { ...this.gameState, roster };
    this.render();
  }

  private toggleRow(slot: number): void {
    const roster = [...this.gameState.roster];
    const f = roster[slot];
    if (!f) return;
    roster[slot] = { ...f, row: f.row === 'front' ? 'back' : 'front' };
    this.gameState = { ...this.gameState, roster };
    this.render();
  }

  private toggleAuto(slot: number): void {
    const roster = [...this.gameState.roster];
    const f = roster[slot];
    if (!f) return;
    roster[slot] = { ...f, auto: !f.auto };
    this.gameState = { ...this.gameState, roster };
    this.render();
  }

  private renameTeam(): void {
    this.promptText('Rename your school', this.gameState.teamName, (value) => {
      if (value) {
        this.gameState = { ...this.gameState, teamName: value };
        this.render();
      }
    });
  }

  /** Opens the customize screen on the given fighter (looks + name). */
  private customizeFighter(index: number): void {
    this.scene.start('Creation', { customize: true, fighterIndex: index });
  }
}
