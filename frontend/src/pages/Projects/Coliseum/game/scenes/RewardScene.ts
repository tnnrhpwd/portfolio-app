import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import {
  addXp,
  advanceColiseumRank,
  cityById,
  postBattleRewards,
  recomputeDerived,
  rollLoot,
  victoryRewards,
  type Equipment,
  type MetalId,
  type Verdict,
} from '../core';

type Phase = 'verdict' | 'loot';

export class RewardScene extends BaseScene {
  private enemyLevel = 1;
  private cityId = '';
  private ladderRank = 0;
  private won = true;
  private phase: Phase = 'verdict';
  private loot: Equipment[] = [];
  private goldEarned = 0;
  private xpEarned = 0;
  private invBounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private wish: Verdict = 'mercy';

  constructor() {
    super('Reward');
  }

  create(data: { enemyLevel?: number; cityId?: string; ladderRank?: number; won?: boolean; crowdWish?: Verdict } = {}): void {
    this.enemyLevel = data?.enemyLevel ?? 1;
    this.cityId = data?.cityId ?? '';
    this.ladderRank = data?.ladderRank ?? 0;
    this.won = data?.won !== false;
    this.wish = data?.crowdWish ?? 'mercy';
    this.invBounds = null;
    this.goldEarned = 0;
    this.xpEarned = 0;
    this.loot = [];
    this.phase = this.won ? 'verdict' : 'loot';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    if (this.phase === 'verdict') this.renderVerdict();
    else this.renderLoot();
  }

  private renderVerdict(): void {
    this.clearScreen();
    this.applyBackground();
    const base = victoryRewards(this.enemyLevel);
    const compact = this.compact;

    addText(this, this.cx, 96, this.wish === 'execute' ? 'THE CROWD ASKS FOR BLOOD' : 'THE CROWD ASKS FOR MERCY', {
      fontSize: compact ? '26px' : '34px',
      color: '#e8b84b',
      fontStyle: 'bold',
      wordWrap: { width: this.w - 40 },
    });
    addText(
      this,
      this.cx,
      154,
      this.wish === 'execute'
        ? "Granting the crowd's wish grants extra loot."
        : "Granting the crowd's wish boosts your MP level.",
      {
        fontSize: '18px',
        color: '#e8dcc8',
        wordWrap: { width: this.w - 80 },
      },
    );
    addText(this, this.cx, 204, `Victory reward: ${base.gold} gp · ${base.xp} xp`, {
      fontSize: '15px',
      color: '#b8aa94',
    });

    const bx1 = compact ? this.cx : this.cx - 170;
    const bx2 = compact ? this.cx : this.cx + 170;
    const y1 = 300;
    const y2 = compact ? 408 : 300;

    this.button(bx1, y1, 'MERCY', () => this.applyVerdict('mercy'), {
      width: compact ? 320 : 300,
      height: 62,
      fontSize: 24,
    });
    addText(this, bx1, y1 + 42, 'XP BONUS + MP LEVEL BOOST', { fontSize: '13px', color: '#f2d98c' });
    this.button(bx2, y2, 'BLOOD', () => this.applyVerdict('execute'), {
      width: compact ? 320 : 300,
      height: 62,
      fontSize: 24,
    });
    addText(this, bx2, y2 + 42, 'EXTRA LOOT', { fontSize: '13px', color: '#f2d98c' });
  }

  private applyVerdict(verdict: Verdict): void {
    const cityTier = cityById(this.cityId)?.shopTier ?? 0;
    const rewards = postBattleRewards(this.enemyLevel, verdict, cityTier);
    const grantedWish = verdict === this.wish;
    const crowdBonus = grantedWish ? Math.round(victoryRewards(this.enemyLevel).gold * 0.25) : 0;

    // Every fighter who fought earns XP and the MP-level boost.
    const team = this.gameState.roster.slice(0, 3).map((f) => {
      const newMaxMorale = f.maxMorale + rewards.maxMoraleGain;
      const leveled = addXp({ ...f, maxMorale: newMaxMorale, morale: newMaxMorale }, rewards.xp);
      return recomputeDerived(leveled);
    });
    const roster = [...team, ...this.gameState.roster.slice(3)];

    const metals = { ...this.gameState.metals };
    for (const [key, value] of Object.entries(rewards.metals)) {
      metals[key as MetalId] = (metals[key as MetalId] ?? 0) + (value ?? 0);
    }
    this.gameState = {
      ...this.gameState,
      roster,
      gold: this.gameState.gold + rewards.gold + crowdBonus,
      metals,
      fame: this.gameState.fame + 1,
    };
    if (this.cityId && this.ladderRank > 0) {
      this.gameState = advanceColiseumRank(this.gameState, this.cityId, this.ladderRank);
    }
    this.applyAchievements();

    this.goldEarned = rewards.gold + crowdBonus;
    this.xpEarned = rewards.xp;
    this.loot = rollLoot(cityTier, verdict, Math.random);
    if (grantedWish) this.toast('The crowd is pleased!');
    this.phase = 'loot';
    this.render();
  }

  private renderLoot(): void {
    this.clearScreen();
    this.applyBackground();
    this.invBounds = null;

    this.header(this.won ? 'VICTORY!' : 'DEFEAT');
    if (this.won) {
      addText(this, this.cx, 92, `Rewards: +${this.goldEarned} gp · +${this.xpEarned} xp`, {
        fontSize: '20px',
        color: '#f2d98c',
      });
    } else {
      addText(this, this.cx, 92, 'You were defeated — no rewards this time.', {
        fontSize: '18px',
        color: '#b8aa94',
      });
    }

    const compact = this.compact;
    const slot = compact ? 48 : 64;
    const gap = 8;

    // ── Loot ──
    const lootLabelY = compact ? 130 : 142;
    addText(this, this.cx, lootLabelY, `LOOT (${this.loot.length})`, {
      fontSize: '18px',
      color: '#f2d98c',
    });
    const lootTop = lootLabelY + (compact ? 34 : 46);
    const lootSlots = compact ? 3 : 6;
    this.loot.forEach((item, i) => {
      const col = i % lootSlots;
      const row = Math.floor(i / lootSlots);
      const x = this.cx - ((Math.min(this.loot.length, lootSlots) - 1) * (slot + gap)) / 2 + col * (slot + gap);
      const y = lootTop + row * (slot + gap);
      this.drawLootItem(item, x, y, slot);
    });

    // ── Inventory ──
    const invLabelY = lootTop + (Math.ceil(this.loot.length / lootSlots) || 1) * (slot + gap) + (compact ? 8 : 18);
    addText(this, this.cx, invLabelY, `INVENTORY (${this.gameState.inventory.length})`, {
      fontSize: '18px',
      color: '#f2d98c',
    });

    const cols = compact ? 4 : 6;
    const capacity = compact ? 8 : 12;
    const cells: Array<Equipment | null> = [...this.gameState.inventory];
    while (cells.length < capacity) cells.push(null);
    const rows = Math.ceil(cells.length / cols);
    const gridW = cols * slot + (cols - 1) * gap;
    const gridH = rows * slot + (rows - 1) * gap;
    const x0 = this.cx - gridW / 2;
    const y0 = invLabelY + (compact ? 26 : 36);
    this.invBounds = { x0, y0, x1: x0 + gridW, y1: y0 + gridH };
    cells.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = x0 + slot / 2 + col * (slot + gap);
      const y = y0 + slot / 2 + row * (slot + gap);
      this.drawInventoryCell(item, x, y, slot);
    });

    // ── Actions ──
    const actionY = this.h - 44;
    const lootAll = this.button(this.cx - 110, actionY, 'LOOT ALL', () => this.lootAll(), {
      width: 180,
      height: 48,
      fontSize: 18,
    });
    if (this.loot.length === 0) lootAll.setEnabled(false);
    this.button(this.cx + 110, actionY, 'DONE', () => this.done(), {
      width: 180,
      height: 48,
      fontSize: 18,
    });
  }

  private drawLootItem(item: Equipment, x: number, y: number, size: number): void {
    const rect = this.add.rectangle(x, y, size, size, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    const label = this.add
      .text(x, y, item.name, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '10px',
        color: '#f2d98c',
        wordWrap: { width: size - 10 },
        align: 'center',
      })
      .setOrigin(0.5);
    const c = this.add.container(x, y, [rect, label]);
    c.setSize(size, size);
    c.setInteractive({ draggable: true, useHandCursor: true });
    this.input.setDraggable(c);

    c.on('dragstart', () => {
      c.setDepth(950);
      c.setScale(1.08);
    });
    c.on('drag', (pointer: Phaser.Input.Pointer) => {
      c.setPosition(pointer.x, pointer.y);
    });
    c.on('dragend', (pointer: Phaser.Input.Pointer) => {
      c.setScale(1);
      c.setDepth(0);
      if (this.pointInInventory(pointer.x, pointer.y)) {
        this.moveLootToInventory(item);
      } else {
        c.setPosition(x, y);
      }
    });
  }

  private drawInventoryCell(item: Equipment | null, x: number, y: number, size: number): void {
    const fill = item ? 0x8c1f28 : 0x2a241d;
    const stroke = item ? 0xe8b84b : 0x6a6258;
    this.add.rectangle(x, y, size, size, fill).setStrokeStyle(2, stroke);
    if (item) {
      this.add
        .text(x, y, item.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '10px',
          color: '#f2d98c',
          wordWrap: { width: size - 10 },
          align: 'center',
        })
        .setOrigin(0.5);
    }
  }

  private pointInInventory(x: number, y: number): boolean {
    const b = this.invBounds;
    if (!b) return false;
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  }

  private moveLootToInventory(item: Equipment): void {
    this.loot = this.loot.filter((l) => l.id !== item.id);
    this.gameState = { ...this.gameState, inventory: [...this.gameState.inventory, item] };
    this.render();
  }

  private lootAll(): void {
    if (this.loot.length === 0) return;
    this.gameState = { ...this.gameState, inventory: [...this.gameState.inventory, ...this.loot] };
    this.loot = [];
    this.render();
  }

  private done(): void {
    if (this.loot.length > 0) {
      this.confirm('Leave loot behind?', 'Unclaimed loot will be lost.', () => this.scene.start('Main'));
    } else {
      this.scene.start('Main');
    }
  }
}
