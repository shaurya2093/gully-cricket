// Logic tests. Run with: npm test
import assert from 'node:assert';
import { RNG, hashSeed } from '../src/rng.js';
import { BOWLERS, makeDelivery } from '../src/deliveries.js';
import { Play } from '../src/sim.js';
import { Match, dailyConfig, chaseConfig, survivalConfig, practiceConfig, superOverConfig, SUPER_OVER, LEVELS, FIELDS, fieldFor, DAILY } from '../src/modes.js';
import { Store, dayNumber, BATS, ACHIEVEMENTS } from '../src/store.js';
import { TIMING, PITCH, STREET, RUN_LINES, WIDE_X } from '../src/config.js';
import { HOUSES, buildingAt, windowAt } from '../src/street.js';
import { playMatch, playBall, BOTS } from '../tools/calibrate.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; };

function run(play, tapOffset, aim = 0, loft = false) {
  const tap = tapOffset === null ? Infinity : play.d.tIdeal - TIMING.lag + tapOffset;
  let n = 0;
  while (play.phase !== 'done' && n++ < 4000) {
    if (!play.swing && play.t >= tap) play.swingAt(aim, loft);
    play.step(1 / 120);
  }
  assert(play.phase === 'done', 'play must finish');
  return play.outcome;
}
const mk = (seed, bowler = 'rookie', field = [], w = 1) => {
  const rng = new RNG(seed);
  return new Play({ delivery: makeDelivery(rng, BOWLERS[bowler]), field, rng, windowScale: w });
};

test('rng is deterministic and well spread', () => {
  const a = new RNG(5), b = new RNG(5);
  for (let i = 0; i < 50; i++) assert.strictEqual(a.next(), b.next());
  assert.notStrictEqual(hashSeed('daily', 1), hashSeed('daily', 2));
  const r = new RNG(1); let sum = 0;
  for (let i = 0; i < 5000; i++) { const v = r.next(); assert(v >= 0 && v < 1); sum += v; }
  assert(Math.abs(sum / 5000 - 0.5) < 0.03);
});

test('every bowler produces playable deliveries', () => {
  for (const key of Object.keys(BOWLERS)) {
    const rng = new RNG(11);
    for (let i = 0; i < 300; i++) {
      const d = makeDelivery(rng, BOWLERS[key]);
      assert(d.tIdeal > 0.3 && d.tIdeal < 1.7, key + ' flight time ' + d.tIdeal);
      assert(d.tStumps > d.tIdeal, 'stumps come after the contact point');
      assert(d.contactY > 0 && d.contactY < 1.9, key + ' height ' + d.contactY);
      if (d.wideBall) assert(Math.abs(d.creaseX) > WIDE_X && Math.abs(d.creaseX) < 1.6, key + ' wide crosses at ' + d.creaseX);
      else assert(Math.abs(d.creaseX) <= 0.95, key + ' ordinary ball stays inside the wide line: ' + d.creaseX);
      assert(d.bounceZ > PITCH.idealZ, 'ball bounces before it reaches the bat');
    }
  }
});

test('a perfectly timed straight drive is not a miss and scores', () => {
  let scored = 0;
  for (let s = 1; s <= 60; s++) {
    const p = mk(s);
    if (Math.abs(p.d.contactX) > 0.9) continue;
    const o = run(p, 0, 0, false);
    assert.strictEqual(o.timing, 'perfect');
    assert(!o.out || o.out === 'window', 'no fielders: cannot be caught or bowled, got ' + o.out);
    if (o.runs >= 3) scored++;
  }
  assert(scored > 45, 'straight drives with no fielders should usually reach the far wall, got ' + scored);
});

test('a perfectly timed straight loft is usually six', () => {
  let six = 0, n = 0;
  for (let s = 1; s <= 80; s++) {
    const p = mk(s, 'medium');
    if (Math.abs(p.d.contactX) > 0.5 || p.d.contactY < 0.25) continue;
    n++;
    if (run(p, 0, 0, true).boundary === 6) six++;
  }
  assert(six / n > 0.85, `sixes ${six}/${n}`);
});

test('leaving a straight ball gets you bowled, leaving a wide one does not', () => {
  let bowled = 0, checked = 0;
  for (let s = 1; s <= 200; s++) {
    const p = mk(s);
    const hits = p.d.hitsStumps;
    const o = run(p, null);
    assert.strictEqual(o.out === 'bowled' || o.saved === 'bowled', hits);
    assert.strictEqual(o.out === 'bowled', hits && !p.d.noBall, 'bowled does not count off a no ball');
    assert.strictEqual(o.timing, null);
    if (hits) bowled++;
    checked++;
  }
  assert(bowled > 10 && bowled < checked, 'some but not all balls hit the stumps');
});

test('swinging far too early or too late misses', () => {
  for (let s = 1; s <= 40; s++) {
    assert.strictEqual(run(mk(s), -0.3).timing, 'early');
    const late = run(mk(s), 0.2);
    assert.strictEqual(late.timing, 'late');
    assert(late.runs === 0 || late.wide || late.noBall);
  }
});

test('timing labels follow the windows', () => {
  const labels = (off) => { const set = new Set(); for (let s = 1; s <= 40; s++) { const p = mk(s); if (Math.abs(p.d.contactX) < 0.9) set.add(run(p, off).timing); } return [...set]; };
  assert.deepStrictEqual(labels(0.01), ['perfect']);
  assert.deepStrictEqual(labels(-0.055), ['good']);
  assert.deepStrictEqual(labels(-0.1), ['early']);
});

test('a wider timing window is more forgiving', () => {
  const p1 = mk(3, 'rookie', [], 1), p2 = mk(3, 'rookie', [], 1.4);
  assert.strictEqual(run(p1, -0.045).timing, 'good');
  assert.strictEqual(run(p2, -0.045).timing, 'perfect');
});

test('outcomes are always well formed and runs are legal values', () => {
  const rng = new RNG(77);
  const seen = new Set();
  for (let i = 0; i < 1500; i++) {
    const m = new Match(dailyConfig(i % 40));
    m.seq = i;
    const o = playBall(m, BOTS.casual, rng);
    const bat = o.noBall ? o.runs - 1 : o.runs;      // a no ball adds one penalty run
    assert([0, 1, 2, 3, 4, 6].includes(bat), 'runs ' + o.runs);
    assert([null, 'bowled', 'caught', 'onetip', 'window', 'lost'].includes(o.out), 'out ' + o.out);
    if (o.out) assert.strictEqual(o.runs, 0);
    if (o.out) assert(!o.noBall && !o.freeHit, 'no wicket off a no ball or a free hit');
    if (o.boundary) assert.strictEqual(bat, o.boundary);
    if (o.wide) assert(!o.legal && o.runs === 1 && !o.noBall);
    if (o.noBall) assert(!o.legal && o.runs >= 1);
    if (o.saved) assert(o.out === null && (o.noBall || o.freeHit));
    seen.add(o.out || 'r' + o.runs);
  }
  for (const k of ['r0', 'r1', 'r2', 'r4', 'r6', 'bowled', 'caught']) assert(seen.has(k), 'never saw ' + k);
});

test('the same seed and the same input give the same result', () => {
  for (let s = 1; s <= 30; s++) {
    const a = run(new Match(dailyConfig(3)).nextPlay('R'), -0.02, 0.3, s % 2 === 0);
    const b = run(new Match(dailyConfig(3)).nextPlay('R'), -0.02, 0.3, s % 2 === 0);
    assert.deepStrictEqual(a, b);
  }
  const m1 = playMatch(dailyConfig(9), BOTS.good, new RNG(4));
  const m2 = playMatch(dailyConfig(9), BOTS.good, new RNG(4));
  assert.strictEqual(m1.runs, m2.runs);
  assert.deepStrictEqual(m1.log, m2.log);
});

test('left-handers drag early shots the other way', () => {
  let diff = 0;
  for (let s = 1; s <= 30; s++) {
    const mkh = (hand) => { const rng = new RNG(s); return new Play({ delivery: makeDelivery(rng, BOWLERS.rookie), field: [], rng, hand }); };
    const r = mkh('R'), l = mkh('L');
    const step = (p) => { const tap = p.d.tIdeal - TIMING.lag - 0.09; while (p.phase === 'flight') { if (!p.swing && p.t >= tap) p.swingAt(0, false); p.step(1 / 240); } const bat = p.events.find((ev) => ev.type === 'bat'); return p.phase === 'struck' && bat && !bat.edge ? p.ball.vx : null; };
    const vr = step(r), vl = step(l);
    if (vr !== null && vl !== null && Math.abs(vr) > 1 && Math.abs(vl) > 1) { assert(vr < 0 && vl > 0, `R ${vr} L ${vl}`); diff++; }
  }
  assert(diff > 5);
});

test('street layout is usable by the simulation', () => {
  for (const side of [-1, 1]) {
    const list = HOUSES[side];
    assert(list[0].z0 <= STREET.backZ && list[list.length - 1].z1 >= STREET.endZ);
    for (let i = 1; i < list.length; i++) assert(Math.abs(list[i].z0 - list[i - 1].z1) < 1e-9, 'no gaps between houses');
    assert.strictEqual(list.filter((b) => b.out).length, 1, 'one out house per side');
    for (const b of list) for (const w of b.windows) assert(w.y1 < b.h && w.z0 > b.z0 && w.z1 < b.z1);
  }
  const b = buildingAt(1, 13);
  assert(b.out && b.h === 6.5);
  const w = b.windows[0];
  assert(windowAt(1, (w.z0 + w.z1) / 2, (w.y0 + w.y1) / 2));
  assert.strictEqual(windowAt(1, (w.z0 + w.z1) / 2, 0.3), null);
});

test('match bookkeeping: overs, wides, wickets and finishing', () => {
  const m = new Match(dailyConfig(1));
  assert.strictEqual(m.cfg.balls, DAILY.balls);
  const dot = { runs: 0, out: null, boundary: 0, wide: false, legal: true, timing: 'good' };
  m.apply({ ...dot, runs: 1, wide: true, legal: false });
  assert.strictEqual(m.legal, 0); assert.strictEqual(m.runs, 1); assert.strictEqual(m.seq, 0);
  for (let i = 0; i < 5; i++) assert.strictEqual(m.apply({ ...dot, runs: 6, boundary: 6 }).overDone, false);
  assert.strictEqual(m.apply({ ...dot, runs: 6, boundary: 6 }).overDone, true);
  assert.strictEqual(m.oversText, '1.0'); assert.strictEqual(m.sixes, 6); assert.strictEqual(m.bestSixStreak, 6);
  m.startNewOver();
  m.apply({ ...dot, out: 'bowled' }); m.apply({ ...dot, out: 'caught' });
  assert(!m.finished);
  assert(m.apply({ ...dot, out: 'window' }).finished);
  assert.strictEqual(m.reason, 'allout'); assert.strictEqual(m.wickets, 3); assert.strictEqual(m.windows, 1);

  const c = new Match(chaseConfig(0));
  assert.strictEqual(c.need, LEVELS[0].need);
  c.apply({ ...dot, runs: 6, boundary: 6 }); c.apply({ ...dot, runs: 6, boundary: 6 });
  assert(c.finished && c.reason === 'won'); assert.strictEqual(c.stars(), 3);
  const c2 = new Match(chaseConfig(0));
  for (let i = 0; i < 12; i++) c2.apply(dot);
  assert(c2.finished && c2.reason === 'lost' && c2.stars() === 0);

  const p = new Match(practiceConfig());
  for (let i = 0; i < 30; i++) p.apply({ ...dot, out: 'bowled' });
  assert(!p.finished && p.wickets === 0, 'practice never ends');
  const s = new Match(survivalConfig());
  assert(s.difficulty().window > 1); s.legal = 60; assert(s.difficulty().window < 0.9 && s.bowlerKey() === 'ace');
  assert.strictEqual(fieldFor('packed').length, 5);
  for (const L of LEVELS) for (const k of L.bowlers) assert(BOWLERS[k], 'unknown bowler ' + k);
});

test('daily challenge is the same for everyone on the same day', () => {
  const a = dailyConfig(12), b = dailyConfig(12), c = dailyConfig(13);
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a.seed, c.seed);
  const da = new Match(a).nextPlay('R').d, db = new Match(b).nextPlay('R').d;
  assert.deepStrictEqual(da, db);
});

test('saved progress: coins, medals, streaks, shop and bad data', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; };
  const st = mem();
  const store = new Store(st);
  const today = 20;
  const play = (runs) => { const m = new Match(dailyConfig(today)); m.runs = runs; m.legal = 24; m.reason = 'overs'; m.finished = true; m.dots = 1; return m; };
  const bronzeRuns = DAILY.medals.bronze + 2, goldRuns = DAILY.medals.gold + 6;
  let r = store.record(play(bronzeRuns), today);
  assert.strictEqual(r.medal, 'bronze'); assert(r.newMedal); assert.strictEqual(r.coins, bronzeRuns + 15); assert.strictEqual(r.streak, 1);
  r = store.record(play(goldRuns), today);
  assert.strictEqual(r.medal, 'gold'); assert.strictEqual(r.coins, goldRuns + 45); assert(r.newBest); assert.strictEqual(r.streak, 1);
  r = store.record(play(10), today);
  assert(!r.newMedal && !r.newBest); assert.strictEqual(store.data.daily[today].best, goldRuns); assert.strictEqual(store.data.daily[today].tries, 3);
  const next = new Match(dailyConfig(today + 1)); next.runs = 5;
  assert.strictEqual(store.record(next, today + 1).streak, 2);
  assert.strictEqual(store.dailyStreak(today + 3), 0, 'streak lapses after a missed day');
  assert(store.data.achievements.gold && store.data.achievements.fifty);

  assert(!store.buy('bat', 'gold'), 'cannot afford');
  const coins = store.data.coins;
  assert(store.buy('bat', 'tape')); assert.strictEqual(store.data.coins, coins - 150); assert.strictEqual(store.data.bat, 'tape');
  assert(!store.buy('bat', 'tape'), 'cannot buy twice');
  assert(store.equip('bat', 'wood') && !store.equip('bat', 'gold'));

  const again = new Store(st);
  assert.strictEqual(again.data.coins, store.data.coins); assert.deepStrictEqual(again.data.bats, ['wood', 'tape']);

  const ch = new Match(chaseConfig(2)); ch.runs = 30; ch.legal = 6; ch.reason = 'won';
  r = again.record(ch, today);
  assert.strictEqual(r.stars, 3); assert.strictEqual(r.newStars, 3); assert.strictEqual(again.data.stars[2], 3);
  assert.strictEqual(again.record(ch, today).newStars, 0);
  const pr = new Match(practiceConfig()); pr.runs = 500;
  assert.strictEqual(again.record(pr, today).coins, 0);

  for (const bad of ['not json', '{"coins":"x","bats":5,"settings":null}', 'null', '[]']) {
    const s2 = mem(); s2.setItem('gullySixes.save.v1', bad);
    const b = new Store(s2);
    assert(Array.isArray(b.data.bats) && typeof b.data.coins === 'number' && b.data.settings.hand === 'R');
  }
  const none = new Store(null);
  none.record(play(40), today); assert.strictEqual(none.data.coins, 55);
  assert.strictEqual(dayNumber(new Date(2026, 10, 15, 23, 59)), 0); assert.strictEqual(dayNumber(new Date(2026, 10, 16, 0, 1)), 1);
  assert.strictEqual(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  assert.strictEqual(BATS[0].cost, 0);
});

// Finds a delivery of a given kind by trying seeds.
function findPlay(want, opts = {}) {
  for (let s = 1; s < 4000; s++) {
    const rng = new RNG(s);
    const d = makeDelivery(rng, BOWLERS[opts.bowler || 'medium']);
    if (want(d)) return new Play({ delivery: d, field: opts.field || [], rng, windowScale: 1, freeHit: !!opts.freeHit });
  }
  throw new Error('no such delivery');
}

test('wides: called when the ball is not hit, whether or not the batter swings', () => {
  const isWide = (d) => d.wideBall && !d.noBall;
  const left = run(findPlay(isWide), null);
  assert(left.wide && !left.legal && left.runs === 1 && !left.out);
  const swung = run(findPlay(isWide), 0, 0, false);
  assert(swung.wide && swung.runs === 1, 'a swing and a miss at a wide is still a wide');
  // every bowler bowls some extras, but not many
  for (const key of Object.keys(BOWLERS)) {
    const rng = new RNG(3);
    let wides = 0, nbs = 0;
    for (let i = 0; i < 3000; i++) { const d = makeDelivery(rng, BOWLERS[key]); if (d.wideBall) wides++; if (d.noBall) nbs++; }
    assert(wides > 30 && wides < 300, key + ' wides ' + wides);
    assert(nbs > 15 && nbs < 300, key + ' no balls ' + nbs);
  }
});

test('stance: stepping across reaches a wide ball, and standing still does not', () => {
  const offWide = (d) => d.wideBall && !d.noBall && d.contactX > 1.15 && d.contactX < 1.45;
  const still = findPlay(offWide);
  assert(run(still, 0, 0.4, false).wide, 'out of reach from the normal stance');
  const moved = findPlay(offWide);
  moved.stanceX = 0.55;
  const o = run(moved, 0, 0.4, false);
  assert(!o.wide && o.timing === 'perfect', 'reachable after moving across: ' + JSON.stringify(o));
  // moving away from a straight ball puts it out of reach
  const straight = (d) => !d.wideBall && !d.noBall && Math.abs(d.contactX) < 0.1 && d.hitsStumps;
  const away = findPlay(straight);
  away.stanceX = -0.55;
  const far = findPlay((d) => !d.wideBall && !d.noBall && d.contactX > 0.5);
  far.stanceX = -0.55;
  assert.strictEqual(run(far, 0, 0, false).timing, 'miss');
  assert.notStrictEqual(run(away, 0, 0, false).timing, 'miss', 'a straight ball is still within reach');
});

test('no balls: one extra run, cannot be out, and the next ball is a free hit', () => {
  const nbStraight = (d) => d.noBall && !d.wideBall && d.hitsStumps;
  const o = run(findPlay(nbStraight), null);
  assert(o.noBall && !o.legal && o.runs === 1 && o.out === null && o.saved === 'bowled', JSON.stringify(o));
  const hit = run(findPlay((d) => d.noBall && !d.wideBall && Math.abs(d.contactX) < 0.4), 0, 0, true);
  assert(hit.noBall && hit.runs >= 1 && (!hit.boundary || hit.runs === hit.boundary + 1));

  const cfg = { mode: 'practice', seed: 1, balls: 12, wickets: 3, bowlers: ['medium'], field: 'spread', window: 1 };
  const m = new Match(cfg);
  m.apply({ runs: 5, out: null, wide: false, noBall: true, legal: false, boundary: 4, timing: 'good', saved: null });
  assert.strictEqual(m.runs, 5);
  assert.strictEqual(m.legal, 0, 'a no ball is bowled again');
  assert.strictEqual(m.freeHit, true);
  assert.strictEqual(m.fours, 1);
  assert.deepStrictEqual(m.over, ['4nb']);
  assert.strictEqual(m.nextPlay('R').freeHit, true, 'the next ball is a free hit');
  m.apply({ runs: 1, out: null, wide: true, legal: false, boundary: 0, timing: null });
  assert.strictEqual(m.freeHit, true, 'a wide does not use up the free hit');
  m.apply({ runs: 0, out: null, wide: false, legal: true, boundary: 0, timing: 'late', saved: 'bowled', freeHit: true });
  assert.strictEqual(m.wickets, 0, 'bowled on a free hit is not out');
  assert.strictEqual(m.freeHit, false, 'the free hit is used by a legal ball');
  assert.strictEqual(m.legal, 1);
  assert.strictEqual(m.extras, 2);

  // a free hit protects the batter in the simulation too
  const fh = findPlay((d) => !d.noBall && !d.wideBall && d.hitsStumps, { freeHit: true });
  const saved = run(fh, null);
  assert(saved.out === null && saved.saved === 'bowled' && saved.legal && saved.runs === 0);
});

test('super over: six balls, two wickets, best score is saved', () => {
  const a = superOverConfig(42), b = superOverConfig(42);
  assert.deepStrictEqual(a, b, 'same seed gives the same over');
  assert.strictEqual(a.balls, 6);
  assert.strictEqual(a.wickets, 2);
  assert(BOWLERS[a.bowlers[0]], 'known bowler');
  assert(FIELDS[a.field], 'known field');
  assert(SUPER_OVER.max === 36);
  const store = new Store(null);
  const rng = new RNG(3);
  const m1 = playMatch(superOverConfig(7), BOTS.expert, rng);
  assert(m1.finished && m1.legal <= 6 && m1.runs <= 6 * 7 + 12, 'six legal balls, plus whatever extras add');
  const r1 = store.record(m1, 0);
  assert.strictEqual(store.data.superBest, m1.runs);
  assert.strictEqual(r1.newBest, false, 'the first score is not announced as a new best');
  const worse = new Match(superOverConfig(8));
  worse.end('overs');
  store.record(worse, 0);
  assert.strictEqual(store.data.superBest, m1.runs, 'a lower score does not replace the best');
  assert.strictEqual(store.data.superPlays, 2);
});

test('every level and daily has a known lighting theme and field', () => {
  const themes = ['day', 'dusk', 'night', 'blackout'];
  LEVELS.forEach((L, i) => {
    const cfg = chaseConfig(i);
    assert(themes.includes(cfg.theme), L.name + ' theme ' + cfg.theme);
    assert(FIELDS[cfg.field], L.name + ' field');
    for (const k of cfg.bowlers) assert(BOWLERS[k], L.name + ' bowler ' + k);
    assert(cfg.target > 0 && cfg.target <= cfg.balls * 6, L.name + ' target is reachable');
  });
  for (let day = -3; day < 40; day++) {
    const cfg = dailyConfig(day);
    assert(themes.includes(cfg.theme), 'daily theme on day ' + day);
    assert.strictEqual(cfg.theme, dailyConfig(day).theme);
  }
  assert(LEVELS.some((L) => L.festive), 'at least one festival night');
});

test('settings: new players get automatic graphics, old or broken saves are repaired', () => {
  const fresh = new Store(null);
  assert.strictEqual(fresh.data.settings.quality, 'auto');
  assert.strictEqual(fresh.data.settings.guide, true);
  assert.strictEqual(fresh.data.settings.haptics, true);
  const mem = { v: JSON.stringify({ settings: { quality: 'ultra', hand: 'L' }, superBest: 'lots', coins: 12 }), getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  const old = new Store(mem);
  assert.strictEqual(old.data.settings.quality, 'auto', 'unknown graphics value falls back to auto');
  assert.strictEqual(old.data.settings.hand, 'L', 'valid settings are kept');
  assert.strictEqual(old.data.superBest, 0, 'non-numeric best is reset');
  assert.strictEqual(old.data.coins, 12);
  const kept = new Store({ v: JSON.stringify({ settings: { quality: 'high' } }), getItem() { return this.v; }, setItem() {} });
  assert.strictEqual(kept.data.settings.quality, 'high', 'an explicit choice from an older version is kept');
});

test('balance stays in a sensible range', () => {
  const mean = (bot) => { const rng = new RNG(21); let t = 0; for (let i = 0; i < 120; i++) t += playMatch(dailyConfig(i), bot, rng).runs; return t / 120; };
  const n = mean(BOTS.novice), g = mean(BOTS.good), e = mean(BOTS.expert);
  assert(n < g && g < e, 'better timing must score more');
  assert(n > 10 && n < DAILY.medals.silver, 'novice ' + n);
  assert(g > DAILY.medals.bronze && g < DAILY.medals.gold + 5, 'good ' + g);
  assert(e > DAILY.medals.silver, 'expert ' + e);
  assert.deepStrictEqual(RUN_LINES, [...RUN_LINES].sort((a, b) => a - b));
});

console.log(`All ${passed} test groups passed.`);
