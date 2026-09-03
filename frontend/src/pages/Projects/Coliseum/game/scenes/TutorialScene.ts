import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { setState } from '../state/store';
import { announce } from '../accessibility';

const STEPS = [
  {
    title: 'Welcome to Coliseum',
    body: 'You run a school of gladiators. Recruit fighters, equip them, train them, and climb the arena ladder.',
  },
  {
    title: 'Train & Skills',
    body: 'Spend attribute points to raise stats, and skill points in your weapon-style tree to unlock techniques.',
  },
  {
    title: 'The World Map',
    body: 'Travel between cities. Each has a coliseum, shop, recruit, blacksmith, and infirmary. Win fights to earn fame and unlock the next city.',
  },
  {
    title: 'Combat',
    body: 'In the arena, pick an attack strength and a body part. Destroy the head or torso to win. Restore MP with Crowd Appeal, or strike with techniques.',
  },
  {
    title: 'Good luck',
    body: 'Heal between fights at the infirmary, and spare or execute fallen foes after a win.',
  },
];

export class TutorialScene extends BaseScene {
  private step = 0;

  constructor() {
    super('Tutorial');
  }

  create(): void {
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const step = STEPS[this.step];
    const compact = this.compact;

    this.header('TUTORIAL');
    announce(`${step.title}. ${step.body}`);
    addText(this, this.cx, 130, `${this.step + 1} / ${STEPS.length}`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
    addText(this, this.cx, compact ? 210 : 230, step.title, {
      fontSize: '30px',
      color: '#e8b84b',
      fontStyle: 'bold',
    });
    addText(this, this.cx, compact ? 300 : 320, step.body, {
      fontSize: '20px',
      wordWrap: { width: Math.max(260, this.w - 60) },
    });

    const bottom = this.h - 80;
    const isLast = this.step === STEPS.length - 1;
    const backY = compact ? bottom - 120 : bottom;
    const skipY = compact ? bottom - 60 : bottom;
    const nextY = bottom;
    if (this.step > 0) {
      this.button(compact ? this.cx : this.cx - 180, backY, 'BACK', () => {
        this.step -= 1;
        this.render();
      }, { width: 150, height: 52, fontSize: 20 });
    }
    this.button(compact ? this.cx : this.cx, skipY, 'SKIP', () => this.finish(), {
      width: 100,
      height: 44,
      fontSize: 16,
    });
    this.button(compact ? this.cx : this.cx + 180, nextY, isLast ? 'START' : 'NEXT', () => this.next(), {
      width: 150,
      height: 52,
      fontSize: 20,
    });
  }

  private next(): void {
    if (this.step >= STEPS.length - 1) {
      this.finish();
      return;
    }
    this.step += 1;
    this.render();
  }

  private finish(): void {
    setState({ ...this.gameState, tutorialSeen: true });
    this.scene.start('Main');
  }
}
