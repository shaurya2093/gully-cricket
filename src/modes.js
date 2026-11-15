// Game modes and the running state of a match.
import { RNG, hashSeed } from './rng.js';
import { BOWLERS, makeDelivery } from './deliveries.js';
import { Play } from './sim.js';

const BOWLER_SPOT = { x: 0.5, z: 11.2, bowler: true, react: 0.42, speed: 4.4, skill: 0.75 };

// Fielder placements. The bowler is always added as the first fielder.
export const FIELDS = {
  spread: [{ x: -3.2, z: 12.5 }, { x: 3.3, z: 16.5 }, { x: -0.9, z: 25.5 }],
  straight: [{ x: -1.8, z: 21 }, { x: 1.9, z: 24.5 }, { x: 3.6, z: 12 }],
  ring: [{ x: -3.4, z: 9.5 }, { x: 3.4, z: 10.5 }, { x: 0.2, z: 19 }],
  deep: [{ x: -2.6, z: 24 }, { x: 2.6, z: 25.5 }, { x: 0, z: 18 }],
  packed: [{ x: -3.3, z: 11 }, { x: 3.3, z: 14 }, { x: -1.6, z: 22 }, { x: 1.7, z: 25.5 }],
  wall: [{ x: -2.9, z: 25 }, { x: 0, z: 26 }, { x: 2.9, z: 25 }, { x: 3.2, z: 12 }]
};

export function fieldFor(key, skill = 0.78) {
  return [{ ...BOWLER_SPOT }, ...FIELDS[key].map((f) => ({ ...f, skill }))];
}

export const DAILY = { balls: 24, wickets: 3, medals: { bronze: 32, silver: 53, gold: 74 } };

// 15 chases, each a little harder than the last.
export const LEVELS = [
  { name: 'First Evening', theme: 'day', need: 12, balls: 12, wickets: 3, bowlers: ['rookie'], field: 'ring', window: 1.3, tip: 'Tap as the ball arrives. Straight shots are safest.' },
  { name: 'Chai Break', theme: 'day', need: 22, balls: 12, wickets: 3, bowlers: ['rookie', 'medium'], field: 'spread', window: 1.25, tip: 'Turn on LOFT and hit straight over the far wall for six.' },
  { name: 'Tuition Bunk', theme: 'day', need: 24, balls: 12, wickets: 3, bowlers: ['medium'], field: 'spread', window: 1.2, tip: 'Shuffle across your crease with the arrow buttons (or Z and C) to reach wide balls.' },
  { name: 'Swing Uncle', theme: 'day', need: 26, balls: 12, wickets: 2, bowlers: ['swing'], field: 'ring', window: 1.15, tip: 'Swing bends the ball in the air. Watch it all the way.' },
  { name: 'Spin Trap', theme: 'dusk', need: 27, balls: 12, wickets: 2, bowlers: ['spin'], field: 'straight', window: 1.15, tip: 'Spin is slow. Wait for it.' },
  { name: 'Power Cut', theme: 'blackout', need: 40, balls: 18, wickets: 3, bowlers: ['medium', 'swing', 'spin'], field: 'deep', window: 1.1, tip: 'The lights are out. Deep fielders catch mistimed lofts, so keep it on the ground.' },
  { name: 'Rocket Raju', theme: 'day', need: 29, balls: 12, wickets: 2, bowlers: ['fast'], field: 'spread', window: 1.1, tip: 'No bounce marker against express pace.' },
  { name: 'Sunday Final', theme: 'day', need: 49, balls: 18, wickets: 3, bowlers: ['swing', 'fast', 'spin'], field: 'packed', window: 1.05, tip: 'Four fielders now. Find the gaps.' },
  { name: 'Monsoon Cup', theme: 'dusk', need: 34, balls: 12, wickets: 2, bowlers: ['mixed'], field: 'deep', window: 1.05, tip: 'Slower balls arrive late. Do not swing early.' },
  { name: 'Last Light', theme: 'dusk', need: 18, balls: 6, wickets: 1, bowlers: ['medium'], field: 'wall', window: 1.0, tip: 'One over, one wicket. Eighteen to win.' },
  { name: 'Colony Derby', theme: 'day', need: 63, balls: 24, wickets: 3, bowlers: ['swing', 'spin', 'fast', 'mixed'], field: 'packed', window: 1.0, tip: 'A full daily-length chase.' },
  { name: 'Bhaiya Arrives', theme: 'dusk', need: 34, balls: 12, wickets: 2, bowlers: ['ace'], field: 'spread', window: 0.97, tip: 'The big brother bowls everything.' },
  { name: 'Diwali Night', theme: 'night', festive: true, need: 56, balls: 18, wickets: 2, bowlers: ['fast', 'mixed', 'ace'], field: 'deep', window: 0.95, tip: 'Festival night. Sixes over the roofs count too, but avoid the red houses.' },
  { name: 'Six or Nothing', theme: 'night', need: 22, balls: 6, wickets: 1, bowlers: ['mixed'], field: 'wall', window: 0.95, tip: 'Four boundary riders. Only sixes will do.' },
  { name: 'Gully Legend', theme: 'night', festive: true, need: 88, balls: 30, wickets: 3, bowlers: ['ace', 'mixed', 'fast', 'swing', 'ace'], field: 'packed', window: 0.9, tip: 'Five overs against the best. Good luck.' }
];

const DAILY_OVERS = [['medium', 'swing'], ['spin', 'swing'], ['fast', 'mixed'], ['mixed', 'ace']];
const DAILY_FIELDS = ['spread', 'straight', 'deep', 'ring'];
const DAILY_THEMES = ['day', 'day', 'dusk', 'day', 'night', 'day', 'dusk'];
const SURVIVAL_ORDER = ['rookie', 'medium', 'swing', 'spin', 'fast', 'mixed', 'ace'];

export function dailyConfig(day) {
  const rng = new RNG(hashSeed('daily', day));
  const bowlers = DAILY_OVERS.map((pair) => rng.pick(pair));
  const field = rng.pick(DAILY_FIELDS);
  // The light changes through the week, and is the same for everyone on a given day.
  const theme = DAILY_THEMES[((day % 7) + 7) % 7];
  return { mode: 'daily', day, seed: hashSeed('daily-balls', day), balls: DAILY.balls, wickets: DAILY.wickets, bowlers, field, window: 1.05, title: 'Daily Challenge #' + (day + 1), theme };
}

export function chaseConfig(index) {
  const L = LEVELS[index];
  return { mode: 'chase', level: index, seed: hashSeed('chase', index, Date.now()), balls: L.balls, wickets: L.wickets, target: L.need, bowlers: L.bowlers, field: L.field, window: L.window, title: L.name, tip: L.tip, theme: L.theme, festive: !!L.festive };
}

// One over, two wickets, as many as you can. A different bowler and light every time.
export const SUPER_OVER = { balls: 6, wickets: 2, max: 36 };
const SUPER_BOWLERS = ['medium', 'swing', 'spin', 'fast', 'mixed'];
const SUPER_THEMES = ['day', 'dusk', 'night'];

export function superOverConfig(seed = hashSeed('super', Date.now(), Math.random())) {
  const rng = new RNG(seed);
  return { mode: 'superover', seed, balls: SUPER_OVER.balls, wickets: SUPER_OVER.wickets, bowlers: [rng.pick(SUPER_BOWLERS)], field: rng.pick(['spread', 'straight', 'deep']), window: 1.05, title: 'Super Over', theme: rng.pick(SUPER_THEMES), tip: 'Six balls, two wickets. Go big.' };
}

export function survivalConfig() {
  return { mode: 'survival', seed: hashSeed('survival', Date.now(), Math.random()), balls: Infinity, wickets: 3, bowlers: SURVIVAL_ORDER, field: 'spread', window: 1.1, title: 'Survival' };
}

export function practiceConfig(bowler = 'rookie') {
  return { mode: 'practice', seed: hashSeed('practice', Date.now()), balls: Infinity, wickets: Infinity, bowlers: [bowler], field: 'spread', window: 1.25, title: 'Practice' };
}

export class Match {
  constructor(cfg) {
    this.cfg = cfg;
    this.runs = 0;
    this.wickets = 0;
    this.legal = 0;      // legal balls bowled
    this.seq = 0;        // every delivery, including wides
    this.fours = 0;
    this.sixes = 0;
    this.dots = 0;
    this.perfects = 0;
    this.sixStreak = 0;
    this.bestSixStreak = 0;
    this.windows = 0;
    this.caughtOuts = 0;
    this.extras = 0;     // runs from wides and no balls
    this.freeHit = false; // the next ball is a free hit
    this.over = [];      // labels for the balls of the current over
    this.log = [];
    this.finished = false;
    this.reason = null;
  }

  get overIndex() { return Math.floor(this.legal / 6); }
  get ballsLeft() { return this.cfg.balls - this.legal; }
  get wicketsLeft() { return this.cfg.wickets - this.wickets; }
  get need() { return this.cfg.target ? Math.max(0, this.cfg.target - this.runs) : null; }
  get oversText() { return Math.floor(this.legal / 6) + '.' + (this.legal % 6); }

  bowlerKey() {
    const list = this.cfg.bowlers;
    const i = this.overIndex;
    return this.cfg.mode === 'survival' ? list[Math.min(i, list.length - 1)] : list[i % list.length];
  }
  bowler() { return BOWLERS[this.bowlerKey()]; }

  // Survival keeps getting faster and tighter after the last bowler has been reached.
  difficulty() {
    if (this.cfg.mode !== 'survival') return { speed: 1, window: this.cfg.window, field: this.cfg.field, skill: 0.78 };
    const o = this.overIndex;
    const extra = Math.max(0, o - 6);
    const fields = ['spread', 'ring', 'straight', 'deep', 'packed', 'packed', 'wall'];
    return {
      speed: 1 + Math.min(extra * 0.02, 0.2),
      window: Math.max(0.78, 1.15 - o * 0.035),
      field: fields[Math.min(o, fields.length - 1)],
      skill: Math.min(0.92, 0.72 + o * 0.02)
    };
  }

  nextPlay(hand) {
    const rng = new RNG(hashSeed(this.cfg.seed, this.seq));
    this.seq++;
    const diff = this.difficulty();
    const delivery = makeDelivery(rng, this.bowler(), diff.speed);
    return new Play({ delivery, field: fieldFor(diff.field, diff.skill), rng, hand, windowScale: diff.window, freeHit: this.freeHit });
  }

  apply(o) {
    const entry = { runs: o.runs, out: o.out, wide: o.wide, noBall: !!o.noBall, saved: o.saved || null, boundary: o.boundary, timing: o.timing };
    this.log.push(entry);
    this.runs += o.runs;
    if (o.legal) this.legal++;
    if (o.wide || o.noBall) this.extras++;
    // A no ball earns a free hit. It stays in force until a legal ball has been bowled.
    if (o.noBall) this.freeHit = true;
    else if (o.legal) this.freeHit = false;
    if (o.boundary === 4) this.fours++;
    if (o.boundary === 6) { this.sixes++; this.sixStreak++; this.bestSixStreak = Math.max(this.bestSixStreak, this.sixStreak); }
    else if (o.legal) this.sixStreak = 0;
    if (o.timing === 'perfect') this.perfects++;
    if (o.legal && !o.runs && !o.out) this.dots++;
    if (o.out === 'window') this.windows++;
    if (o.out === 'caught' || o.out === 'onetip') this.caughtOuts++;
    if (o.out && this.cfg.wickets !== Infinity) this.wickets++;

    this.over.push(o.out ? 'W' : o.wide ? 'wd' : o.noBall ? (o.runs > 1 ? o.runs - 1 + 'nb' : 'nb') : String(o.runs));
    const overDone = o.legal && this.legal % 6 === 0;
    const res = { overDone, finished: false };
    if (this.cfg.target && this.runs >= this.cfg.target) this.end('won');
    else if (this.wickets >= this.cfg.wickets) this.end(this.cfg.target ? 'lost' : 'allout');
    else if (this.legal >= this.cfg.balls) this.end(this.cfg.target ? 'lost' : 'overs');
    res.finished = this.finished;
    return res;
  }

  startNewOver() { this.over = []; }

  end(reason) { this.finished = true; this.reason = reason; }

  stars() {
    if (this.cfg.mode !== 'chase' || this.reason !== 'won') return 0;
    let s = 1;
    if (this.ballsLeft >= Math.max(2, Math.round(this.cfg.balls * 0.15))) s++;
    if (this.wickets === 0) s++;
    return s;
  }

  medal() {
    if (this.cfg.mode !== 'daily') return null;
    const m = DAILY.medals;
    return this.runs >= m.gold ? 'gold' : this.runs >= m.silver ? 'silver' : this.runs >= m.bronze ? 'bronze' : null;
  }
}
