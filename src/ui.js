// Menus, HUD and result screens (plain DOM laid over the 3D canvas).
import { BATS, BALLS, ACHIEVEMENTS, dayNumber } from './store.js';
import { LEVELS, DAILY, SUPER_OVER, dailyConfig, chaseConfig, survivalConfig, practiceConfig, superOverConfig } from './modes.js';
import { BOWLERS } from './deliveries.js';
import { TIMING } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MEDAL_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export function parseChallenge(hash) {
  const m = /^#beat-(\d{1,6})-(\d{1,3})(?:-([A-Za-z0-9]{1,14}))?$/.exec(hash || '');
  return m ? { day: Number(m[1]), runs: Number(m[2]), name: m[3] || 'A friend' } : null;
}

export class UI {
  constructor(store, sound) {
    this.store = store;
    this.sound = sound;
    this.game = null;
    this.challenge = parseChallenge(location.hash);
    this.screen = null;
    this.timers = {};
    this.lastCfg = null;
    this.bind();
  }

  attach(game) { this.game = game; }

  bind() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      this.sound.unlock();
      this.sound.click();
      this.act(el.dataset.act, el.dataset.arg, el);
    });
    $('loftBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.sound.unlock(); this.game.setLoft(!this.game.loft); });
    $('pauseBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.game.pause(true); });
  }

  act(name, arg, el) {
    const g = this.game;
    switch (name) {
      case 'home': g.quit(); this.home(); break;
      case 'daily': this.start(dailyConfig(dayNumber())); break;
      case 'levels': this.levels(); break;
      case 'level': this.levelDetail(Number(arg)); break;
      case 'playLevel': this.start(chaseConfig(Number(arg))); break;
      case 'survival': this.start(survivalConfig()); break;
      case 'superover': this.start(superOverConfig()); break;
      case 'reload': location.reload(); break;
      case 'practice': this.practice(); break;
      case 'playPractice': this.start(practiceConfig(arg)); break;
      case 'shop': this.shop(arg || 'bat'); break;
      case 'buy': if (this.store.buy(el.dataset.kind, arg)) { this.sound.coin(); this.store.checkAchievements(null); this.store.save(); g.applySkins(); } this.shop(el.dataset.kind); break;
      case 'equip': this.store.equip(el.dataset.kind, arg); g.applySkins(); this.shop(el.dataset.kind); break;
      case 'trophies': this.trophies(); break;
      case 'settings': this.settings(); break;
      case 'help': this.help(); break;
      case 'again': this.start(this.remake(this.lastCfg)); break;
      case 'resume': g.pause(false); break;
      case 'restart': g.pause(false); this.start(this.remake(this.lastCfg)); break;
      case 'share': this.share(el); break;
      case 'toggle': this.toggle(arg); break;
      case 'reset': this.resetStep(el); break;
      case 'dismissChallenge': this.challenge = null; this.home(); break;
      default: break;
    }
  }

  remake(cfg) {
    if (cfg.mode === 'daily') return dailyConfig(dayNumber());
    if (cfg.mode === 'chase') return chaseConfig(cfg.level);
    if (cfg.mode === 'survival') return survivalConfig();
    if (cfg.mode === 'superover') return superOverConfig();
    return practiceConfig(cfg.bowlers[0]);
  }

  start(cfg) {
    this.lastCfg = cfg;
    this.hideScreens();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!this.store.data.seenHelp) { this.store.data.seenHelp = true; this.store.save(); }
    this.game.startMatch(cfg);
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const tap = this.store.data.settings.controls === 'tap';
    const how = !touch ? 'Press an arrow key as the ball arrives. Hold Shift to loft.'
      : tap ? 'Tap as the ball arrives. Tap the left or right of the screen to aim.' : 'Swipe up as the ball arrives. Swipe left or right to aim.';
    const ring = this.game.guide ? (!touch ? 'Press an arrow key when the yellow ring closes. ' : tap ? 'Tap when the yellow ring closes. ' : 'Swipe when the yellow ring closes. ') : '';
    this.hint(ring ? ring + (cfg.tip || '') : cfg.tip || how, 5600);
  }

  // ---------- screens ----------

  show(html, cls = '') {
    const s = $('screens');
    s.className = 'screens ' + cls;
    s.innerHTML = '<div class="panel">' + html + '</div>';
    s.hidden = false;
    s.scrollTop = 0;
  }

  hideScreens() { $('screens').hidden = true; $('screens').innerHTML = ''; }

  coinsPill() { return `<div class="coins" title="Coins"><i></i>${this.store.data.coins}</div>`; }
  header(title) { return `<div class="head"><button class="back" data-act="home" aria-label="Back">&#8592;</button><h2>${esc(title)}</h2>${this.coinsPill()}</div>`; }

  home() {
    const d = this.store.data, today = dayNumber();
    const rec = d.daily[today];
    const streak = this.store.dailyStreak(today);
    const won = d.stars.filter((x) => x > 0).length;
    const ch = this.challenge;
    let chHtml = '';
    if (ch) {
      chHtml = ch.day === today
        ? `<div class="challenge"><b>${esc(ch.name)}</b> scored <b>${ch.runs}</b> in today's Daily Challenge. Can you beat it?<button class="x" data-act="dismissChallenge" aria-label="Dismiss">&times;</button></div>`
        : `<div class="challenge">That challenge link was for a different day. Today's Daily Challenge is open below.<button class="x" data-act="dismissChallenge" aria-label="Dismiss">&times;</button></div>`;
    }
    this.show(`
      <div class="topline">${this.coinsPill()}</div>
      <h1 class="logo"><span>GULLY</span><span>SIXES</span></h1>
      <p class="tag">Street cricket. Street rules.</p>
      ${chHtml}
      <button class="daily" data-act="daily">
        <span class="daily-k">Daily Challenge #${today + 1}</span>
        <span class="daily-t">4 overs &middot; 3 wickets &middot; same balls for everyone</span>
        <span class="daily-s">${rec ? `Your best today: <b>${rec.best}</b>${rec.medal ? ` <i class="medal ${rec.medal}"></i>` : ''}` : 'Not played yet today'}${streak ? ` &middot; ${streak}-day streak` : ''}</span>
        <span class="play">${rec ? 'PLAY AGAIN' : 'PLAY'}</span>
      </button>
      ${this.weekStrip(today)}
      <div class="modes">
        <button data-act="levels"><b>Chase</b><span>${won}/${LEVELS.length} levels won</span></button>
        <button data-act="superover"><b>Super Over</b><span>${d.superBest ? 'Best ' + d.superBest + ' of ' + SUPER_OVER.max : 'Six balls, go big'}</span></button>
        <button data-act="survival"><b>Survival</b><span>${d.survivalBest ? 'Best ' + d.survivalBest : 'Bat till 3 wickets fall'}</span></button>
        <button data-act="practice"><b>Practice</b><span>No wickets, no pressure</span></button>
      </div>
      <div class="nav">
        <button data-act="shop">Shop</button>
        <button data-act="trophies">Trophies</button>
        <button data-act="help">How to play</button>
        <button data-act="settings">Settings</button>
      </div>`, 'home');
    if (!d.seenHelp && !this.helpShown) { this.helpShown = true; this.help(true); }
  }

  // The last seven daily challenges as a row of dots, to make a streak visible.
  weekStrip(today) {
    const daily = this.store.data.daily;
    if (!Object.keys(daily).length) return '';
    let dots = '';
    for (let i = 6; i >= 0; i--) {
      const rec = daily[today - i];
      const cls = rec ? (rec.medal || 'played') : 'none';
      const label = (i === 0 ? 'Today' : i + (i === 1 ? ' day ago' : ' days ago')) + ': ' + (rec ? rec.best + ' runs' : 'not played');
      dots += `<i class="${cls}${i === 0 ? ' today' : ''}" title="${label}"></i>`;
    }
    return `<div class="week" role="img" aria-label="Your last seven daily challenges"><span>Last 7 days</span>${dots}</div>`;
  }

  help(first) {
    this.show(`
      ${first ? '<div class="head"><h2>How to play</h2></div>' : this.header('How to play')}
      <ol class="rules">
        <li><b>Time it.</b> Swing just as the ball reaches the batter. On a phone, swipe up. On a keyboard, press an arrow key or Space.</li>
        <li><b>Aim it.</b> Swipe left, straight or right (or use &larr; &uarr; &rarr;) to choose where the ball goes. Prefer tapping? Switch to Tap controls in Settings.</li>
        <li><b>Loft it.</b> Turn on <b>LOFT</b> (or hold Shift) to hit in the air. Lofts score sixes but can be caught.</li>
        <li><b>Read it.</b> A yellow mark shows where the ball will bounce. In practice and the first levels, a ring closes when it is time to swing.</li>
      </ol>
      <h3>Gully rules</h3>
      <ul class="rules">
        <li>Past the chalk lines scores <b>1</b>, <b>2</b> or <b>3</b>. The far wall is <b>4</b>. Over it on the full is <b>6</b>.</li>
        <li>Onto a roof on the full is <b>6</b>, except the <b class="red">red houses</b>: that ball is gone and you are <b>out</b>.</li>
        <li>Break a window and you are <b>out</b>.</li>
        <li><b>One tip, one hand:</b> a fielder can catch you after one bounce.</li>
        <li>Miss a straight one and you are <b>bowled</b>.</li>
      </ul>
      <button class="btn primary" data-act="home">${first ? "Let's play" : 'Got it'}</button>`);
  }

  levels() {
    const stars = this.store.data.stars;
    const cells = LEVELS.map((L, i) => {
      const open = i === 0 || (stars[i - 1] || 0) > 0;
      const s = stars[i] || 0;
      return `<button class="lvl ${open ? '' : 'locked'}" ${open ? `data-act="level" data-arg="${i}"` : 'disabled'}>
        <b>${i + 1}</b><span>${esc(L.name)}</span><em>${open ? '&#9733;'.repeat(s) + '<u>' + '&#9733;'.repeat(3 - s) + '</u>' : 'Locked'}</em></button>`;
    }).join('');
    this.show(`${this.header('Chase')}<p class="sub">Reach the target before the balls or wickets run out.</p><div class="lvls">${cells}</div>`);
  }

  levelDetail(i) {
    const L = LEVELS[i];
    const names = [...new Set(L.bowlers)].map((k) => BOWLERS[k].name + ' (' + BOWLERS[k].style.toLowerCase() + ')').join(', ');
    this.show(`${this.header('Level ' + (i + 1))}
      <div class="card"><h3>${esc(L.name)}</h3>
      <p class="big">Need <b>${L.need}</b> from <b>${L.balls}</b> balls</p>
      <p>${L.wickets} wicket${L.wickets > 1 ? 's' : ''} in hand &middot; Bowling: ${esc(names)}</p>
      <p class="tip">${esc(L.tip)}</p>
      <p class="sub">Stars: win, win with balls to spare, win without losing a wicket.</p></div>
      <button class="btn primary" data-act="playLevel" data-arg="${i}">Play</button>
      <button class="btn" data-act="levels">All levels</button>`);
  }

  practice() {
    const rows = Object.entries(BOWLERS).map(([k, b]) => `<button class="row" data-act="playPractice" data-arg="${k}"><i style="background:${b.shirt}"></i><b>${esc(b.name)}</b><span>${esc(b.style)}</span></button>`).join('');
    this.show(`${this.header('Practice')}<p class="sub">Pick a bowler. Unlimited balls, nothing is saved.</p><div class="rows">${rows}</div>`);
  }

  shop(kind) {
    const d = this.store.data;
    const list = kind === 'ball' ? BALLS : BATS;
    const owned = kind === 'ball' ? d.balls : d.bats;
    const current = kind === 'ball' ? d.ball : d.bat;
    const items = list.map((it) => {
      const has = owned.includes(it.id);
      const sw = kind === 'ball' ? `<i class="sw ball" style="background:${it.color}"></i>` : `<i class="sw bat" style="background:${it.blade};border-top-color:${it.grip}"></i>`;
      const btn = it.id === current ? '<span class="tagok">In use</span>'
        : has ? `<button class="mini" data-act="equip" data-kind="${kind}" data-arg="${it.id}">Use</button>`
          : `<button class="mini buy" data-act="buy" data-kind="${kind}" data-arg="${it.id}" ${d.coins < it.cost ? 'disabled' : ''}><i class="c"></i>${it.cost}</button>`;
      return `<div class="item">${sw}<b>${esc(it.name)}</b>${btn}</div>`;
    }).join('');
    this.show(`${this.header('Shop')}
      <div class="tabs"><button class="${kind === 'bat' ? 'on' : ''}" data-act="shop" data-arg="bat">Bats</button><button class="${kind === 'ball' ? 'on' : ''}" data-act="shop" data-arg="ball">Balls</button></div>
      <p class="sub">Every run you score earns a coin. Kit changes the look, not the rules.</p>
      <div class="items">${items}</div>`);
  }

  trophies() {
    const d = this.store.data, s = d.stats;
    const sr = s.balls ? Math.round((s.runs / s.balls) * 100) : 0;
    const got = ACHIEVEMENTS.filter((a) => d.achievements[a.id]).length;
    const medals = Object.values(d.daily).filter((r) => r.medal).length;
    const stat = (k, v) => `<div><strong>${v}</strong><span>${k}</span></div>`;
    const list = ACHIEVEMENTS.map((a) => `<li class="${d.achievements[a.id] ? 'got' : ''}"><i></i><div><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div></li>`).join('');
    this.show(`${this.header('Trophies')}
      <div class="stats">${stat('Runs', s.runs)}${stat('Best innings', s.best)}${stat('Sixes', s.sixes)}${stat('Fours', s.fours)}${stat('Strike rate', sr)}${stat('Perfect shots', s.perfects)}${stat('Best streak', d.bestStreak + 'd')}${stat('Daily medals', medals)}${stat('Windows broken', s.windows)}</div>
      <h3>Achievements ${got}/${ACHIEVEMENTS.length}</h3><ul class="ach">${list}</ul>`);
  }

  settings() {
    const s = this.store.data.settings;
    const sw = (key, label, on, text) => `<button class="row set" data-act="toggle" data-arg="${key}"><b>${label}</b><span class="pill ${on ? 'on' : ''}">${text}</span></button>`;
    const canBuzz = typeof navigator !== 'undefined' && !!navigator.vibrate;
    this.show(`${this.header('Settings')}
      <div class="rows">
        ${sw('sound', 'Sound', s.sound, s.sound ? 'On' : 'Off')}
        ${canBuzz ? sw('haptics', 'Vibration', s.haptics !== false, s.haptics !== false ? 'On' : 'Off') : ''}
        ${sw('guide', 'Timing guide', s.guide !== false, s.guide !== false ? 'On' : 'Off')}
        ${sw('controls', 'Touch controls', true, s.controls === 'tap' ? 'Tap' : 'Swipe')}
        ${sw('hand', 'Batting hand', true, s.hand === 'L' ? 'Left' : 'Right')}
        ${sw('quality', 'Graphics', true, { auto: 'Auto', high: 'Best', low: 'Fast' }[s.quality] || 'Auto')}
      </div>
      <label class="field"><span>Your name on challenge links</span><input id="nameInput" maxlength="14" value="${esc(this.store.data.name)}" placeholder="Letters and numbers" autocomplete="off"></label>
      <p class="sub"><b>Swipe</b> controls: swipe towards where you want to hit. <b>Tap</b> controls: tap the left, middle or right of the screen, and the bat swings the moment you touch.</p>
      <p class="sub">The timing guide is a ring that closes when it is time to swing. It appears in practice and the first levels. Auto graphics lowers the detail by itself if the game runs slowly.</p>
      <p class="sub">Progress is saved in this browser only.</p>
      <button class="btn danger" data-act="reset">Reset all progress</button>`);
    const input = $('nameInput');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
      this.store.data.name = input.value;
      this.store.save();
    });
  }

  toggle(key) {
    const s = this.store.data.settings;
    if (key === 'sound') { this.store.setSetting('sound', !s.sound); this.sound.setEnabled(this.store.data.settings.sound); }
    if (key === 'haptics') { this.store.setSetting('haptics', s.haptics === false); if (this.store.data.settings.haptics) this.game.buzz(30); }
    if (key === 'guide') this.store.setSetting('guide', s.guide === false);
    if (key === 'controls') this.store.setSetting('controls', s.controls === 'tap' ? 'swipe' : 'tap');
    if (key === 'hand') { this.store.setSetting('hand', s.hand === 'L' ? 'R' : 'L'); this.game.applySkins(); }
    if (key === 'quality') this.game.setQuality({ auto: 'high', high: 'low', low: 'auto' }[s.quality] || 'auto');
    this.settings();
  }

  resetStep(el) {
    if (el.dataset.sure) { this.store.reset(); this.sound.setEnabled(true); this.game.applySkins(); this.game.setQuality('auto'); this.home(); this.toast('Progress reset'); return; }
    el.dataset.sure = '1';
    el.textContent = 'Tap again to erase everything';
  }

  // ---------- HUD ----------

  showHud(match) {
    $('hud').hidden = false;
    $('pause').hidden = true;
    $('hTitle').textContent = match.cfg.title;
    $('banner').className = ''; $('timing').className = '';
    this.updateHud(match);
  }

  hideHud() { $('hud').hidden = true; $('pause').hidden = true; }

  updateHud(m) {
    const cfg = m.cfg;
    $('hRuns').textContent = m.runs;
    $('hWk').textContent = cfg.wickets === Infinity ? '' : '/' + m.wickets;
    $('hOvers').textContent = cfg.balls === Infinity ? m.oversText + ' ov' : m.oversText + ' / ' + cfg.balls / 6 + ' ov';
    let goal = '', pct = 0;
    if (cfg.mode === 'daily') {
      const md = DAILY.medals;
      const ch = this.challenge && this.challenge.day === cfg.day ? this.challenge : null;
      const next = m.runs < md.bronze ? ['Bronze', md.bronze, 0] : m.runs < md.silver ? ['Silver', md.silver, md.bronze] : m.runs < md.gold ? ['Gold', md.gold, md.silver] : null;
      if (ch && m.runs <= ch.runs) { goal = `Beat ${ch.name}: ${ch.runs}`; pct = m.runs / Math.max(1, ch.runs + 1); }
      else if (next) { goal = `${next[0]} at ${next[1]}`; pct = (m.runs - next[2]) / (next[1] - next[2]); }
      else { goal = 'Gold secured'; pct = 1; }
    } else if (cfg.mode === 'chase') {
      goal = m.need > 0 ? `Need ${m.need} from ${m.ballsLeft}` : 'Target reached';
      pct = m.runs / cfg.target;
    } else if (cfg.mode === 'survival') {
      const best = this.store.data.survivalBest;
      goal = best ? `Best ${best}` : 'Set a score';
      pct = best ? m.runs / best : 0;
    } else if (cfg.mode === 'superover') {
      const best = this.store.data.superBest;
      goal = best ? `Best ${best}` : 'Max ' + SUPER_OVER.max;
      pct = m.runs / (best || SUPER_OVER.max);
    } else goal = 'Free hit practice';
    $('hGoal').textContent = goal;
    $('hBar').style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
    const lives = cfg.wickets === Infinity ? '' : '<i class="life"></i>'.repeat(Math.max(0, m.wicketsLeft)) + '<i class="life gone"></i>'.repeat(m.wickets);
    $('hLives').innerHTML = lives;
    $('hOver').innerHTML = m.over.map((b) => `<i class="${b === 'W' ? 'w' : b === '6' ? 'six' : b === '4' ? 'four' : b === '0' ? 'dot' : ''}">${b === '0' ? '&middot;' : b}</i>`).join('');
  }

  pulse(id, cls, ms) {
    const el = $(id);
    el.className = '';
    void el.offsetWidth; // restart the animation
    el.className = cls;
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => { el.className = ''; }, ms);
  }

  banner(text, sub, kind) {
    $('banner').innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    this.pulse('banner', 'show ' + kind, 1500);
  }

  timing(label, err, w) {
    const names = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', miss: 'MISSED', edge: 'EDGE' };
    const pos = err === null || err === undefined ? 0 : Math.max(-1, Math.min(1, err / (TIMING.early * (w || 1))));
    $('timing').innerHTML = `<b>${names[label] || ''}</b><div class="meter"><u></u><i style="left:${50 + pos * 50}%"></i></div><small><span>early</span><span>late</span></small>`;
    this.pulse('timing', 'show ' + label, 1300);
  }

  overCard(title, sub) {
    $('overCard').innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    this.pulse('overCard', 'show', 1600);
  }

  hint(text, ms = 4000) {
    $('hint').textContent = text;
    this.pulse('hint', 'show', ms);
  }

  toast(text) {
    $('toast').textContent = text;
    this.pulse('toast', 'show', 1800);
  }

  setLoft(on) {
    const b = $('loftBtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('b').textContent = on ? 'ON' : 'OFF';
  }

  showPause(on) {
    $('pause').hidden = !on;
  }

  // ---------- result ----------

  showResult(m, r) {
    const cfg = m.cfg, d = this.store.data;
    this.lastMatch = m;
    this.hideHud();
    const sr = m.legal ? Math.round((m.runs / m.legal) * 100) : 0;
    let head = '', extra = '', buttons = '';
    if (cfg.mode === 'daily') {
      const md = DAILY.medals;
      const medal = r.medal;
      head = medal ? `<div class="bigmedal ${medal}"><i></i>${MEDAL_NAME[medal]} medal</div>` : `<p class="sub">Bronze starts at ${md.bronze} runs.</p>`;
      const nextAt = m.runs < md.bronze ? md.bronze : m.runs < md.silver ? md.silver : m.runs < md.gold ? md.gold : null;
      if (medal && nextAt) extra += `<p class="sub">${nextAt - m.runs} more for ${m.runs < md.silver ? 'silver' : 'gold'}.</p>`;
      const best = d.daily[cfg.day] ? d.daily[cfg.day].best : m.runs;
      extra += `<p class="sub">Best today: <b>${best}</b>${r.streak ? ` &middot; ${r.streak}-day streak` : ''}</p>`;
      const ch = this.challenge && this.challenge.day === cfg.day ? this.challenge : null;
      if (ch) extra += `<p class="vs ${m.runs > ch.runs ? 'win' : ''}">${m.runs > ch.runs ? `You beat ${esc(ch.name)}'s ${ch.runs}!` : `${esc(ch.name)} still leads with ${ch.runs}.`}</p>`;
      buttons = '<button class="btn primary" data-act="share">Challenge a friend</button>' + this.whatsappButton() + '<button class="btn" data-act="again">Play again</button>';
    } else if (cfg.mode === 'chase') {
      const won = m.reason === 'won';
      head = `<div class="verdict ${won ? 'won' : 'lost'}">${won ? 'Chase complete' : 'Fell short'}</div>` + (won ? `<div class="stars">${'&#9733;'.repeat(r.stars)}<u>${'&#9733;'.repeat(3 - r.stars)}</u></div>` : `<p class="sub">Needed ${cfg.target}. ${m.need} short.</p>`);
      const next = cfg.level + 1;
      buttons = (won && next < LEVELS.length ? `<button class="btn primary" data-act="level" data-arg="${next}">Next level</button>` : '') + `<button class="btn ${won ? '' : 'primary'}" data-act="again">${won ? 'Replay' : 'Try again'}</button>`;
    } else if (cfg.mode === 'survival') {
      head = `<p class="sub">${m.runs >= d.survivalBest && m.runs > 0 ? 'New personal best!' : 'Best: ' + d.survivalBest}</p>`;
      buttons = '<button class="btn primary" data-act="again">Play again</button><button class="btn" data-act="share">Share score</button>' + this.whatsappButton();
    } else if (cfg.mode === 'superover') {
      const perfect = m.runs >= SUPER_OVER.max;
      head = `<p class="sub">${perfect ? 'A perfect over. Six sixes!' : r.newBest ? 'New personal best!' : 'Best: ' + d.superBest + ' of ' + SUPER_OVER.max}</p>`;
      buttons = '<button class="btn primary" data-act="again">Another over</button><button class="btn" data-act="share">Share score</button>' + this.whatsappButton();
    }
    const ach = r.unlocked.map((a) => `<li><i></i><b>${esc(a.name)}</b> ${esc(a.desc)}</li>`).join('');
    this.show(`
      <div class="res-title">${esc(cfg.title)}</div>
      <div class="res-score">${m.runs}<small>${cfg.wickets === Infinity ? '' : '/' + m.wickets}</small></div>
      <div class="res-overs">${m.oversText} overs</div>
      ${head}
      <div class="stats four"><div><strong>${m.sixes}</strong><span>Sixes</span></div><div><strong>${m.fours}</strong><span>Fours</span></div><div><strong>${m.perfects}</strong><span>Perfect</span></div><div><strong>${sr}</strong><span>Strike rate</span></div></div>
      ${extra}
      ${r.coins > 0 ? `<div class="earned"><i class="c"></i>+${r.coins} coins</div>` : ''}
      ${ach ? `<ul class="unlocked">${ach}</ul>` : ''}
      ${buttons}
      <button class="btn ghost" data-act="home">Home</button>`, 'result');
  }

  // A direct WhatsApp link, since that is where most scores get shared.
  whatsappButton() {
    const text = this.shareText();
    return text ? `<a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Share on WhatsApp</a>` : '';
  }

  shareText() {
    const m = this.lastMatch;
    if (!m) return '';
    const cfg = m.cfg;
    // A link back to the game only makes sense when it is hosted at its own web address.
    const http = /^https?:$/.test(location.protocol) && !window.__SINGLE_FILE__;
    const base = http ? location.origin + location.pathname : '';
    const name = this.store.data.name;
    if (cfg.mode === 'daily') {
      const medal = m.medal();
      const icon = { gold: '🥇', silver: '🥈', bronze: '🥉' }[medal] || '';
      const link = base ? `\nBeat me: ${base}#beat-${cfg.day}-${m.runs}${name ? '-' + name : ''}` : '';
      return `Gully Sixes Daily #${cfg.day + 1} 🏏\n${m.runs}/${m.wickets} in ${m.oversText} overs ${icon}\n6️⃣ x${m.sixes}  4️⃣ x${m.fours}${link}`;
    }
    const balls = m.log.filter((b) => !b.wide).map((b) => (b.out ? '🔴' : b.runs === 6 ? '6️⃣' : b.runs === 4 ? '4️⃣' : b.runs === 0 ? '⚪' : b.runs + '️⃣')).join('');
    if (cfg.mode === 'superover') return `Gully Sixes Super Over 🏏\n${m.runs} off ${m.legal} balls\n${balls}${base ? '\nCan you beat it? ' + base : ''}`;
    return `Gully Sixes Survival 🏏\n${m.runs} runs, ${m.sixes} sixes${base ? '\nCan you beat it? ' + base : ''}`;
  }

  share(el) {
    const text = this.shareText();
    const done = (ok) => { const old = el.textContent; el.textContent = ok ? 'Copied! Paste it to a friend' : 'Could not copy'; setTimeout(() => { el.textContent = old; }, 2200); };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    const copy = () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
        else fallback();
      } catch (e) { fallback(); }
    };
    // Phones get their own share sheet. If it is unavailable or refused, copy the text instead.
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      let p;
      try { p = navigator.share({ text }); } catch (e) { copy(); return; }
      if (p && p.catch) p.catch((err) => { if (!err || err.name !== 'AbortError') copy(); });
      return;
    }
    copy();
  }

  fatal(message, reload) {
    $('hud').hidden = true;
    $('pause').hidden = true;
    $('screens').hidden = false;
    $('screens').className = 'screens';
    $('screens').innerHTML = `<div class="panel"><h2>${reload ? 'Gully Sixes hit a problem' : 'Gully Sixes cannot start'}</h2><p>${esc(message)}</p>${reload ? '<button class="btn primary" data-act="reload">Reload</button>' : ''}</div>`;
  }
}
