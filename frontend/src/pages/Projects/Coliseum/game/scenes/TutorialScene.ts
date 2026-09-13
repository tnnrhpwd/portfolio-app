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
    body: 'Spend attribute points to raise stats, and skill points to unlock techniques — any fighter can learn any skill.',
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

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const step = STEPS[this.step];
    const portrait = this.portrait;

    this.header('TUTORIAL');
    announce(`${step.title}. ${step.body}`);
    addText(this, this.cx, portrait ? 190 : 130, `${this.step + 1} / ${STEPS.length}`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
    addText(this, this.cx, portrait ? 330 : 230, step.title, {
      fontSize: portrait ? '34px' : '30px',
      color: '#e8b84b',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: this.w - 60 },
    });
    addText(this, this.cx, portrait ? 460 : 320, step.body, {
      fontSize: '20px',
      align: 'center',
      wordWrap: { width: Math.max(260, this.w - (portrait ? 100 : 60)) },
    });

    // The tall box stacks the three controls — at 720px a BACK/SKIP/NEXT row
    // would collide, and stacking also puts every action within thumb reach.
    const bottom = this.h - (portrait ? 130 : 80);
    const isLast = this.step === STEPS.length - 1;
    const backY = portrait ? bottom - 160 : bottom;
    const skipY = portrait ? bottom - 80 : bottom;
    const nextY = bottom;
    if (this.step > 0) {
      this.button(this.cx, backY, 'BACK', () => {
        this.step -= 1;
        this.render();
      }, { width: portrait ? 260 : 150, height: 52, fontSize: 20 });
    }
    this.button(this.cx, skipY, 'SKIP', () => this.finish(), {
      width: portrait ? 260 : 100,
      height: 44,
      fontSize: 16,
    });
    this.button(this.cx, nextY, isLast ? 'START' : 'NEXT', () => this.next(), {
      width: portrait ? 260 : 150,
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
