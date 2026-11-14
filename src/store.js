// Saved progress: coins, unlocks, stats, daily history, achievements and settings.
// Everything lives in the browser's localStorage. If storage is unavailable the game
// still runs and simply forgets progress when the tab closes.

const KEY = 'gullySixes.save.v1';
const DAY_MS = 86400000;
const EPOCH = Date.UTC(2026, 10, 15); // daily challenge #1

export const BATS = [
  { id: 'wood', name: 'Old Faithful', cost: 0, blade: '#d9b47a', grip: '#2d2d2d' },
  { id: 'tape', name: 'Tape Master', cost: 150, blade: '#2b2b33', grip: '#e9e3d0' },
  { id: 'neon', name: 'Neon Slogger', cost: 300, blade: '#b8f23a', grip: '#16202a' },
  { id: 'sunset', name: 'Sunset Blade', cost: 500, blade: '#ff7a3d', grip: '#5a1f6b' },
  { id: 'ocean', name: 'Deep Blue', cost: 800, blade: '#2f6fde', grip: '#f4f4f4' },
  { id: 'gold', name: 'Golden Legend', cost: 1500, blade: '#f5c93b', grip: '#7a1d1d' }
];

export const BALLS = [
  { id: 'tennis', name: 'Tennis Ball', cost: 0, color: '#d7f23c' },
  { id: 'red', name: 'Red Tape Ball', cost: 120, color: '#e23b32' },
  { id: 'white', name: 'Night White', cost: 250, color: '#f7f7f2' },
  { id: 'pink', name: 'Pink Swinger', cost: 400, color: '#ff6fb1' },
  { id: 'orange', name: 'Orange Rubber', cost: 600, color: '#ff9a2e' }
];

export const ACHIEVEMENTS = [
  { id: 'first_six', name: 'Over the Wall', desc: 'Hit your first six' },
  { id: 'fifty', name: 'Gully Fifty', desc: 'Score 50 in one innings' },
  { id: 'century', name: 'Colony Hero', desc: 'Score 100 in one innings' },
  { id: 'hat_six', name: 'Three in a Row', desc: 'Hit three sixes in a row' },
  { id: 'six_six', name: 'Six Sixes', desc: 'Hit six sixes in a row' },
  { id: 'window', name: 'Sorry, Aunty', desc: 'Break a window' },
  { id: 'bronze', name: 'Bronze Bat', desc: 'Win a bronze medal in the Daily Challenge' },
  { id: 'silver', name: 'Silver Bat', desc: 'Win a silver medal in the Daily Challenge' },
  { id: 'gold', name: 'Golden Bat', desc: 'Win a gold medal in the Daily Challenge' },
  { id: 'streak3', name: 'Regular', desc: 'Play the Daily Challenge 3 days in a row' },
  { id: 'streak7', name: 'Every Evening', desc: 'Play the Daily Challenge 7 days in a row' },
  { id: 'perfect10', name: 'Sweet Spot', desc: 'Time 10 perfect shots in one innings' },
  { id: 'no_dots', name: 'Busy Batter', desc: 'Finish a full Daily Challenge without a dot ball' },
  { id: 'level5', name: 'Rising Star', desc: 'Win 5 chase levels' },
  { id: 'legend', name: 'Gully Legend', desc: 'Win every chase level' },
  { id: 'stars', name: 'Perfectionist', desc: 'Earn 3 stars on 10 chase levels' },
  { id: 'survivor', name: 'Hard to Remove', desc: 'Score 75 in Survival' },
  { id: 'super24', name: 'Big Over', desc: 'Score 24 or more in a Super Over' },
  { id: 'super36', name: 'Six Sixes, One Over', desc: 'Score a perfect 36 in a Super Over' },
  { id: 'night_six', name: 'Night Rider', desc: 'Hit a six under the street lamps' },
  { id: 'collector', name: 'Kit Bag', desc: 'Own 4 bats' }
];

export function dayNumber(date = new Date()) {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH) / DAY_MS);
}

function defaults() {
  return {
    v: 1,
    coins: 0,
    name: '',
    bats: ['wood'],
    balls: ['tennis'],
    bat: 'wood',
    ball: 'tennis',
    settings: { sound: true, quality: 'auto', autoLevel: 2, hand: 'R', haptics: true, guide: true, controls: 'swipe' },
    stats: { innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, perfects: 0, windows: 0, best: 0 },
    daily: {},            // day -> { best, tries, medal }
    lastDaily: null,
    streak: 0,
    bestStreak: 0,
    stars: [],            // stars per chase level
    survivalBest: 0,
    superBest: 0,
    superPlays: 0,
    achievements: {},
    seenHelp: false
  };
}

export class Store {
  constructor(storage) {
    this.storage = storage === undefined ? safeStorage() : storage;
    this.data = defaults();
    this.load();
  }

  load() {
    try {
      const raw = this.storage && this.storage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      const d = defaults();
      this.data = { ...d, ...saved, settings: { ...d.settings, ...(saved.settings || {}) }, stats: { ...d.stats, ...(saved.stats || {}) } };
      for (const k of ['bats', 'balls', 'stars']) if (!Array.isArray(this.data[k])) this.data[k] = d[k];
      for (const k of ['daily', 'achievements']) if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = {};
      for (const k of ['coins', 'survivalBest', 'superBest', 'superPlays', 'streak', 'bestStreak']) if (typeof this.data[k] !== 'number' || !isFinite(this.data[k])) this.data[k] = d[k];
      if (!['auto', 'high', 'low'].includes(this.data.settings.quality)) this.data.settings.quality = 'auto';
      if (this.data.settings.controls !== 'tap') this.data.settings.controls = 'swipe';
      if (this.data.settings.hand !== 'L') this.data.settings.hand = 'R';
    } catch (e) { this.data = defaults(); }
  }

  save() {
    try { if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage full or blocked */ }
  }

  reset() { this.data = defaults(); this.save(); }

  setSetting(key, value) { this.data.settings[key] = value; this.save(); }

  buy(kind, id) {
    const list = kind === 'bat' ? BATS : BALLS;
    const owned = kind === 'bat' ? this.data.bats : this.data.balls;
    const item = list.find((x) => x.id === id);
    if (!item || owned.includes(id) || this.data.coins < item.cost) return false;
    this.data.coins -= item.cost;
    owned.push(id);
    this.data[kind] = id;
    this.save();
    return true;
  }

  equip(kind, id) {
    const owned = kind === 'bat' ? this.data.bats : this.data.balls;
    if (!owned.includes(id)) return false;
    this.data[kind] = id;
    this.save();
    return true;
  }

  batSkin() { return BATS.find((b) => b.id === this.data.bat) || BATS[0]; }
  ballSkin() { return BALLS.find((b) => b.id === this.data.ball) || BALLS[0]; }

  dailyStreak(today = dayNumber()) {
    return this.data.lastDaily !== null && this.data.lastDaily >= today - 1 ? this.data.streak : 0;
  }

  // Records a finished match. Returns what changed so the result screen can show it.
  record(match, today = dayNumber()) {
    const d = this.data, cfg = match.cfg;
    const out = { coins: 0, newBest: false, medal: null, newMedal: false, stars: 0, newStars: 0, unlocked: [], streak: 0 };
    if (cfg.mode === 'practice') return out;

    const s = d.stats;
    s.innings++; s.runs += match.runs; s.balls += match.legal; s.fours += match.fours; s.sixes += match.sixes;
    s.outs += match.wickets; s.perfects += match.perfects; s.windows += match.windows;
    if (match.runs > s.best) s.best = match.runs;
    out.coins = match.runs;

    if (cfg.mode === 'daily') {
      const rec = d.daily[cfg.day] || { best: -1, tries: 0, medal: null };
      rec.tries++;
      if (match.runs > rec.best) { rec.best = match.runs; out.newBest = rec.tries > 1; }
      const rank = { bronze: 1, silver: 2, gold: 3 };
      const medal = match.medal();
      out.medal = medal;
      if (medal && (!rec.medal || rank[medal] > rank[rec.medal])) {
        out.coins += ({ bronze: 15, silver: 30, gold: 60 })[medal] - (rec.medal ? ({ bronze: 15, silver: 30, gold: 60 })[rec.medal] : 0);
        rec.medal = medal;
        out.newMedal = true;
      }
      d.daily[cfg.day] = rec;
      if (cfg.day === today && d.lastDaily !== today) {
        d.streak = d.lastDaily === today - 1 ? d.streak + 1 : 1;
        d.lastDaily = today;
        d.bestStreak = Math.max(d.bestStreak, d.streak);
      }
      out.streak = this.dailyStreak(today);
      // Keep two months of history.
      for (const k of Object.keys(d.daily)) if (Number(k) < today - 60) delete d.daily[k];
    } else if (cfg.mode === 'chase') {
      const stars = match.stars();
      const prev = d.stars[cfg.level] || 0;
      out.stars = stars;
      if (stars > prev) { out.newStars = stars - prev; out.coins += out.newStars * 20; d.stars[cfg.level] = stars; }
    } else if (cfg.mode === 'survival') {
      if (match.runs > d.survivalBest) { out.newBest = d.survivalBest > 0; d.survivalBest = match.runs; }
    } else if (cfg.mode === 'superover') {
      d.superPlays = (d.superPlays || 0) + 1;
      if (match.runs > (d.superBest || 0)) { out.newBest = d.superBest > 0; d.superBest = match.runs; }
    }

    d.coins += out.coins;
    out.unlocked = this.checkAchievements(match);
    this.save();
    return out;
  }

  checkAchievements(match) {
    const d = this.data, cfg = match ? match.cfg : {};
    const won = d.stars.filter((x) => x > 0).length;
    const tests = {
      first_six: d.stats.sixes > 0,
      fifty: !!match && match.runs >= 50,
      century: !!match && match.runs >= 100,
      hat_six: !!match && match.bestSixStreak >= 3,
      six_six: !!match && match.bestSixStreak >= 6,
      window: d.stats.windows > 0,
      bronze: Object.values(d.daily).some((r) => r.medal),
      silver: Object.values(d.daily).some((r) => r.medal === 'silver' || r.medal === 'gold'),
      gold: Object.values(d.daily).some((r) => r.medal === 'gold'),
      streak3: d.bestStreak >= 3,
      streak7: d.bestStreak >= 7,
      perfect10: !!match && match.perfects >= 10,
      no_dots: !!match && cfg.mode === 'daily' && match.reason === 'overs' && match.dots === 0,
      level5: won >= 5,
      legend: won >= 15,
      stars: d.stars.filter((x) => x >= 3).length >= 10,
      survivor: d.survivalBest >= 75,
      super24: (d.superBest || 0) >= 24,
      super36: (d.superBest || 0) >= 36,
      night_six: !!match && match.sixes > 0 && (cfg.theme === 'night' || cfg.theme === 'blackout'),
      collector: d.bats.length >= 4
    };
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (tests[a.id] && !d.achievements[a.id]) { d.achievements[a.id] = Date.now(); fresh.push(a); }
    }
    return fresh;
  }
}

function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem('gullySixes.test', '1');
    s.removeItem('gullySixes.test');
    return s;
  } catch (e) { return null; }
}
