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
    this.cameras.main.setBackgroundColor('#1a1410');
    const player = this.gameState.roster[0];
    const enemy = generateOpponent(data?.enemyRank ?? this.gameState.fame + 1, Math.random);
    this.snap = startBattle(player, enemy);
    this.playerId = this.snap.player.id;
    this.enemyId = this.snap.enemy.id;
    this.phase = 'action';
    this.summary = 'Your turn — pick an action.';
    this.render();
  }

  private render(): void {
    this.children.removeAll();
    const { width, height } = this.scale;
    const cx = width / 2;

    this.drawCard(this.snap.player, cx - 320);
    this.drawCard(this.snap.enemy, cx + 320);
    addText(this, cx, 120, this.summary, { fontSize: '18px', color: '#f2d98c' });

    const bottom = height - 70;
    if (this.phase === 'action') {
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
    } else if (this.phase === 'precision') {
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
    } else if (this.phase === 'zone') {
      addText(this, cx, height - 120, 'Choose a body part to strike:', {
        fontSize: '18px',
        color: '#f2d98c',
      });
      BODY_ZONES.forEach((zone: BodyZone, i: number) => {
        const bx = cx - 200 + (i % 3) * 200;
        const by = height - 70 + Math.floor(i / 3) * 60;
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
    } else {
      addText(this, cx, 180, 'Choose a technique:', { fontSize: '18px', color: '#f2d98c' });
      const skills = this.activeSkills();
      skills.forEach((skillId, i) => {
        const node = getSkill(skillId);
        if (!node) return;
        const rank = this.snap.player.skills[skillId] ?? 0;
        const affordable = this.snap.player.morale >= node.mpCost;
        const btn = this.button(cx, 230 + i * 52, `${node.label} (${rank}) — ${node.mpCost} MP`, () => {
          this.resolve({ kind: 'skill', skillId });
        }, { width: 280, height: 44, fontSize: 16 });
        if (!affordable) btn.setEnabled(false);
      });
      this.button(96, bottom, 'BACK', () => {
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

  private drawCard(fighter: Fighter, x: number): void {
    addText(this, x, 120, `${fighter.name}  Lv${fighter.level}`, {
      fontSize: '20px',
      color: '#f2d98c',
      fontStyle: 'bold',
    });
    addText(
      this,
      x,
      150,
      `HP ${currentHp(fighter)}/${totalHp(fighter)}  MP ${fighter.morale}/${fighter.maxMorale}`,
      { fontSize: '16px' },
    );
    BODY_ZONES.forEach((zone: BodyZone, i: number) => {
      const z = fighter.zones[zone];
      addText(this, x, 180 + i * 26, `${ZONE_LABELS[zone]}: ${z.hp}/${z.maxHp}`, {
        fontSize: '14px',
        color: z.hp <= 0 ? '#c0392b' : '#b8aa94',
      });
    });
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
    this.render();
    if (this.snap.playerWon || this.snap.enemyWon) {
      this.finishBattle();
      return;
    }
    this.time.delayedCall(this.speedFast ? 200 : 650, () => this.runAutoStep());
  }

  private afterStep(): void {
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
