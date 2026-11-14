// Bowlers and the balls they bowl.
import { G, BALL_R, PITCH, STUMPS, SUBSTEP } from './config.js';
import { clamp } from './rng.js';

const E_PITCH = 0.62;

export const BOWLERS = {
  rookie: { name: 'Chintu', style: 'Gentle medium', speed: [12.5, 14.5], types: { stock: 7, full: 2, slower: 1 }, spread: 0.24, swing: 0, spin: 0, marker: true, shirt: '#3d9be9' },
  medium: { name: 'Bunty', style: 'Medium pace', speed: [14, 16.5], types: { stock: 5, full: 2, yorker: 1, short: 1, slower: 1 }, spread: 0.3, swing: 0.8, spin: 0, marker: true, shirt: '#f2b134' },
  swing: { name: 'Guddu', style: 'Swing', speed: [14.5, 17], types: { inswing: 4, outswing: 4, stock: 1, yorker: 1 }, spread: 0.3, swing: 2.6, spin: 0, marker: true, shirt: '#57b894' },
  spin: { name: 'Pappu', style: 'Spin', speed: [10.2, 12.2], types: { offspin: 4, legspin: 4, stock: 1, slower: 1 }, spread: 0.28, swing: 0, spin: 1.7, marker: true, shirt: '#b784d6' },
  fast: { name: 'Rocket Raju', style: 'Express pace', speed: [17.5, 20.5], types: { stock: 4, yorker: 2, short: 2, slower: 2, full: 1 }, spread: 0.3, swing: 0.6, spin: 0, marker: false, shirt: '#e45b4f' },
  mixed: { name: 'Tillu', style: 'Bag of tricks', speed: [13, 19], types: { stock: 2, inswing: 2, outswing: 2, offspin: 1, legspin: 1, yorker: 2, short: 1, slower: 2 }, spread: 0.32, swing: 2.2, spin: 1.5, marker: false, shirt: '#f08a4b' },
  ace: { name: 'Bhaiya', style: 'The big brother', speed: [17, 22], types: { stock: 2, inswing: 2, outswing: 2, yorker: 3, short: 2, slower: 3 }, spread: 0.27, swing: 2.8, spin: 1.2, marker: false, shirt: '#3a3f58' }
};

const LENGTHS = {
  yorker: [0.95, 1.6],
  full: [2.0, 3.2],
  stock: [3.4, 5.4],
  short: [6.4, 7.8]
};

// Advances a ball that is still on its way to the batter. Returns true on a bounce.
export function stepDelivery(b, d, dt) {
  if (b.bounces === 0) b.vx += d.swingAx * dt;
  b.vy -= G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y < BALL_R && b.vy < 0) {
    b.y = BALL_R;
    b.vy = -b.vy * E_PITCH;
    b.vz *= 0.92;
    b.vx *= 0.92;
    if (b.bounces === 0) b.vx += d.spinDv;
    b.bounces++;
    return true;
  }
  return false;
}

export function makeDelivery(rng, bowler, speedScale = 1) {
  const type = rng.weighted(bowler.types);
  const spinner = type === 'offspin' || type === 'legspin';
  let speed = rng.range(bowler.speed[0], bowler.speed[1]) * speedScale;
  if (type === 'slower') speed = Math.max(speed * 0.68, 9.5);
  if (spinner && bowler.speed[1] > 13) speed = rng.range(10.5, 12.5);

  const lengthKey = LENGTHS[type] ? type : type === 'slower' ? 'stock' : spinner ? 'full' : 'stock';
  const range = spinner ? [2.6, 4.4] : LENGTHS[lengthKey];
  const bounceZ = rng.range(range[0], range[1]);
  const bounceX = clamp(rng.gauss() * bowler.spread, -1.25, 1.25);

  const rx = 0.45 + rng.range(-0.15, 0.15);
  const ry = PITCH.releaseY;
  const rz = PITCH.releaseZ;

  let swingAx = 0;
  if (type === 'inswing') swingAx = -bowler.swing * rng.range(0.8, 1.15);
  else if (type === 'outswing') swingAx = bowler.swing * rng.range(0.8, 1.15);
  else if (bowler.swing && !spinner) swingAx = bowler.swing * rng.range(-0.3, 0.3);

  let spinDv = 0;
  if (type === 'offspin') spinDv = -bowler.spin * rng.range(0.7, 1.2);
  else if (type === 'legspin') spinDv = bowler.spin * rng.range(0.7, 1.2);

  const t1 = (rz - bounceZ) / speed;
  const d = {
    type, speed, rx, ry, rz, swingAx, spinDv,
    vx: (bounceX - rx - 0.5 * swingAx * t1 * t1) / t1,
    vy: (BALL_R - ry + 0.5 * G * t1 * t1) / t1,
    vz: -speed,
    bounceX, bounceZ, marker: bowler.marker
  };

  // Fly the ball once in advance to learn when and where it reaches the batter.
  const b = { x: rx, y: ry, z: rz, vx: d.vx, vy: d.vy, vz: d.vz, bounces: 0 };
  let t = 0;
  d.tIdeal = null;
  d.tStumps = null;
  while (t < 4) {
    const pz = b.z;
    stepDelivery(b, d, SUBSTEP);
    t += SUBSTEP;
    if (d.tIdeal === null && b.z <= PITCH.idealZ) {
      d.tIdeal = t;
      d.contactX = b.x;
      d.contactY = b.y;
    }
    if (pz > 0 && b.z <= 0) d.creaseX = b.x;
    if (b.z <= PITCH.stumpsZ) {
      d.tStumps = t;
      d.hitsStumps = Math.abs(b.x) <= STUMPS.halfW + BALL_R * 0.5 && b.y <= STUMPS.h + BALL_R;
      break;
    }
  }
  if (d.tIdeal === null) d.tIdeal = t;
  if (d.tStumps === null) d.tStumps = d.tIdeal + 0.08;
  return d;
}
