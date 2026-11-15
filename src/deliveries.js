// Bowlers and the balls they bowl. `wide` and `noBall` are each bowler's chance of an extra per ball.
import { G, BALL_R, PITCH, STUMPS, SUBSTEP } from './config.js';
import { clamp } from './rng.js';

const E_PITCH = 0.62;

export const BOWLERS = {
  rookie: { wide: 0.05, noBall: 0.03, name: 'Chintu', style: 'Gentle medium', speed: [12.5, 14.5], types: { stock: 7, full: 2, slower: 1 }, spread: 0.24, swing: 0, spin: 0, marker: true, shirt: '#3d9be9' },
  medium: { wide: 0.045, noBall: 0.03, name: 'Bunty', style: 'Medium pace', speed: [14, 16.5], types: { stock: 5, full: 2, yorker: 1, short: 1, slower: 1 }, spread: 0.3, swing: 0.8, spin: 0, marker: true, shirt: '#f2b134' },
  swing: { wide: 0.06, noBall: 0.03, name: 'Guddu', style: 'Swing', speed: [14.5, 17], types: { inswing: 4, outswing: 4, stock: 1, yorker: 1 }, spread: 0.3, swing: 2.6, spin: 0, marker: true, shirt: '#57b894' },
  spin: { wide: 0.04, noBall: 0.02, name: 'Pappu', style: 'Spin', speed: [10.2, 12.2], types: { offspin: 4, legspin: 4, stock: 1, slower: 1 }, spread: 0.28, swing: 0, spin: 1.7, marker: true, shirt: '#b784d6' },
  fast: { wide: 0.06, noBall: 0.06, name: 'Rocket Raju', style: 'Express pace', speed: [17.5, 20.5], types: { stock: 4, yorker: 2, short: 2, slower: 2, full: 1 }, spread: 0.3, swing: 0.6, spin: 0, marker: false, shirt: '#e45b4f' },
  mixed: { wide: 0.055, noBall: 0.04, name: 'Tillu', style: 'Bag of tricks', speed: [13, 19], types: { stock: 2, inswing: 2, outswing: 2, offspin: 1, legspin: 1, yorker: 2, short: 1, slower: 2 }, spread: 0.32, swing: 2.2, spin: 1.5, marker: false, shirt: '#f08a4b' },
  ace: { wide: 0.035, noBall: 0.03, name: 'Bhaiya', style: 'The big brother', speed: [17, 22], types: { stock: 2, inswing: 2, outswing: 2, yorker: 3, short: 2, slower: 3 }, spread: 0.27, swing: 2.8, spin: 1.2, marker: false, shirt: '#3a3f58' }
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
  let bounceX = clamp(rng.gauss() * bowler.spread, -1.25, 1.25);

  const rx = 0.45 + rng.range(-0.15, 0.15);
  const ry = PITCH.releaseY;
  let rz = PITCH.releaseZ;

  let swingAx = 0;
  if (type === 'inswing') swingAx = -bowler.swing * rng.range(0.8, 1.15);
  else if (type === 'outswing') swingAx = bowler.swing * rng.range(0.8, 1.15);
  else if (bowler.swing && !spinner) swingAx = bowler.swing * rng.range(-0.3, 0.3);

  let spinDv = 0;
  if (type === 'offspin') spinDv = -bowler.spin * rng.range(0.7, 1.2);
  else if (type === 'legspin') spinDv = bowler.spin * rng.range(0.7, 1.2);

  // Extras. They are decided last so the rest of the delivery does not depend on them.
  const wideBall = rng.chance(bowler.wide ?? 0.04);
  const noBall = rng.chance(bowler.noBall ?? 0.03);
  // Where a wide should cross the crease: mostly outside off stump (the +x side for a
  // right-hander), sometimes down the leg side. Off-side wides stay close enough that a
  // batter who shuffles across can still reach them.
  const wideX = rng.chance(0.7) ? rng.range(1.12, 1.5) : -rng.range(1.1, 1.3);
  if (wideBall) { bounceX = wideX * 0.8; spinDv = 0; swingAx *= 0.3; }
  if (noBall) rz -= 0.45;   // the bowler has overstepped, so the ball is released closer

  const t1 = (rz - bounceZ) / speed;
  const d = {
    type, speed, rx, ry, rz, swingAx, spinDv,
    vx: 0,
    vy: (BALL_R - ry + 0.5 * G * t1 * t1) / t1,
    vz: -speed,
    bounceX, bounceZ, marker: bowler.marker, wideBall, noBall
  };
  const aim = () => { d.vx = (d.bounceX - rx - 0.5 * swingAx * t1 * t1) / t1; fly(d); };
  aim();
  // Moving the bounce point sideways moves the ball further than that by the time it
  // reaches the crease, so corrections are scaled down by this factor.
  const k = (rz - bounceZ) / rz;
  if (wideBall) {
    // Nudge the bounce point until the ball crosses the crease where it was meant to.
    for (let i = 0; i < 6 && Math.abs(wideX - d.creaseX) > 0.02; i++) { d.bounceX += (wideX - d.creaseX) * k; aim(); }
  } else {
    // Every other ball must stay inside the wide lines, however much it swings or turns.
    for (let i = 0; i < 6 && Math.abs(d.creaseX) > 0.9; i++) { d.bounceX -= (d.creaseX - Math.sign(d.creaseX) * 0.86) * k; aim(); }
  }
  return d;
}

// Flies the ball once in advance to learn when and where it reaches the batter.
function fly(d) {
  const b = { x: d.rx, y: d.ry, z: d.rz, vx: d.vx, vy: d.vy, vz: d.vz, bounces: 0 };
  let t = 0;
  d.tIdeal = null;
  d.tStumps = null;
  d.creaseX = undefined;
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
}
