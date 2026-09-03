import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { setFighters } from '../state/store';
import {
  autoTeamActions,
  BODY_ZONES,
  canMeleeAttack,
  crowdWish,
  currentHp,
  effectiveAttributes,
  generateOpponentTeam,
  getSkill,
  isDefeated,
  isZoneDestroyed,
  precisionHitChance,
  sortTurnOrder,
  stabilize,
  startBattle,
  stepBattle,
  totalHp,
  weakestZone,
  type Action,
  type AttackPrecision,
  type BattleSnapshot,
  type BodyZone,
  type Fighter,
} from '../core';
import { playBlock, playClick, playCrit, playDefeat, playHit, playVictory } from '../audio/sfx';
import { addArenaBackground, addLayeredFighter } from '../assets/textures';
import { getSettings } from '../settings';
import { announce } from '../accessibility';

const ZONE_LABELS: Record<BodyZone, string> = {
  head: 'HEAD',
  torso: 'TORSO',
  leftArm: 'L ARM',
  rightArm: 'R ARM',
  leftLeg: 'L LEG',
  rightLeg: 'R LEG',
};

type Phase = 'action' | 'precision' | 'target' | 'zone' | 'skill';

export class BattleScene extends BaseScene {
  private snap!: BattleSnapshot;
  private actions: Record<string, Action> = {};
  private queue: Fighter[] = [];
  private currentId = '';
  private phase: Phase = 'action';
  private precision: AttackPrecision = 'medium';
  private targetEnemyId = '';
  private summary = '';
  private enemyRank = 1;
  private cityId = '';
  private ladderRank = 0;
  private speedFast = false;
  private tooltip: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Battle');
  }

  create(data: { enemyRank?: number; cityId?: string; ladderRank?: number } = {}): void {
    this.enemyRank = data?.enemyRank ?? this.gameState.fame + 1;
    this.cityId = data?.cityId ?? '';
    this.ladderRank = data?.ladderRank ?? 0;
    this.speedFast = false;

    const playerTeam = this.gameState.roster.slice(0, 3);
    const enemyTeam = generateOpponentTeam(this.enemyRank, Math.random);
    this.snap = startBattle(playerTeam, enemyTeam);
    this.summary = 'Your turn — pick an action.';
    this.beginRound();
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  // ── Round / command plumbing ──
  private livingPlayers(): Fighter[] {
    return this.snap.playerTeam.filter((f) => f.alive && !isDefeated(f));
  }

  private livingEnemies(): Fighter[] {
    return this.snap.enemyTeam.filter((f) => f.alive && !isDefeated(f));
  }

  /** Enemies that can be hit by a melee attack (front row, or everyone if none). */
  private meleeTargets(): Fighter[] {
    const living = this.livingEnemies();
    const front = living.filter((f) => f.row === 'front');
    return front.length > 0 ? front : living;
  }

  private currentFighter(): Fighter | undefined {
    return this.snap.playerTeam.find((f) => f.id === this.currentId);
  }

  private beginRound(): void {
    this.actions = {};
    this.queue = [...sortTurnOrder(this.livingPlayers())];
    this.nextCommand();
  }

  private nextCommand(): void {
    if (this.queue.length === 0) {
      this.runRound();
      return;
    }
    this.currentId = this.queue.shift()?.id ?? '';
    this.phase = 'action';
    this.precision = 'medium';
    this.targetEnemyId = '';
    this.render();
  }

  private commit(action: Action): void {
    this.actions[this.currentId] = action;
    this.nextCommand();
  }

  private runRound(): void {
    this.snap = stepBattle(this.snap, this.actions, Math.random);
    this.summary = this.describeEvents();
    this.playEventSounds();
    announce(this.summary);
    if (this.snap.playerWon) {
      this.finish(true);
      return;
    }
    if (this.snap.enemyWon) {
      this.finish(false);
      return;
    }
    this.beginRound();
  }

  private finish(won: boolean): void {
    if (won) {
      playVictory();
      setFighters(this.snap.playerTeam);
      this.scene.start('Reward', {
        enemyLevel: this.enemyRank,
        cityId: this.cityId,
        ladderRank: this.ladderRank,
        crowdWish: crowdWish(this.snap.playerTeam),
      });
    } else {
      playDefeat();
      setFighters(this.snap.playerTeam.map(stabilize));
      this.scene.start('Reward', { enemyLevel: this.enemyRank, won: false });
    }
  }

  private activeSkills(fighter: Fighter | undefined): string[] {
    if (!fighter) return [];
    return Object.keys(fighter.skills).filter((id) => {
      const node = getSkill(id);
      return node && node.mpCost > 0 && (fighter.skills[id] ?? 0) > 0;
    });
  }

  // ── Rendering ──
  private render(): void {
    this.clearScreen();
    this.tooltip = null;
    addArenaBackground(this);
    const compact = this.compact;

    // Top-left utility: auto-battle + speed.
    this.button(compact ? this.cx - 70 : 110, 24, 'AUTO-BATTLE', () => this.startAuto(), {
      width: 120,
      height: 32,
      fontSize: 13,
    });
    this.button(
      compact ? this.cx + 70 : 250,
      24,
      this.speedFast ? 'SPEED: FAST' : 'SPEED: NORMAL',
      () => {
        this.speedFast = !this.speedFast;
        this.render();
      },
      { width: 130, height: 32, fontSize: 13 },
    );

    if (this.phase === 'action') {
      this.button(compact ? this.w - 70 : this.w - 100, 24, 'NEXT TURN', () => this.commit({ kind: 'pass' }), {
        width: 110,
        height: 32,
        fontSize: 12,
      });
    }

    this.renderActionMenu(compact);
    this.renderTurnOrder(compact);
    this.renderTeamTray(compact);
    this.renderSurrender(compact);
    this.renderArena(compact);

    addText(this, this.cx, 48, this.summary, {
      fontSize: '15px',
      color: '#f2d98c',
      wordWrap: { width: this.w - 280 },
    });
  }

  private renderActionMenu(compact: boolean): void {
    const x = compact ? this.cx : 110;

    if (this.phase === 'action') {
      const cur = this.currentFighter();
      addText(this, x, 70, cur ? `${cur.name}'s turn` : '', {
        fontSize: '18px',
        color: '#f2d98c',
        fontStyle: 'bold',
      });
      const y0 = compact ? 150 : 105;
      const step = compact ? 54 : 50;
      const attack = this.button(x, y0, 'ATTACK', () => {
        this.phase = 'precision';
        this.render();
      }, { width: 170, height: 44, fontSize: 16 });
      if (!cur || !canMeleeAttack(cur)) attack.setEnabled(false);
      const tech = this.button(x, y0 + step, 'TECHNIQUE', () => {
        this.phase = 'skill';
        this.render();
      }, { width: 170, height: 44, fontSize: 16 });
      if (this.activeSkills(cur).length === 0) tech.setEnabled(false);
      this.button(x, y0 + step * 2, 'BLOCK', () => this.commit({ kind: 'block' }), { width: 170, height: 44, fontSize: 16 });
      this.button(x, y0 + step * 3, 'CROWD APPEAL', () => this.commit({ kind: 'crowdAppeal' }), { width: 170, height: 44, fontSize: 15 });
      this.button(x, y0 + step * 4, 'ROW', () => this.commit({ kind: 'row' }), { width: 170, height: 44, fontSize: 16 });
      return;
    }

    if (this.phase === 'precision') {
      addText(this, x, 70, 'Attack strength:', { fontSize: '16px', color: '#f2d98c' });
      const y0 = compact ? 150 : 110;
      this.button(x, y0, 'WEAK', () => this.pickPrecision('weak'), { width: 170, height: 44, fontSize: 16 });
      this.button(x, y0 + 50, 'MEDIUM', () => this.pickPrecision('medium'), { width: 170, height: 44, fontSize: 16 });
      this.button(x, y0 + 100, 'STRONG', () => this.pickPrecision('strong'), { width: 170, height: 44, fontSize: 16 });
      this.button(x, y0 + 150, 'BACK', () => {
        this.phase = 'action';
        this.render();
      }, { width: 120, height: 40, fontSize: 15 });
      return;
    }

    if (this.phase === 'target') {
      addText(this, x, 70, 'Choose a target:', { fontSize: '16px', color: '#f2d98c' });
      addText(this, x, compact ? 102 : 94, 'Click an enemy in the arena.', {
        fontSize: '13px',
        color: '#b8aa94',
        wordWrap: { width: 200 },
      });
      this.button(x, compact ? 160 : 140, 'BACK', () => {
        this.phase = 'precision';
        this.render();
      }, { width: 120, height: 40, fontSize: 15 });
      return;
    }

    if (this.phase === 'zone') {
      const target = this.snap.enemyTeam.find((f) => f.id === this.targetEnemyId);
      addText(this, x, 70, `Target: ${target?.name ?? ''}`, { fontSize: '16px', color: '#f2d98c' });
      addText(this, x, compact ? 102 : 94, 'Click a body part on them.', {
        fontSize: '13px',
        color: '#b8aa94',
        wordWrap: { width: 200 },
      });
      this.button(x, compact ? 160 : 140, 'BACK', () => {
        this.phase = 'precision';
        this.render();
      }, { width: 120, height: 40, fontSize: 15 });
      return;
    }

    // phase === 'skill'
    const cur = this.currentFighter();
    addText(this, x, 70, 'Choose a technique:', { fontSize: '16px', color: '#f2d98c' });
    const skills = this.activeSkills(cur);
    const y0 = compact ? 150 : 110;
    skills.forEach((skillId, i) => {
      if (!cur) return;
      const node = getSkill(skillId);
      if (!node) return;
      const rank = cur.skills[skillId] ?? 0;
      const affordable = cur.morale >= node.mpCost;
      const meleeSkill = node.effect.kind === 'strike' || node.effect.kind === 'combo';
      const shieldSkill = node.effect.kind === 'shieldBash';
      const usable =
        (!meleeSkill || canMeleeAttack(cur)) &&
        (!shieldSkill || (canMeleeAttack(cur) && !isZoneDestroyed(cur, 'leftArm')));
      const btn = this.button(
        x,
        y0 + i * 52,
        `${node.label} (${rank}) — ${node.mpCost} MP`,
        () =>
          this.commit({
            kind: 'skill',
            skillId,
            targetId: this.livingEnemies()[0]?.id,
            targetZone: this.livingEnemies()[0] ? weakestZone(this.livingEnemies()[0]) : 'torso',
          }),
        { width: 280, height: 44, fontSize: 15 },
      );
      if (!affordable || !usable) btn.setEnabled(false);
    });
    this.button(x, y0 + skills.length * 52 + 8, 'BACK', () => {
      this.phase = 'action';
      this.render();
    }, { width: 120, height: 40, fontSize: 15 });
  }

  private pickPrecision(precision: AttackPrecision): void {
    this.precision = precision;
    const targets = this.meleeTargets();
    if (targets.length > 1) {
      this.phase = 'target';
    } else {
      this.targetEnemyId = targets[0]?.id ?? '';
      this.phase = 'zone';
    }
    this.render();
  }

  private pickTarget(enemyId: string): void {
    this.targetEnemyId = enemyId;
    this.phase = 'zone';
    this.render();
  }

  private pickZone(zone: BodyZone): void {
    this.commit({
      kind: 'attack',
      precision: this.precision,
      targetId: this.targetEnemyId,
      targetZone: zone,
    });
  }

  private renderTurnOrder(compact: boolean): void {
    const order = sortTurnOrder([...this.livingPlayers(), ...this.livingEnemies()]);
    const x = compact ? this.w - 70 : this.w - 100;
    addText(this, x, 70, 'TURN ORDER', { fontSize: '14px', color: '#f2d98c' }).setOrigin(0.5, 0.5);
    order.forEach((f, i) => {
      const isPlayer = this.snap.playerTeam.some((p) => p.id === f.id);
      addText(this, x, 102 + i * 28, `${f.name}${f.row === 'back' ? ' (B)' : ''}`, {
        fontSize: '12px',
        color: isPlayer ? '#f2d98c' : '#e8dcc8',
        backgroundColor: f.id === this.currentId ? '#8c1f28' : undefined,
        padding: { x: 6, y: 2 },
      }).setOrigin(0.5, 0.5);
    });
  }

  private renderTeamTray(compact: boolean): void {
    const bottom = this.h - 24;
    const playerX = compact ? this.cx - 130 : 200;
    const enemyX = compact ? this.cx + 130 : this.w - 200;

    this.snap.playerTeam.forEach((f, i) => {
      const y = bottom - (this.snap.playerTeam.length - 1 - i) * 42;
      this.drawFighterCard(f, playerX, y);
    });
    this.snap.enemyTeam.forEach((f, i) => {
      const y = bottom - (this.snap.enemyTeam.length - 1 - i) * 42;
      this.drawFighterCard(f, enemyX, y);
    });
  }

  private drawFighterCard(f: Fighter, x: number, y: number): void {
    const dead = !f.alive || isDefeated(f);
    addText(this, x, y, `${f.name} Lv${f.level}${f.row === 'back' ? ' (back)' : ''}`, {
      fontSize: '14px',
      color: dead ? '#c0392b' : '#f2d98c',
      fontStyle: 'bold',
    });
    addText(this, x, y + 20, `HP ${currentHp(f)}/${totalHp(f)}  MP ${f.morale}/${f.maxMorale}`, {
      fontSize: '12px',
      color: dead ? '#c0392b' : '#e8dcc8',
    });
  }

  // ── Arena rendering: visible fighters + click-to-target body zones ──
  private renderArena(compact: boolean): void {
    const s = compact ? 0.7 : 1;
    const players = this.snap.playerTeam;
    const enemies = this.snap.enemyTeam;
    const py = this.teamYs(players.length);
    const ey = this.teamYs(enemies.length);
    const px = compact ? this.cx - 130 : this.cx - 200;
    const ex = compact ? this.cx + 130 : this.cx + 200;
    const targetable = new Set(this.meleeTargets().map((f) => f.id));

    players.forEach((f, i) => this.drawFighter(f, px, py[i], s, 'idle'));
    enemies.forEach((f, i) => {
      let mode: 'idle' | 'target' | 'zone' = 'idle';
      if (this.phase === 'target' && targetable.has(f.id)) mode = 'target';
      if (this.phase === 'zone' && f.id === this.targetEnemyId) mode = 'zone';
      this.drawFighter(f, ex, ey[i], s, mode);
    });
  }

  private teamYs(n: number): number[] {
    if (n <= 1) return [this.h * 0.48];
    const top = this.h * 0.34;
    const bottom = this.h * 0.62;
    const ys: number[] = [];
    for (let i = 0; i < n; i += 1) ys.push(top + ((bottom - top) * i) / (n - 1));
    return ys;
  }

  private drawFighter(f: Fighter, x: number, y: number, s: number, mode: 'idle' | 'target' | 'zone'): void {
    const dead = !f.alive || isDefeated(f);
    const sprite = addLayeredFighter(this, x, y, f, s);
    sprite.setAlpha(dead ? 0.3 : f.row === 'back' ? 0.7 : 1);

    addText(this, x, y + 98 * s, `${f.name}${f.row === 'back' ? ' (back)' : ''}`, {
      fontSize: `${Math.round(13 * s)}px`,
      color: dead ? '#c0392b' : '#e8dcc8',
    }).setOrigin(0.5, 0.5);

    if (mode === 'target' && !dead) {
      const hitbox = this.add
        .rectangle(x, y, 120 * s, 180 * s, 0x000000, 0.001)
        .setInteractive({ useHandCursor: true });
      hitbox.on('pointerdown', () => this.pickTarget(f.id));
      this.add.rectangle(x, y, 120 * s, 180 * s, 0x000000, 0).setStrokeStyle(2, 0xf2d98c, 0.9);
      return;
    }

    if (mode === 'zone' && !dead) {
      this.add.rectangle(x, y, 124 * s, 184 * s, 0x000000, 0).setStrokeStyle(2, 0xf2d98c, 0.9);
      this.drawZoneTargets(f, x, y, s);
    }
  }

  private drawZoneTargets(f: Fighter, x: number, y: number, s: number): void {
    const W = 120 * s;
    const H = 180 * s;
    const geom: Record<BodyZone, { gx: number; gy: number; w: number; h: number }> = {
      head: { gx: x, gy: y - H * 0.30, w: W * 0.30, h: H * 0.18 },
      torso: { gx: x, gy: y - H * 0.02, w: W * 0.42, h: H * 0.30 },
      leftArm: { gx: x - W * 0.26, gy: y - H * 0.04, w: W * 0.16, h: H * 0.32 },
      rightArm: { gx: x + W * 0.26, gy: y - H * 0.04, w: W * 0.16, h: H * 0.32 },
      leftLeg: { gx: x - W * 0.11, gy: y + H * 0.20, w: W * 0.18, h: H * 0.30 },
      rightLeg: { gx: x + W * 0.11, gy: y + H * 0.20, w: W * 0.18, h: H * 0.30 },
    };
    BODY_ZONES.forEach((zone) => {
      const z = geom[zone];
      const destroyed = isZoneDestroyed(f, zone);
      const base = destroyed ? 0x555555 : 0xffffff;
      const shape = this.add
        .rectangle(z.gx, z.gy, z.w, z.h, base, 0.14)
        .setStrokeStyle(1, destroyed ? 0x555555 : 0xf2d98c, 0.8)
        .setInteractive({ useHandCursor: true });
      shape.on('pointerover', () => {
        shape.setFillStyle(0xf2d98c, 0.55);
        this.showZoneTooltip(z.gx, z.gy - 28, zone, f);
      });
      shape.on('pointerout', () => {
        shape.setFillStyle(base, 0.14);
        this.hideZoneTooltip();
      });
      shape.on('pointerdown', () => this.pickZone(zone));
    });
  }

  private showZoneTooltip(x: number, y: number, zone: BodyZone, f: Fighter): void {
    this.hideZoneTooltip();
    const hp = f.zones[zone].hp;
    const max = f.zones[zone].maxHp;
    const cur = this.currentFighter();
    const pct = cur
      ? Math.round(
          precisionHitChance(effectiveAttributes(cur).dexterity, effectiveAttributes(f).defense, this.precision) * 100,
        )
      : 0;
    this.tooltip = addText(this, x, y, `${ZONE_LABELS[zone]}  HP ${hp}/${max}  Hit ${pct}%`, {
      fontSize: '13px',
      color: '#f2d98c',
      backgroundColor: '#000000cc',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1);
  }

  private hideZoneTooltip(): void {
    this.tooltip?.destroy();
    this.tooltip = null;
  }

  /** Bottom-right forfeit control. */
  private renderSurrender(compact: boolean): void {
    this.button(
      compact ? this.w - 70 : this.w - 90,
      this.h - 30,
      'SURRENDER',
      () => this.finish(false),
      { width: 130, height: 36, fontSize: 14, fill: 0x5b1420 },
    );
  }

  // ── Auto-battle ──
  private startAuto(): void {
    this.runAutoStep();
  }

  private runAutoStep(): void {
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finish(this.snap.playerWon);
      return;
    }
    const actions = autoTeamActions(this.livingPlayers(), this.livingEnemies(), Math.random);
    this.snap = stepBattle(this.snap, actions, Math.random);
    this.summary = this.describeEvents();
    announce(this.summary);
    this.render();
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finish(this.snap.playerWon);
      return;
    }
    const delay = getSettings().reducedMotion ? 1 : this.speedFast ? 200 : 650;
    this.time.delayedCall(delay, () => this.runAutoStep());
  }

  private playEventSounds(): void {
    for (const event of this.snap.events) {
      if (event.kind === 'miss') playClick();
      else if (event.kind === 'block') playBlock();
      else if (event.kind === 'attack') {
        if (event.crit) playCrit();
        else playHit();
      } else if (event.kind === 'restore') playClick();
      else if (event.kind === 'skill') playBlock();
      else if (event.kind === 'death') playHit();
      else if (event.kind === 'row') playClick();
      else if (event.kind === 'unable') playClick();
    }
  }

  private describeEvents(): string {
    const name = (id: string | undefined): string => {
      if (!id) return '?';
      const p = this.snap.playerTeam.find((f) => f.id === id);
      if (p) return p.name;
      const e = this.snap.enemyTeam.find((f) => f.id === id);
      return e ? e.name : '?';
    };
    const lines = this.snap.events.map((event) => {
      if (event.kind === 'attack') {
        return `${name(event.actorId)} hit ${name(event.targetId)} (${event.zone}) for ${event.damage}${event.crit ? ' — CRIT' : ''}${event.blocked ? ' — blocked' : ''}`;
      }
      if (event.kind === 'miss') return `${name(event.actorId)} missed`;
      if (event.kind === 'block') return `${name(event.actorId)} guarded`;
      if (event.kind === 'restore') return `${name(event.actorId)} restored ${event.damage} MP`;
      if (event.kind === 'skill') {
        const node = event.skillId ? getSkill(event.skillId) : undefined;
        return `${name(event.actorId)} used ${node?.label ?? 'a technique'}${event.damage ? ` (${event.damage})` : ''}`;
      }
      if (event.kind === 'death') return `${name(event.targetId)} is defeated!`;
      if (event.kind === 'row') return `${name(event.actorId)} moved to the ${event.row ?? 'front'} row`;
      if (event.kind === 'unable') return `${name(event.actorId)} couldn't act (${event.reason ?? 'crippled'})`;
      return '';
    });
    return lines.join('   ·   ') || 'Nothing happened.';
  }
}
