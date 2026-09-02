import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { setFighter } from '../state/store';
import {
  autoStrategy,
  BODY_ZONES,
  currentHp,
  generateOpponent,
  getSkill,
  stabilize,
  startBattle,
  stepBattle,
  totalHp,
  type Action,
  type AttackPrecision,
  type BattleSnapshot,
  type BodyZone,
  type Fighter,
} from '../core';
import { playBlock, playClick, playCrit, playDefeat, playHit, playVictory } from '../audio/sfx';
import { addArenaBackground, addStyleSprite } from '../assets/textures';
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

type Phase = 'action' | 'precision' | 'zone' | 'skill';

export class BattleScene extends BaseScene {
  private snap!: BattleSnapshot;
  private phase: Phase = 'action';
  private precision: AttackPrecision = 'medium';
  private summary = '';
  private playerId = '';
  private enemyId = '';
  private speedFast = false;

  constructor() {
    super('Battle');
  }

  create(data: { enemyRank?: number } = {}): void {
    this.applyBackground(this.theme.bgAlt);
    const player = this.gameState.roster[0];
    const enemy = generateOpponent(data?.enemyRank ?? this.gameState.fame + 1, Math.random);
    this.snap = startBattle(player, enemy);
    this.playerId = this.snap.player.id;
    this.enemyId = this.snap.enemy.id;
    this.phase = 'action';
    this.summary = 'Your turn — pick an action.';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    addArenaBackground(this);
    const compact = this.compact;
    const cx = this.cx;
    const bottom = this.h - 70;

    if (compact) {
      this.drawCard(this.snap.player, cx, 110, true);
      this.drawCard(this.snap.enemy, cx, 310, true);
      addText(this, cx, 492, this.summary, {
        fontSize: '16px',
        color: '#f2d98c',
        wordWrap: { width: this.w - 40 },
      });
    } else {
      this.drawCard(this.snap.player, cx - 320, 120, false);
      this.drawCard(this.snap.enemy, cx + 320, 120, false);
      addText(this, cx, 120, this.summary, { fontSize: '18px', color: '#f2d98c' });
    }

    if (this.phase === 'action') {
      if (compact) {
        this.button(cx - 95, bottom - 150, 'ATTACK', () => {
          this.phase = 'precision';
          this.render();
        }, { width: 170, height: 46, fontSize: 16 });
        const technique = this.button(cx + 95, bottom - 150, 'TECHNIQUE', () => {
          this.phase = 'skill';
          this.render();
        }, { width: 170, height: 46, fontSize: 16 });
        if (this.activeSkills().length === 0) technique.setEnabled(false);
        this.button(cx - 95, bottom - 92, 'BLOCK', () => this.resolve({ kind: 'block' }), {
          width: 170,
          height: 46,
          fontSize: 16,
        });
        this.button(cx + 95, bottom - 92, 'CROWD APPEAL', () => this.resolve({ kind: 'crowdAppeal' }), {
          width: 170,
          height: 46,
          fontSize: 15,
        });
        this.button(cx - 95, bottom - 34, 'AUTO-BATTLE', () => this.startAuto(), {
          width: 170,
          height: 38,
          fontSize: 15,
        });
        this.button(cx + 95, bottom - 34, this.speedFast ? 'SPEED: FAST' : 'SPEED: NORMAL', () => {
          this.speedFast = !this.speedFast;
          this.render();
        }, { width: 170, height: 38, fontSize: 15 });
      } else {
        this.button(cx - 270, bottom, 'ATTACK', () => {
          this.phase = 'precision';
          this.render();
        }, { width: 180 });
        const technique = this.button(cx - 90, bottom, 'TECHNIQUE', () => {
          this.phase = 'skill';
          this.render();
        }, { width: 180 });
        if (this.activeSkills().length === 0) technique.setEnabled(false);
        this.button(cx + 90, bottom, 'BLOCK', () => this.resolve({ kind: 'block' }), { width: 180 });
        this.button(cx + 270, bottom, 'CROWD APPEAL', () => this.resolve({ kind: 'crowdAppeal' }), {
          width: 180,
        });
        this.button(cx - 160, bottom - 70, 'AUTO-BATTLE', () => this.startAuto(), {
          width: 180,
          height: 44,
          fontSize: 17,
        });
        this.button(cx + 160, bottom - 70, this.speedFast ? 'SPEED: FAST' : 'SPEED: NORMAL', () => {
          this.speedFast = !this.speedFast;
          this.render();
        }, { width: 180, height: 44, fontSize: 17 });
      }
    } else if (this.phase === 'precision') {
      if (compact) {
        this.button(cx, bottom - 140, 'WEAK', () => {
          this.precision = 'weak';
          this.phase = 'zone';
          this.render();
        }, { width: 170 });
        this.button(cx, bottom - 82, 'MEDIUM', () => {
          this.precision = 'medium';
          this.phase = 'zone';
          this.render();
        }, { width: 170 });
        this.button(cx, bottom - 24, 'STRONG', () => {
          this.precision = 'strong';
          this.phase = 'zone';
          this.render();
        }, { width: 170 });
        this.button(cx, bottom, 'BACK', () => {
          this.phase = 'action';
          this.render();
        }, { width: 120, height: 44, fontSize: 18 });
      } else {
        this.button(cx - 180, bottom, 'WEAK', () => {
          this.precision = 'weak';
          this.phase = 'zone';
          this.render();
        });
        this.button(cx, bottom, 'MEDIUM', () => {
          this.precision = 'medium';
          this.phase = 'zone';
          this.render();
        });
        this.button(cx + 180, bottom, 'STRONG', () => {
          this.precision = 'strong';
          this.phase = 'zone';
          this.render();
        });
        this.button(96, bottom, 'BACK', () => {
          this.phase = 'action';
          this.render();
        }, { width: 120, height: 44, fontSize: 18 });
      }
    } else if (this.phase === 'zone') {
      addText(this, cx, this.h - 170, 'Choose a body part to strike:', {
        fontSize: '18px',
        color: '#f2d98c',
      });
      if (compact) {
        BODY_ZONES.forEach((zone: BodyZone, i: number) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          this.button(cx - 95 + col * 190, bottom - 140 + row * 62, ZONE_LABELS[zone], () =>
            this.resolve(this.attackAction(zone)),
          { width: 170, height: 44, fontSize: 16 });
        });
        this.button(cx, bottom, 'BACK', () => {
          this.phase = 'precision';
          this.render();
        }, { width: 120, height: 44, fontSize: 18 });
      } else {
        BODY_ZONES.forEach((zone: BodyZone, i: number) => {
          const bx = cx - 200 + (i % 3) * 200;
          const by = bottom + Math.floor(i / 3) * 60;
          this.button(bx, by, ZONE_LABELS[zone], () => this.resolve(this.attackAction(zone)), {
            width: 170,
            height: 48,
            fontSize: 17,
          });
        });
        this.button(96, bottom, 'BACK', () => {
          this.phase = 'precision';
          this.render();
        }, { width: 120, height: 44, fontSize: 18 });
      }
    } else {
      addText(this, cx, compact ? 520 : 180, 'Choose a technique:', { fontSize: '18px', color: '#f2d98c' });
      const skills = this.activeSkills();
      skills.forEach((skillId, i) => {
        const node = getSkill(skillId);
        if (!node) return;
        const rank = this.snap.player.skills[skillId] ?? 0;
        const affordable = this.snap.player.morale >= node.mpCost;
        const btn = this.button(
          cx,
          (compact ? 520 : 180) + 48 + i * 52,
          `${node.label} (${rank}) — ${node.mpCost} MP`,
          () => {
            this.resolve({ kind: 'skill', skillId });
          },
          { width: 280, height: 44, fontSize: 16 },
        );
        if (!affordable) btn.setEnabled(false);
      });
      this.button(compact ? cx : 96, compact ? bottom : bottom, 'BACK', () => {
        this.phase = 'action';
        this.render();
      }, { width: 120, height: 44, fontSize: 18 });
    }
  }

  private activeSkills(): string[] {
    return Object.keys(this.snap.player.skills).filter((id) => {
      const node = getSkill(id);
      return node && node.mpCost > 0 && (this.snap.player.skills[id] ?? 0) > 0;
    });
  }

  private drawCard(fighter: Fighter, x: number, y: number, compact: boolean): void {
    addText(this, x, y, `${fighter.name}  Lv${fighter.level}`, {
      fontSize: compact ? '18px' : '20px',
      color: '#f2d98c',
      fontStyle: 'bold',
    });
    addText(
      this,
      x,
      y + (compact ? 24 : 30),
      `HP ${currentHp(fighter)}/${totalHp(fighter)}  MP ${fighter.morale}/${fighter.maxMorale}`,
      { fontSize: compact ? '14px' : '16px' },
    );
    const zonesY = y + (compact ? 48 : 60);
    if (compact) {
      BODY_ZONES.forEach((zone: BodyZone, i: number) => {
        const z = fighter.zones[zone];
        const col = i % 2;
        const row = Math.floor(i / 2);
        addText(this, x - 90 + col * 180, zonesY + row * 24, `${ZONE_LABELS[zone]}: ${z.hp}/${z.maxHp}`, {
          fontSize: '13px',
          color: z.hp <= 0 ? '#c0392b' : '#b8aa94',
        }).setOrigin(0.5);
      });
    } else {
      BODY_ZONES.forEach((zone: BodyZone, i: number) => {
        const z = fighter.zones[zone];
        addText(this, x, zonesY + i * 26, `${ZONE_LABELS[zone]}: ${z.hp}/${z.maxHp}`, {
          fontSize: '14px',
          color: z.hp <= 0 ? '#c0392b' : '#b8aa94',
        });
      });
      // Original stylized figure for this fighter's weapon style.
      addStyleSprite(this, x, y + 330, fighter.style);
    }
  }

  private attackAction(zone: BodyZone): Action {
    return { kind: 'attack', precision: this.precision, targetId: this.enemyId, targetZone: zone };
  }

  private resolve(action: Action): void {
    this.snap = stepBattle(this.snap, action, Math.random);
    this.summary = this.describeEvents();
    this.playEventSounds();
    this.afterStep();
  }

  private startAuto(): void {
    this.phase = 'action';
    this.runAutoStep();
  }

  private runAutoStep(): void {
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finishBattle();
      return;
    }
    this.snap = stepBattle(this.snap, autoStrategy(this.snap.player, this.snap.enemy), Math.random);
    this.summary = this.describeEvents();
    announce(this.summary);
    this.render();
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finishBattle();
      return;
    }
    const delay = getSettings().reducedMotion ? 1 : this.speedFast ? 200 : 650;
    this.time.delayedCall(delay, () => this.runAutoStep());
  }

  private afterStep(): void {
    announce(this.summary);
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finishBattle();
      return;
    }
    this.phase = 'action';
    this.render();
  }

  private finishBattle(): void {
    if (this.snap.playerWon) {
      playVictory();
      setFighter(this.snap.player);
      this.scene.start('Reward', { enemyLevel: this.snap.enemy.level });
      return;
    }
    if (this.snap.enemyWon) {
      playDefeat();
      setFighter(stabilize(this.snap.player));
      this.scene.start('Main');
    }
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
    }
  }

  private describeEvents(): string {
    const lines = this.snap.events.map((event) => {
      const actor = event.actorId === this.playerId ? 'You' : 'Foe';
      const target = event.targetId === this.playerId ? 'you' : 'the foe';
      if (event.kind === 'attack') {
        return `${actor} hit ${target} (${event.zone}) for ${event.damage}${event.crit ? ' — CRIT' : ''}${event.blocked ? ' — blocked' : ''}`;
      }
      if (event.kind === 'miss') return `${actor} missed`;
      if (event.kind === 'block') return `${actor} guarded`;
      if (event.kind === 'restore') return `${actor} restored ${event.damage} MP`;
      if (event.kind === 'skill') {
        const node = event.skillId ? getSkill(event.skillId) : undefined;
        return `${actor} used ${node?.label ?? 'a technique'}${event.damage ? ` (${event.damage})` : ''}`;
      }
      if (event.kind === 'death') return `${target} is defeated!`;
      return '';
    });
    return lines.join('   ·   ') || 'Nothing happened.';
  }
}
