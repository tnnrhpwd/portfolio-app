import Phaser from 'phaser';
import type { Equipment, EquipmentSlot, Loadout } from '../core';
import { isTwoHandedWeapon } from '../core';
import { addEquipmentIcon } from '../assets/textures';

/**
 * The eight drop locations on the human sprite: head, chest, two arms, two
 * legs, and the two hands (main weapon + off-hand). Each zone maps back to an
 * underlying equipment slot; the left/right leg zones both resolve to the
 * single `legs` slot (greaves cover both legs).
 */
type ZoneId = 'head' | 'chest' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg' | 'mainHand' | 'offHand';

interface ZoneDef {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  slot: EquipmentSlot;
}

/** Normalized rects (0..1 of figure width/height) matching the art anchors. */
const ZONES: Record<ZoneId, ZoneDef> = {
  head: { nx: 0.5, ny: 0.15, nw: 0.3, nh: 0.2, slot: 'head' },
  chest: { nx: 0.5, ny: 0.45, nw: 0.34, nh: 0.22, slot: 'torso' },
  rightArm: { nx: 0.72, ny: 0.31, nw: 0.24, nh: 0.2, slot: 'rightArm' },
  leftArm: { nx: 0.28, ny: 0.31, nw: 0.24, nh: 0.2, slot: 'leftArm' },
  rightLeg: { nx: 0.62, ny: 0.83, nw: 0.22, nh: 0.2, slot: 'legs' },
  leftLeg: { nx: 0.38, ny: 0.83, nw: 0.22, nh: 0.2, slot: 'legs' },
  mainHand: { nx: 0.72, ny: 0.57, nw: 0.24, nh: 0.2, slot: 'mainHand' },
  offHand: { nx: 0.28, ny: 0.57, nw: 0.24, nh: 0.2, slot: 'offHand' },
};

const ZONE_ORDER: ZoneId[] = ['head', 'chest', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'mainHand', 'offHand'];

/** The zones an item can be dropped into. A two-hander lights up both hands. */
function zonesForItem(item: Equipment): ZoneId[] {
  switch (item.slot) {
    case 'legs':
      return ['leftLeg', 'rightLeg'];
    case 'mainHand':
      return isTwoHandedWeapon(item) ? ['mainHand', 'offHand'] : ['mainHand'];
    case 'head':
      return ['head'];
    case 'torso':
      return ['chest'];
    case 'leftArm':
      return ['leftArm'];
    case 'rightArm':
      return ['rightArm'];
    case 'offHand':
      return ['offHand'];
    default:
      return [];
  }
}

export interface EquipTargetFigure {
  cx: number;
  cy: number;
  /** Sprite display width/height — slot zones are positioned over this. */
  w: number;
  h: number;
}

export interface EquipDragCallbacks {
  onDragStart?: (slot: EquipmentSlot) => void;
  onDragEnd?: (slot: EquipmentSlot, x: number, y: number) => void;
}

/**
 * Draws the eight drop-location boxes over the mannequin: all eight are always
 * visible (with the equipped item's icon inside), they brighten while the
 * pointer hovers the general drop area, and the applicable one(s) get a green
 * border while an item is dragged.
 */
export class EquipTargets {
  private readonly scene: Phaser.Scene;
  private readonly figure: EquipTargetFigure;
  private boxes: Phaser.GameObjects.Rectangle[] = [];
  private highlights: Phaser.GameObjects.Rectangle[] = [];
  private callbacks: EquipDragCallbacks = {};

  constructor(scene: Phaser.Scene, figure: EquipTargetFigure) {
    this.scene = scene;
    this.figure = figure;
  }

  /** Wire drag callbacks for equipped-item icons. */
  setDragCallbacks(cb: EquipDragCallbacks): void {
    this.callbacks = cb;
  }

  private zoneRect(z: ZoneId): { x: number; y: number; w: number; h: number } {
    const d = ZONES[z];
    return {
      x: this.figure.cx + (d.nx - 0.5) * this.figure.w,
      y: this.figure.cy + (d.ny - 0.5) * this.figure.h,
      w: d.nw * this.figure.w,
      h: d.nh * this.figure.h,
    };
  }

  /** Draw the eight persistent slot boxes, each with its equipped item icon (draggable off). */
  drawSlots(loadout: Loadout): void {
    for (const z of ZONE_ORDER) {
      const r = this.zoneRect(z);
      const slot = ZONES[z].slot;
      this.boxes.push(
        this.scene.add
          .rectangle(r.x, r.y, r.w, r.h, 0x1c1610, 0.22)
          .setStrokeStyle(1.5, 0xe8b84b, 0.6)
          .setDepth(930),
      );
      const item = loadout[slot];
      if (item) this.addEquippedIcon(r.x, r.y, r.w, r.h, slot, item);
    }
  }

  private addEquippedIcon(x: number, y: number, w: number, h: number, slot: EquipmentSlot, item: Equipment): void {
    const size = Math.min(w, h) * 0.78;
    const icon = addEquipmentIcon(this.scene, 0, 0, item, size);
    const container = this.scene.add.container(x, y, icon ? [icon] : []);
    container.setSize(w, h);
    container.setDepth(932);
    container.setInteractive({ draggable: true, useHandCursor: true });
    this.scene.input.setDraggable(container);
    container.on('dragstart', () => {
      container.setDepth(950);
      container.setScale(1.12);
      this.callbacks.onDragStart?.(slot);
    });
    container.on('drag', (pointer: Phaser.Input.Pointer) => {
      container.setPosition(pointer.x, pointer.y);
    });
    container.on('dragend', (pointer: Phaser.Input.Pointer) => {
      container.setScale(1);
      container.setDepth(932);
      this.callbacks.onDragEnd?.(slot, pointer.x, pointer.y);
    });
  }

  /** Brighten every slot box while the pointer hovers the general drop area. */
  setHover(on: boolean): void {
    this.boxes.forEach((b) => b.setStrokeStyle(1.5, on ? 0xf2d98c : 0xe8b84b, on ? 0.95 : 0.6));
  }

  /** Green-highlight the zone(s) this item can be dropped into. */
  highlight(item: Equipment): void {
    this.clearHighlight();
    for (const z of zonesForItem(item)) {
      const r = this.zoneRect(z);
      this.highlights.push(
        this.scene.add
          .rectangle(r.x, r.y, r.w, r.h, 0x2e7d32, 0.3)
          .setStrokeStyle(2.5, 0x4caf50, 0.95)
          .setDepth(940),
      );
    }
  }

  clearHighlight(): void {
    this.highlights.forEach((h) => h.destroy());
    this.highlights = [];
  }

  /** Clear transient state (green highlight + hover) but keep the slot boxes. */
  hide(): void {
    this.clearHighlight();
    this.setHover(false);
  }
}
