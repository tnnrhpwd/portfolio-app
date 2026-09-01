import React, { useEffect, useRef } from 'react';
import { effectiveStats } from './colosseumEngine';

/**
 * ArenaCanvas — an animated, Flash-style side-view arena rendered on <canvas>.
 *
 * It draws vector gladiators (no external sprites, so the art is fully
 * original), animates the previous round's combat events (lunges, hit flashes,
 * floating damage numbers, screen shake, falls), and keeps everyone idling
 * between rounds.
 *
 * The parent remounts this component (via a React `key`) each time a new
 * round's events should be played, so the props are always fresh at mount.
 */

const W = 960;
const H = 540;
const GROUND_Y = 410;

const PLAYER_SLOTS = [170, 330, 490];
const ENEMY_SLOTS = [790, 630, 470];

const PALETTE = {
  murmillo: { cloth: '#4a7fb5', armor: '#2f4d6f', trim: '#e6b34a', weapon: 'sword', shield: 'big' },
  retiarius: { cloth: '#2fa8a0', armor: '#1f6f6a', trim: '#d9e6e6', weapon: 'trident', shield: 'none' },
  thraex: { cloth: '#c04b3c', armor: '#7a2f26', trim: '#e8c15a', weapon: 'sica', shield: 'small' },
  secutor: { cloth: '#7a5aa8', armor: '#4d3670', trim: '#e8e8e8', weapon: 'sword', shield: 'big' },
  hoplomachus: { cloth: '#4f9d55', armor: '#356b39', trim: '#d9a23c', weapon: 'spear', shield: 'round' },
};

// Equipment tiers change the drawn weapon/armor (color + size).
const WEAPON_TIER_STYLE = {
  w0: { color: null, length: 0 },
  w1: { color: '#cd7f32', length: 26 },
  w2: { color: '#8a8a92', length: 34 },
  w3: { color: '#c8d2dc', length: 40 },
  w4: { color: '#e8f7ff', length: 40, glow: '#7fd4ff' },
};

const ARMOR_TIER_STYLE = {
  a0: null,
  a1: { color: '#8a5a2b' },
  a2: { color: '#9aa0a8', chain: true },
  a3: { color: '#c0c8d0', banded: true },
  a4: { color: '#d7f0ff', glow: '#7fd4ff' },
};

const EVENT_DURATION = {
  attack: 520,
  skill: 760,
  defend: 420,
  rest: 520,
  stun: 420,
  slow: 420,
  selfDamage: 460,
  reflect: 460,
  death: 700,
};

function durFor(event) {
  if (event.kind === 'attack') return event.label === 'heavy' ? 680 : EVENT_DURATION.attack;
  return EVENT_DURATION[event.kind] || 400;
}

function buildLayout(players, enemies) {
  const map = {};
  players.forEach((g, i) => {
    map[g.id] = { fighter: g, side: 'player', x: PLAYER_SLOTS[i % 3], y: GROUND_Y };
  });
  enemies.forEach((g, i) => {
    map[g.id] = { fighter: g, side: 'enemy', x: ENEMY_SLOTS[i % 3], y: GROUND_Y };
  });
  return map;
}

function createInitialState(players, enemies, events, round) {
  return {
    players,
    enemies,
    round,
    layout: buildLayout(players, enemies),
    queue: Array.isArray(events) ? [...events] : [],
    current: null,
    time: 0,
    shake: 0,
    particles: [],
    floaters: [],
  };
}

export default function ArenaCanvas({ playerTeam, enemyTeam, events, round = 0 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  if (!stateRef.current) {
    stateRef.current = createInitialState(playerTeam, enemyTeam, events, round);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let last = performance.now();

    const loop = (now) => {
      const dt = Math.min(50, now - last);
      last = now;
      const st = stateRef.current;
      update(st, dt);
      draw(ctx, st);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="col-arena-canvas"
      width={W}
      height={H}
      role="img"
      aria-label="Animated gladiator arena"
    />
  );
}

// ── Simulation update ──────────────────────────────────────────────────────
function update(st, dt) {
  st.time += dt;
  st.shake = Math.max(0, st.shake - dt * 0.05);
  st.particles = st.particles.filter((p) => (p.life -= dt) > 0);
  st.floaters = st.floaters.filter((f) => (f.life -= dt) > 0);
  st.floaters.forEach((f) => {
    f.y -= dt * 0.045;
  });
  st.particles.forEach((p) => {
    p.x += p.vx * (dt / 16);
    p.y += p.vy * (dt / 16);
    p.vy += 0.12 * (dt / 16);
  });

  if (!st.current && st.queue.length) {
    const event = st.queue.shift();
    st.current = { event, t: 0, dur: durFor(event), fired: false };
  }

  if (st.current) {
    const c = st.current;
    c.t += dt;
    if (!c.fired && c.t >= c.dur * 0.45) {
      c.fired = true;
      fireEvent(st, c.event);
    }
    if (c.t >= c.dur) {
      st.current = null;
    }
  }
}

function fireEvent(st, event) {
  const pos = (id) => st.layout[id];

  switch (event.kind) {
    case 'attack': {
      const target = pos(event.targetId);
      if (target) {
        if (event.miss) {
          spawnFloater(st, target.x, target.y - 140, 'MISS', '#d9d9d9');
        } else {
          spawnFloater(st, target.x, target.y - 140, `-${event.damage}`, event.crit ? '#ffd23f' : '#ff6b5e');
          st.shake = Math.min(24, 6 + event.damage * 0.5 + (event.crit ? 10 : 0) + (event.label === 'heavy' ? 6 : 0));
          spawnSparks(st, target.x, target.y - 80, event.crit ? 18 : 10, '#ffb347');
          if (event.label === 'skill') {
            const attacker = pos(event.actorId);
            if (attacker) spawnFloater(st, attacker.x, attacker.y - 150, '★', '#ffd23f');
          }
        }
      }
      break;
    }
    case 'selfDamage': {
      const actor = pos(event.actorId);
      if (actor) spawnFloater(st, actor.x, actor.y - 140, `-${event.amount}`, '#ff9d5c');
      break;
    }
    case 'reflect': {
      const actor = pos(event.targetId);
      if (actor) {
        spawnFloater(st, actor.x, actor.y - 140, `-${event.damage}`, '#7fd4ff');
        spawnSparks(st, actor.x, actor.y - 80, 8, '#7fd4ff');
      }
      break;
    }
    case 'rest': {
      const actor = pos(event.actorId);
      if (actor) spawnFloater(st, actor.x, actor.y - 150, `+${event.healed}`, '#6ee37e');
      break;
    }
    case 'death': {
      const target = pos(event.targetId);
      if (target) {
        spawnFloater(st, target.x, target.y - 150, 'KO', '#ff4444');
        spawnSparks(st, target.x, target.y - 60, 16, '#ff6b5e');
        st.shake = 12;
      }
      break;
    }
    case 'stun':
    case 'slow': {
      const target = pos(event.targetId);
      if (target) {
        spawnFloater(st, target.x, target.y - 150, event.kind === 'stun' ? '✦' : '⟳', '#ffd23f');
      }
      break;
    }
    default:
      break;
  }
}

function spawnFloater(st, x, y, text, color) {
  st.floaters.push({ x, y, text, color, life: 900 });
}

function spawnSparks(st, x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 5;
    st.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 2,
      life: 420 + Math.random() * 260,
      color,
      r: 1.5 + Math.random() * 2.5,
    });
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────
function draw(ctx, st) {
  ctx.clearRect(0, 0, W, H);

  // Screen shake
  ctx.save();
  if (st.shake > 0.3) {
    ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
  }

  drawArena(ctx, st.time);
  drawFighters(ctx, st);
  drawParticles(ctx, st);
  drawFloaters(ctx, st);
  if (st.round === 1 && st.time < 1000) drawFightSplash(ctx, st.time);

  ctx.restore();
}

function drawArena(ctx, time) {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#2b1c0e');
  sky.addColorStop(1, '#7a4a1e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  // Sun glow
  const sun = ctx.createRadialGradient(760, 90, 10, 760, 90, 220);
  sun.addColorStop(0, 'rgba(255, 214, 130, 0.55)');
  sun.addColorStop(1, 'rgba(255, 214, 130, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(500, 0, 460, 300);

  // Distant colosseum arches
  ctx.fillStyle = 'rgba(20, 12, 6, 0.55)';
  ctx.fillRect(0, GROUND_Y - 150, W, 150);
  for (let i = 0; i < 12; i++) {
    const ax = i * 90 + 20;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(ax, GROUND_Y - 130, 55, 110);
  }

  // Crowd dots (shimmer)
  for (let i = 0; i < 90; i++) {
    const cx = (i * 137) % W;
    const cy = GROUND_Y - 140 + ((i * 53) % 120);
    const tw = 0.5 + 0.5 * Math.sin(time * 0.01 + i);
    ctx.fillStyle = `rgba(240, 200, 150, ${0.25 + tw * 0.35})`;
    ctx.fillRect(cx, cy, 4, 4);
  }

  // Sand
  const sand = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  sand.addColorStop(0, '#d9a85a');
  sand.addColorStop(1, '#a9712f');
  ctx.fillStyle = sand;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Sand streaks
  ctx.strokeStyle = 'rgba(90, 55, 20, 0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const sx = (i * 173) % W;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y + 20 + (i % 3) * 30);
    ctx.lineTo(sx + 90, GROUND_Y + 60 + (i % 3) * 20);
    ctx.stroke();
  }
}

function drawFightSplash(ctx, time) {
  const p = Math.max(0, Math.min(1, time / 1000));
  const scale = p < 0.18 ? p / 0.18 : p > 0.82 ? (1 - p) / 0.18 : 1;
  ctx.save();
  ctx.translate(W / 2, H / 2 - 50);
  ctx.scale(Math.max(0.01, scale), Math.max(0.01, scale));
  ctx.font = 'bold 92px Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#5a2a00';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.strokeText('FIGHT!', 0, 0);
  ctx.fillText('FIGHT!', 0, 0);
  ctx.restore();
}

function drawFighters(ctx, st) {
  const lunge = currentLunge(st);
  const hitTargetId = hitTarget(st);
  const entries = Object.values(st.layout).sort((a, b) => a.x - b.x);

  entries.forEach((fig) => {
    const isDown = fig.fighter.hp <= 0;
    const lungeForMe = lunge && (lunge.actorId === fig.fighter.id || lunge.targetId === fig.fighter.id);
    drawFighter(ctx, fig, st.time, lungeForMe ? lunge : null, isDown, hitTargetId === fig.fighter.id);
  });
}

function currentLunge(st) {
  const c = st.current;
  if (!c) return null;
  const e = c.event;
  if (e.kind !== 'attack' || e.miss) return null;
  const p = c.t / c.dur;
  const f = p < 0.5 ? p / 0.5 : (1 - p) / 0.5; // 0 → 1 → 0
  return { actorId: e.actorId, targetId: e.targetId, f };
}

function hitTarget(st) {
  const c = st.current;
  if (!c) return null;
  const e = c.event;
  if (e.kind !== 'attack' || e.miss) return null;
  return c.t >= c.dur * 0.45 ? e.targetId : null;
}

function drawFighter(ctx, fig, time, lunge, isDown, flash) {
  const { fighter, side, x, y } = fig;
  const dir = side === 'player' ? 1 : -1;
  const pal = PALETTE[fighter.classKey] || PALETTE.murmillo;
  const stats = effectiveStats(fighter);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 34, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);

  if (isDown) {
    // Fallen body
    ctx.rotate(dir * -1.35);
    ctx.translate(0, -8);
    ctx.globalAlpha = 0.7;
    drawBody(ctx, pal, fighter, 0, 0, 0, dir);
    ctx.restore();
    drawNameplate(ctx, fig, stats);
    return;
  }

  const bob = Math.sin(time * 0.004 + x * 0.05) * 2.5;
  let lungeDx = 0;
  let weaponAngle = Math.sin(time * 0.003) * 0.08;

  if (lunge && lunge.actorId === fighter.id) {
    lungeDx = lunge.f * 64 * dir;
    weaponAngle = -1.1 * lunge.f;
  }
  // Small recoil when this fighter is the target of a strike
  let hitRecoil = 0;
  if (lunge && lunge.targetId === fighter.id && lunge.f > 0.5) {
    hitRecoil = -8 * (lunge.f - 0.5) * 2 * dir;
  }

  ctx.translate(lungeDx + hitRecoil, bob);
  drawBody(ctx, pal, fighter, 0, 0, weaponAngle, dir);

  // Status visuals
  if (fighter.status.stun > 0) drawStars(ctx, dir, 0, -130);
  if (fighter.status.slow > 0) drawSlow(ctx, dir, 0, -130);
  if (fighter.status.defending) drawShieldGlow(ctx, dir, 24, -60);
  if (fighter.status.counter) drawCounterIcon(ctx, dir, 24, -60);

  // Hit flash overlay
  if (flash) {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 130, 70, 0.55)';
    ctx.beginPath();
    ctx.arc(0, -64, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  drawNameplate(ctx, fig, stats);
}

function drawNameplate(ctx, fig, stats) {
  const { fighter, side, x, y } = fig;
  const hpPct = Math.max(0, Math.min(1, fighter.hp / stats.maxHp));
  const barW = 70;
  const bx = x - barW / 2;
  const by = y - 150;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - 2, by - 2, barW + 4, 10);
  const hue = hpPct > 0.5 ? 120 : hpPct > 0.25 ? 45 : 0;
  ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
  ctx.fillRect(bx, by, barW * hpPct, 6);

  ctx.font = 'bold 12px Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  const name = side === 'player' ? fighter.name : fighter.name;
  ctx.strokeText(name, x, y - 158);
  ctx.fillText(name, x, y - 158);
}

function drawBody(ctx, pal, fighter, ox, oy, weaponAngle, dir) {
  // (ox, oy) is feet-center; draw facing +x, mirrored by dir.
  const skin = '#e8b98a';
  const weaponStyle = WEAPON_TIER_STYLE[fighter.weaponId] || WEAPON_TIER_STYLE.w0;
  const armorStyle = ARMOR_TIER_STYLE[fighter.armorId] || ARMOR_TIER_STYLE.a0;
  ctx.save();
  ctx.scale(dir, 1);

  // Legs
  ctx.strokeStyle = pal.armor;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, -44); ctx.lineTo(-12, 0);
  ctx.moveTo(7, -44); ctx.lineTo(12, 0);
  ctx.stroke();

  // Torso (tunic)
  ctx.fillStyle = pal.cloth;
  ctx.beginPath();
  ctx.roundRect(-14, -80, 28, 42, 7);
  ctx.fill();
  // Belt / trim
  ctx.fillStyle = pal.trim;
  ctx.fillRect(-14, -46, 28, 6);
  // Chest armor (reflects equipped armor tier)
  drawChestArmor(ctx, armorStyle, pal);

  // Head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -96, 13, 0, Math.PI * 2);
  ctx.fill();
  // Helmet
  ctx.fillStyle = pal.armor;
  ctx.beginPath();
  ctx.arc(0, -96, 13, Math.PI * 0.8, Math.PI * 2.2);
  ctx.fill();
  // Crest
  ctx.fillStyle = pal.trim;
  ctx.beginPath();
  ctx.moveTo(-4, -108);
  ctx.quadraticCurveTo(0, -132, 6, -110);
  ctx.closePath();
  ctx.fill();

  // Weapon arm (back arm) + weapon
  ctx.strokeStyle = skin;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-4, -72);
  ctx.lineTo(8, -58);
  ctx.stroke();
  if (weaponStyle.color) {
    drawWeapon(ctx, pal.weapon, 8, -58, weaponAngle, weaponStyle);
  } else {
    // Bare fist
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(14, -56, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shield arm (front arm) + shield
  if (pal.shield !== 'none') {
    ctx.strokeStyle = skin;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(6, -74);
    ctx.lineTo(20, -60);
    ctx.stroke();
    drawShield(ctx, pal.shield, 22, -58);
  }

  ctx.restore();
}

function drawChestArmor(ctx, armorStyle, pal) {
  if (!armorStyle) {
    ctx.fillStyle = pal.armor;
    ctx.fillRect(-14, -80, 28, 14);
    return;
  }
  ctx.fillStyle = armorStyle.color;
  ctx.beginPath();
  ctx.roundRect(-15, -80, 30, 22, 6);
  ctx.fill();
  if (armorStyle.chain) {
    ctx.strokeStyle = '#5f656d';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const yy = -77 + i * 6;
      ctx.beginPath();
      for (let xx = -12; xx <= 12; xx += 6) {
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx + 4, yy + 3);
      }
      ctx.stroke();
    }
  }
  if (armorStyle.banded) {
    ctx.strokeStyle = '#8a929c';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 2; i++) {
      const yy = -77 + i * 7;
      ctx.beginPath();
      ctx.moveTo(-15, yy);
      ctx.lineTo(15, yy);
      ctx.stroke();
    }
  }
  if (armorStyle.glow) {
    ctx.strokeStyle = armorStyle.glow;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(-12, -62);
    ctx.lineTo(12, -62);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawWeapon(ctx, kind, x, y, angle, style) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.glow || style.color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const L = style.length || 30;

  switch (kind) {
    case 'sword': {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(L - 8, -2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(L - 8, -2); ctx.lineTo(L, -2); ctx.lineTo(L - 8, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'sica': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L * 0.5, -6, L, 8);
      ctx.stroke();
      break;
    }
    case 'trident': {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(L, -12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(L, -12); ctx.lineTo(L - 4, -22);
      ctx.moveTo(L, -12); ctx.lineTo(L + 8, -12);
      ctx.moveTo(L, -12); ctx.lineTo(L - 4, -4);
      ctx.stroke();
      break;
    }
    case 'spear': {
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(L, -16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(L, -16); ctx.lineTo(L + 8, -20); ctx.lineTo(L, -10);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawShield(ctx, kind, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#8a6b3a';
  ctx.strokeStyle = '#5e451f';
  ctx.lineWidth = 3;
  if (kind === 'big') {
    ctx.beginPath();
    ctx.roundRect(-8, -22, 18, 40, 8);
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'small') {
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'round') {
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawStars(ctx, dir, x, y) {
  ctx.save();
  ctx.translate(x * dir, y);
  ctx.fillStyle = '#ffd23f';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✦', 0, 0);
  ctx.restore();
}

function drawSlow(ctx, dir, x, y) {
  ctx.save();
  ctx.translate(x * dir, y + 14);
  ctx.strokeStyle = '#7fd4ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawShieldGlow(ctx, dir, x, y) {
  ctx.save();
  ctx.translate(x * dir, y);
  ctx.fillStyle = 'rgba(127, 212, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCounterIcon(ctx, dir, x, y) {
  ctx.save();
  ctx.translate(x * dir, y);
  ctx.fillStyle = '#ff9d5c';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚔', 0, 0);
  ctx.restore();
}

function drawParticles(ctx, st) {
  st.particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 500);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx, st) {
  st.floaters.forEach((f) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 500));
    ctx.font = 'bold 22px Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;
}
