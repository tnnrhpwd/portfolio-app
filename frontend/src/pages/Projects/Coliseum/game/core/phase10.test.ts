import {
  createFighter,
  currentHp,
  initTurnQueue,
  mulberry32,
  nextActor,
  stepTurn,
  turnInterval,
  type Fighter,
} from './index';

/** Simulates `count` turns, recording P (player) / E (enemy) for each actor. */
function simulateOrder(players: Fighter[], enemies: Fighter[], count: number): string[] {
  let p = players;
  let e = enemies;
  let queue = initTurnQueue(p, e);
  const order: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const actor = nextActor(p, e, queue);
    if (!actor) break;
    order.push(actor.side === 'player' ? 'P' : 'E');
    const result = stepTurn(p, e, queue, { kind: 'pass' }, mulberry32(1));
    p = result.playerTeam;
    e = result.enemyTeam;
    queue = result.queue;
  }
  return order;
}

describe('speed-weighted turn queue', () => {
  it('gives faster fighters a shorter wait between turns', () => {
    const fast = createFighter({ style: 'murmillo' });
    fast.attributes.speed = 515;
    const slow = createFighter({ style: 'murmillo' });
    slow.attributes.speed = 10;
    expect(turnInterval(fast)).toBeLessThan(turnInterval(slow));
  });

  it('seeds every living fighter with a next-action time', () => {
    const p1 = createFighter({ style: 'murmillo' });
    const p2 = createFighter({ style: 'murmillo' });
    const e1 = createFighter({ style: 'murmillo', level: 1 });
    const queue = initTurnQueue([p1, p2], [e1]);
    expect(queue[p1.id]).toBeGreaterThan(0);
    expect(queue[p2.id]).toBeGreaterThan(0);
    expect(queue[e1.id]).toBeGreaterThan(0);
  });

  it('picks the fastest fighter to act first', () => {
    const fast = createFighter({ style: 'murmillo' });
    fast.attributes.speed = 515;
    const slow = createFighter({ style: 'murmillo', level: 1 });
    slow.attributes.speed = 10;
    const queue = initTurnQueue([slow], [fast]);
    expect(nextActor([slow], [fast], queue)?.fighter.id).toBe(fast.id);
  });

  it('resolves a single action immediately and advances the actor in the queue', () => {
    const fast = createFighter({ style: 'murmillo' });
    fast.attributes.speed = 515;
    fast.attributes.strength = 50;
    fast.attributes.dexterity = 500;
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    const queue = initTurnQueue([fast], [enemy]);
    const before = currentHp(enemy);
    const result = stepTurn(
      [fast],
      [enemy],
      queue,
      { kind: 'attack', precision: 'medium', targetId: enemy.id, targetZone: 'torso' },
      mulberry32(2),
    );
    expect(result.actorId).toBe(fast.id);
    expect(currentHp(result.enemyTeam[0])).toBeLessThan(before);
    expect(result.queue[fast.id]).toBeGreaterThan(queue[fast.id]);
  });

  it('lets a much faster fighter act twice before a slower opponent once', () => {
    const fast = createFighter({ style: 'murmillo' });
    fast.attributes.speed = 515;
    fast.attributes.defense = 500;
    const slow = createFighter({ style: 'murmillo' });
    slow.attributes.speed = 197;
    // 515 vs 197 matches the reference's "two turns before one" threshold.
    expect(simulateOrder([fast], [slow], 3)).toEqual(['P', 'P', 'E']);
  });

  it('produces a deterministic turn sequence for a fixed seed', () => {
    const a = createFighter({ style: 'murmillo' });
    a.attributes.speed = 300;
    const b = createFighter({ style: 'murmillo' });
    b.attributes.speed = 120;
    const c = createFighter({ style: 'murmillo' });
    c.attributes.speed = 90;
    const d = createFighter({ style: 'murmillo' });
    d.attributes.speed = 75;
    const first = simulateOrder([a, b], [c, d], 8);
    const second = simulateOrder([a, b], [c, d], 8);
    expect(first).toEqual(second);
    expect(first.length).toBe(8);
  });
});
