import { BaseScene } from './BaseScene';
import { addText, type ButtonOpts } from '../ui/button';
import { isLoggedIn } from '../state/cloudSync';
import { addChromePlate, addMapBackgroundRaster, CHROME_PANEL_KEY } from '../assets/textures';
import {
  CITIES,
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

    const portrait = this.portrait;
    const m = portrait ? 16 : 20;
    const menuW = portrait ? 300 : 210;
    const itemH = portrait ? 54 : 46;
    const itemFont = 16;
    const city = this.selectedCity();

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

    // ── Bottom-left: city actions (coliseum / recruit / shop) ──
    const leftItems: MenuItem[] = [
      { label: 'COLISEUM', onClick: () => this.scene.start('Coliseum', { cityId: city.id }) },
      { label: 'RECRUIT', onClick: () => this.scene.start('Recruit', { tier: city.shopTier, cityId: city.id }) },
      { label: 'SHOP', onClick: () => this.scene.start('Shop', { tier: city.shopTier, cityId: city.id }) },
    ];

    if (portrait) {
      // There is no room beside anything at 720px, so the hub becomes three
      // stacked bands: a top bar, the campaign list, then the menus.
      this.button(m + 92, 104, 'SETTINGS', () => this.scene.start('Settings'), {
        width: 176,
        height: 48,
        fontSize: itemFont,
      });
      addText(this, this.w - m, 104, `Gold: ${this.gameState.gold}`, {
        fontSize: '20px',
        color: '#f2d98c',
      }).setOrigin(1, 0.5);

      this.cityGrid(this.cx, true);

      // Global menu as a 2-column sheet beneath the city list.
      const menuTop = 884;
      rightItems.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        this.button(this.cx + (col === 0 ? -152 : 152), menuTop + row * 60, item.label, item.onClick, {
          width: 288,
          height: 52,
          fontSize: itemFont,
        });
      });

      // City actions as one bottom row, the thumb's natural resting place.
      const actionY = this.h - 150;
      leftItems.forEach((item, i) => {
        this.button(this.cx + (i - 1) * 224, actionY, item.label, item.onClick, {
          width: 204,
          height: 58,
          fontSize: 15,
        });
      });

      this.button(this.w - m - 82, this.h - m - 22, 'RESET SAVE', () => this.resetSave(), {
        width: 164,
        height: 44,
        fontSize: 14,
      });
      return;
    }

    // ── Landscape: settings + gold top-left, menus in the top-right and
    // bottom-left corners, campaign list centred between them. ──
    const settingsY = 48;
    this.button(m + 78, settingsY, 'SETTINGS', () => this.scene.start('Settings'), {
      width: 160,
      height: 48,
      fontSize: itemFont,
    });
    addText(this, m + 78, settingsY + 42, `Gold: ${this.gameState.gold}`, {
      fontSize: '18px',
      color: '#f2d98c',
    }).setOrigin(0.5, 0);

    const rightTop = 96;
    const rightCy = rightTop + (20 + rightItems.length * itemH) / 2;
    this.menuPanel(this.w - m - menuW / 2, rightCy, menuW, itemH, itemFont, rightItems);

    const leftCy = this.h - m - (20 + leftItems.length * itemH) / 2;
    this.menuPanel(m + menuW / 2, leftCy, menuW, itemH, itemFont, leftItems);

    this.cityGrid(this.cx, false);

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

  /** The campaign city nodes, laid out in a grid (the old WorldMap page, now inline). */
  private cityGrid(x: number, portrait: boolean): void {
    // A single tall column in portrait: two 260px buttons plus a 300px gutter
    // needs 820px, which does not exist in a 720px box.
    const cols = portrait ? 1 : 2;
    const gapX = portrait ? 0 : 300;
    const rowH = portrait ? 68 : 54;
    const topY = portrait ? 190 : 180;
    const rows = Math.ceil(CITIES.length / cols);
    const btnW = portrait ? 330 : 260;
    const btnH = portrait ? 58 : 48;

    // ONE panel behind the whole campaign list rather than a plate per city name:
    // the plate's mid-height seam ran straight through the labels at this size.
    //
    // The padding is asymmetric and generous on purpose. The plate's gold corner
    // ornaments eat far more width than its measured 16px nine-slice inset — the
    // nine-slice draws them at natural size and the silhouette metric cannot see
    // decoration at all — so the longest label ("Carthago (beat Massilia)") ran
    // straight across the rivets until the horizontal padding was raised.
    const padX = 92;
    const padY = 30;
    const gridW = btnW + (cols - 1) * gapX + padX * 2;
    const gridH = (rows - 1) * rowH + btnH + padY * 2;
    const gridCy = topY + ((rows - 1) * rowH) / 2;
    if (!addChromePlate(this, CHROME_PANEL_KEY, x, gridCy, gridW, gridH)) {
      this.add
        .rectangle(x, gridCy, gridW, gridH, this.theme.panel, 1)
        .setStrokeStyle(2, this.theme.panelStroke);
    }

    CITIES.forEach((city, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = x - ((cols - 1) * gapX) / 2 + col * gapX;
      const by = topY + row * rowH;
      const unlocked = isCityUnlocked(this.gameState, city.id);
      const selected = city.id === this.selectedCityId;
      // No "(beat X)" suffix: it pushed the longest labels out over the panel's gold
      // corner ornaments. The unlock requirement is now only in `cityUnlockRequirement`
      // (add a hover tooltip if that hint is wanted back).
      const label = selected ? `★ ${city.name}` : city.name;
      const opts: ButtonOpts = {
        width: btnW,
        height: btnH,
        fontSize: portrait ? 18 : 19,
        bare: true,
        // Gold reads against the red panel; the default cream goes muddy on it.
        textColor: '#f2d98c',
      };
      // The selected city is the one driving shop/coliseum power, so it keeps the
      // star AND a deeper gold — the only distinction left with no plate to tint.
      if (selected) opts.textColor = '#e8b84b';
      // A locked city gets a deliberate warm grey rather than dimmed gold: at a low
      // alpha gold on the dark red panel just reads as muddy brown and fails contrast.
      if (!unlocked) opts.textColor = '#b8aa94';
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
    // The ornate raster plate when it is loaded, else the drawn panel — so the hub
    // still renders if the PNG is missing or still in flight.
    if (!addChromePlate(this, CHROME_PANEL_KEY, cx, cy, width, height)) {
      this.add
        .rectangle(cx, cy, width, height, this.theme.panel, 1)
        .setStrokeStyle(2, this.theme.panelStroke);
    }
    items.forEach((item, i) => {
      const by = cy - height / 2 + pad + itemH / 2 + i * itemH;
      if (i > 0) {
        this.add.rectangle(cx, by - itemH / 2, width - 10, 1, this.theme.panelStroke, 0.6);
      }
      this.button(cx, by, item.label, item.onClick, {
        width: width - 16,
        height: itemH - 6,
        fontSize,
        // The panel behind the whole list is the background; a plate per word would
        // fight it (and its art cuts through the label).
        bare: true,
        // Gold, not the default cream: these words sit on the RED panel, and gold
        // is both higher contrast against it and a match for the panel's trim.
        textColor: '#f2d98c',
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
