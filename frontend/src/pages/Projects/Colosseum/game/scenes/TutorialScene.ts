import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { setState } from '../state/store';

const STEPS = [
  {
    title: 'Welcome to Colosseum',
    body: 'You run a school of gladiators. Recruit fighters, equip them, train them, and climb the arena ladder.',
  },
  {
    title: 'Train & Skills',
    body: 'Spend attribute points to raise stats, and skill points in your weapon-style tree to unlock techniques.',
  },
  {
    title: 'The World Map',
    body: 'Travel between cities. Each has a coliseum, shop, slave market, blacksmith, and infirmary. Win fights to earn fame and unlock the next city.',
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
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#120e0a');
    const { width, height } = this.scale;
    const step = STEPS[this.step];

    this.header('TUTORIAL');
    addText(this, width / 2, 130, `${this.step + 1} / ${STEPS.length}`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
    addText(this, width / 2, 230, step.title, {
      fontSize: '30px',
      color: '#e8b84b',
      fontStyle: 'bold',
    });
    addText(this, width / 2, 320, step.body, { fontSize: '20px', wordWrap: { width: 720 } });

    const bottom = height - 80;
    const isLast = this.step === STEPS.length - 1;
    if (this.step > 0) {
      this.button(width / 2 - 180, bottom, 'BACK', () => {
        this.step -= 1;
        this.render();
      }, { width: 150, height: 52, fontSize: 20 });
    }
    this.button(width / 2, bottom, 'SKIP', () => this.finish(), { width: 100, height: 44, fontSize: 16 });
    this.button(width / 2 + 180, bottom, isLast ? 'START' : 'NEXT', () => this.next(), {
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
