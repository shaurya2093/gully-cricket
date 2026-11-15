// Plays many simulated matches with bots of different skill to tune targets and medals.
// Run with: node tools/calibrate.mjs
import { Match, dailyConfig, LEVELS, chaseConfig, survivalConfig, superOverConfig } from '../src/modes.js';
import { TIMING } from '../src/config.js';
import { RNG } from '../src/rng.js';

export const BOTS = {
  novice: { sigma: 0.07, loft: 0.2, spread: 0.6, miss: 0.08 },
  casual: { sigma: 0.05, loft: 0.35, spread: 0.4, miss: 0.04 },
  good: { sigma: 0.035, loft: 0.45, spread: 0.25, miss: 0.02 },
  expert: { sigma: 0.022, loft: 0.6, spread: 0.12, miss: 0.01 }
};

export function playBall(match, bot, rng) {
  const play = match.nextPlay('R');
  const d = play.d;
  const skip = rng.chance(bot.miss);
  const tap = d.tIdeal - TIMING.lag + rng.gauss() * bot.sigma;
  // on a free hit there is nothing to lose, so every bot goes for the big shot
  const loft = rng.chance(bot.loft) || play.freeHit;
  const aim = loft ? rng.gauss() * bot.spread * 0.5 : rng.gauss() * bot.spread;
  let guard = 0;
  while (play.phase !== 'done' && guard++ < 3000) {
    if (!skip && !play.swing && play.t >= tap) play.swingAt(aim, loft);
    play.step(1 / 60);
  }
  return play.outcome;
}

export function playMatch(cfg, bot, rng, maxBalls = 600) {
  const m = new Match(cfg);
  let n = 0;
  while (!m.finished && n++ < maxBalls) {
    const o = playBall(m, bot, rng);
    const r = m.apply(o);
    if (r.overDone) m.startNewOver();
  }
  return m;
}

function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return `mean ${mean.toFixed(1)}  p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  max ${s[s.length - 1]}`;
}

if ((process.argv[1] || '').endsWith('calibrate.mjs')) {
  const N = 300;
  console.log('DAILY (24 balls, 3 wickets)');
  for (const [name, bot] of Object.entries(BOTS)) {
    const rng = new RNG(99);
    const runs = [], outs = {}, per = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 6: 0 };
    let allOut = 0, balls = 0;
    for (let i = 0; i < N; i++) {
      const m = playMatch(dailyConfig(i), bot, rng);
      runs.push(m.runs);
      if (m.reason === 'allout') allOut++;
      for (const e of m.log) {
        balls++;
        if (e.out) outs[e.out] = (outs[e.out] || 0) + 1; else per[e.runs] = (per[e.runs] || 0) + 1;
      }
    }
    const pct = (v) => ((100 * v) / balls).toFixed(1) + '%';
    console.log(`  ${name.padEnd(7)} ${stats(runs)}  allout ${((100 * allOut) / N).toFixed(0)}%`);
    console.log('          runs ' + Object.entries(per).map(([k, v]) => `${k}:${pct(v)}`).join(' ') + '  outs ' + Object.entries(outs).map(([k, v]) => `${k}:${pct(v)}`).join(' '));
  }
  console.log('\nCHASE win rates (novice / casual / good / expert)');
  LEVELS.forEach((L, i) => {
    const row = Object.values(BOTS).map((bot) => {
      const rng = new RNG(7 + i);
      let wins = 0;
      for (let k = 0; k < 150; k++) {
        const cfg = chaseConfig(i); cfg.seed = k * 31 + i;
        if (playMatch(cfg, bot, rng).reason === 'won') wins++;
      }
      return String(Math.round((100 * wins) / 150)).padStart(3) + '%';
    });
    console.log(`  ${String(i + 1).padStart(2)} ${L.name.padEnd(16)} need ${String(L.need).padStart(2)} off ${String(L.balls).padStart(2)}  ${row.join(' ')}`);
  });
  console.log('\nSURVIVAL');
  for (const [name, bot] of Object.entries(BOTS)) {
    const rng = new RNG(5);
    const runs = [];
    for (let i = 0; i < 150; i++) { const cfg = survivalConfig(); cfg.seed = i; runs.push(playMatch(cfg, bot, rng).runs); }
    console.log(`  ${name.padEnd(7)} ${stats(runs)}`);
  }
  console.log('\nSUPER OVER (6 balls, 2 wickets)');
  for (const [name, bot] of Object.entries(BOTS)) {
    const rng = new RNG(9);
    const runs = [];
    for (let i = 0; i < 600; i++) runs.push(playMatch(superOverConfig(1000 + i), bot, rng).runs);
    const share = (n) => Math.round((100 * runs.filter((r) => r >= n).length) / runs.length) + '%';
    console.log(`  ${name.padEnd(7)} ${stats(runs)}  24+: ${share(24)}  36: ${share(36)}`);
  }
}
