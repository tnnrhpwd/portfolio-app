import { BaseScene } from './BaseScene';
import { addText, type ButtonOpts } from '../ui/button';
import { isLoggedIn } from '../state/cloudSync';
import { addMapBackgroundRaster } from '../assets/textures';
import {
  CITIES,
  cityUnlockRequirement,
  createCampaignStart,
  isCityUnlocked,
  unlockedCities,
  type City,
} from '../core';

interface MenuItem {
  label: string;
  onClick: () => void;
}

export class MainScene extends BaseScene {
  private selectedCityId = '';

  constructor() {
    super('Main');
  }

  create(): void {
    if (!this.selectedCityId) this.selectedCityId = this.latestUnlockedCity().id;
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  /** The furthest city unlocked so far. */
  private latestUnlockedCity(): City {
    const unlocked = unlockedCities(this.gameState);
    return unlocked[unlocked.length - 1] ?? CITIES[0];
  }

  /** The city currently selected to drive coliseum / shop / market power. */
  private selectedCity(): City {
    const unlocked = unlockedCities(this.gameState);
    return unlocked.find((c) => c.id === this.selectedCityId) ?? this.latestUnlockedCity();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    addMapBackgroundRaster(this);
    this.header('COLISEUM');

    const compact = this.compact;
    const m = compact ? 12 : 20;
    const menuW = compact ? 160 : 210;
    const itemH = compact ? 40 : 46;
    const itemFont = compact ? 13 : 16;
    const city = this.selectedCity();

    // ── Top-left: settings + gold readout ──
    const settingsY = compact ? 84 : 48;
    this.button(m + 78, settingsY, 'SETTINGS', () => this.scene.start('Settings'), {
      width: compact ? 132 : 160,
      height: compact ? 40 : 48,
      fontSize: itemFont,
    });
    addText(this, m + 78, settingsY + 42, `Gold: ${this.gameState.gold}`, {
      fontSize: '18px',
      color: '#f2d98c',
    }).setOrigin(0.5, 0);

    // ── Top-right: global menu (inventory / skill / team / blacksmith / trophies) ──
    const rightItems: MenuItem[] = [
      { label: 'INVENTORY', onClick: () => this.scene.start('Inventory') },
      { label: 'SKILL', onClick: () => this.scene.start('Skill') },
      { label: 'TEAM', onClick: () => this.scene.start('Team') },
      { label: 'BLACKSMITH', onClick: () => this.scene.start('Blacksmith', { cityId: city.id }) },
      { label: 'CUSTOMIZE', onClick: () => this.scene.start('Creation', { customize: true }) },
      { label: 'TROPHIES', onClick: () => this.scene.start('Achievements') },
      { label: 'INFIRMARY', onClick: () => this.scene.start('Infirmary') },
    ];
    const rightTop = compact ? 110 : 96;
    const rightCy = rightTop + (20 + rightItems.length * itemH) / 2;
    this.menuPanel(this.w - m - menuW / 2, rightCy, menuW, itemH, itemFont, rightItems);

    // ── Bottom-left: city actions (coliseum / recruit / shop) ──
    const leftItems: MenuItem[] = [
      { label: 'COLISEUM', onClick: () => this.scene.start('Coliseum', { cityId: city.id }) },
      { label: 'RECRUIT', onClick: () => this.scene.start('Recruit', { tier: city.shopTier, cityId: city.id }) },
      { label: 'SHOP', onClick: () => this.scene.start('Shop', { tier: city.shopTier, cityId: city.id }) },
    ];
    const leftCy = this.h - m - (20 + leftItems.length * itemH) / 2;
    this.menuPanel(m + menuW / 2, leftCy, menuW, itemH, itemFont, leftItems);

    // ── Center: campaign cities (the world map lives here) ──
    const contentX = compact ? (this.w - menuW) / 2 - m : this.cx;
    this.cityGrid(contentX, compact);

    if (compact) {
      this.button(this.w - m - 80, this.h - m - 28, 'RESET SAVE', () => this.resetSave(), {
        width: 140,
        height: 44,
        fontSize: 14,
      });
    } else {
      this.button(this.w - m - 90, this.h - m - 28, 'RESET SAVE', () => this.resetSave(), {
        width: 160,
        height: 44,
        fontSize: 14,
      });
      addText(
        this,
        this.cx,
        this.h - 24,
        isLoggedIn()
          ? 'Cloud save on — progress syncs automatically.'
          : 'Log in to save your progress across devices.',
        { fontSize: '14px', color: '#6a6258' },
      );
    }
  }

  /** The campaign city nodes, laid out in a grid (the old WorldMap page, now inline). */
  private cityGrid(x: number, compact: boolean): void {
    const cols = compact ? 1 : 2;
    const gapX = compact ? 0 : 300;
    const rowH = compact ? 46 : 54;
    const topY = compact ? 140 : 180;
    CITIES.forEach((city, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = x - ((cols - 1) * gapX) / 2 + col * gapX;
      const by = topY + row * rowH;
      const unlocked = isCityUnlocked(this.gameState, city.id);
      const selected = city.id === this.selectedCityId;
      const req = cityUnlockRequirement(city.id);
      const label = selected ? `★ ${city.name}` : unlocked ? city.name : req ? `${city.name} (beat ${req.name})` : city.name;
      const opts: ButtonOpts = {
        width: compact ? 230 : 260,
        height: compact ? 40 : 48,
        fontSize: compact ? 15 : 19,
      };
      if (selected) {
        opts.fill = 0xe8b84b;
        opts.hoverFill = 0xf0c858;
        opts.textColor = '#3a2f24';
      }
      const btn = this.button(bx, by, label, () => this.selectCity(city), opts);
      if (!unlocked) btn.setEnabled(false);
    });
  }

  private selectCity(city: City): void {
    this.selectedCityId = city.id;
    this.render();
  }

  /** A bordered panel of vertical menu buttons (matches the reference's ribbon list). */
  private menuPanel(
    cx: number,
    cy: number,
    width: number,
    itemH: number,
    fontSize: number,
    items: MenuItem[],
  ): void {
    const pad = 10;
    const height = pad * 2 + items.length * itemH;
    this.add
      .rectangle(cx, cy, width, height, this.theme.panel, 1)
      .setStrokeStyle(2, this.theme.panelStroke);
    items.forEach((item, i) => {
      const by = cy - height / 2 + pad + itemH / 2 + i * itemH;
      if (i > 0) {
        this.add.rectangle(cx, by - itemH / 2, width - 10, 1, this.theme.panelStroke, 0.6);
      }
      this.button(cx, by, item.label, item.onClick, {
        width: width - 16,
        height: itemH - 6,
        fontSize,
      });
    });
  }

  private resetSave(): void {
    this.confirm('Reset save?', 'This wipes your school and starts a new game.', () => {
      this.gameState = createCampaignStart();
      this.scene.start('Creation');
    });
  }
}
