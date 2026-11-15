// Ties the simulation to the 3D scene: match flow, camera, effects, sound and graphics quality.
import * as THREE from 'three';
import { STREET, PITCH, TIMING } from './config.js';
import { World } from './world.js';
import { Kid, Batter, Bowler } from './actors.js';
import { Match } from './modes.js';
import { dayNumber } from './store.js';

const FIELDER_SHIRTS = ['#e45b4f', '#57b894', '#f2b134', '#b784d6', '#5b8def'];
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Graphics levels: 0 fast, 1 balanced, 2 best. "Auto" starts high and steps down if frames are slow.
const PIXEL_CAP = [1, 1.5, 2];
const FIREWORK_COLORS = [['#ffd23f', '#ff7a3d', '#fff2a8'], ['#7cc4ff', '#ffffff', '#5b8def'], ['#ff6fb1', '#ffd1ea', '#e2452f'], ['#7fe0a2', '#eaffd0', '#2e9c8f']];

// Short lines shown under the big result text. One is picked per ball.
const LINES = {
  six: ['Over the wall!', 'That is in the next gully', 'Kya shot hai!', 'Someone fetch that', 'Clean as a whistle', 'All the way'],
  sixRoof: ['Onto the roof', 'Up on the terrace', 'Landed by the water tank'],
  four: ['To the far wall', 'Racing away', 'No stopping that', 'Found the gap'],
  fourRoof: ['Off the wall and over'],
  bowled: ['Clean through the gate', 'Stumps everywhere', 'Missed it. The stumps did not', 'Timber!'],
  caught: ['Straight to the fielder', 'Safe hands', 'Picked out the fielder', 'He does not drop those'],
  onetip: ['Gully rules: caught on the bounce is out', 'One bounce, one hand, gone'],
  window: ['Aunty says you are out', 'Aunty is keeping the ball', 'That comes out of your pocket money', 'Kaun hai? Out hai!'],
  lost: ['That roof never gives it back', 'Ball gaya. So are you', 'Nobody is climbing up there'],
  early: ['Too early', 'Swung before it arrived'],
  late: ['Too late', 'It was past you'],
  fielded: ['Straight to a fielder', 'Good stop', 'Cut off in the ring'],
  leave: ['Left alone', 'Watching it go by']
};

const SAVED = { bowled: 'Bowled', caught: 'The catch', onetip: 'The catch', window: 'The broken window', lost: 'The lost ball' };

// Dust, sparks, glass and fireworks: one instanced mesh, so any number of particles is one draw call.
class Particles {
  constructor(scene, count = 240) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: false }), count);
    this.mesh.frustumCulled = false;
    this.items = [];
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < count; i++) {
      this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, g: 9, size: 0.05, spin: 0, floor: true, live: false });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, white);
    }
    this.next = 0;
    this.color = new THREE.Color();
    scene.add(this.mesh);
  }
  burst(x, y, z, { color = '#ffffff', n = 8, speed = 2, size = 0.05, life = 0.6, g = 9, up = 1, sphere = false, floor = true } = {}) {
    for (let i = 0; i < n; i++) {
      const idx = this.next;
      const p = this.items[idx];
      this.next = (this.next + 1) % this.items.length;
      p.p.set(x, y, z);
      p.size = size * (0.6 + Math.random() * 0.8);
      if (sphere) {
        const a = Math.random() * Math.PI * 2, c = Math.random() * 2 - 1, r = Math.sqrt(1 - c * c), sp = speed * (0.55 + Math.random() * 0.45);
        p.v.set(Math.cos(a) * r * sp, c * sp, Math.sin(a) * r * sp);
      } else {
        p.v.set((Math.random() - 0.5) * 2 * speed, Math.random() * speed * up, (Math.random() - 0.5) * 2 * speed);
      }
      p.life = p.max = life * (0.7 + Math.random() * 0.6);
      p.g = g; p.floor = floor; p.live = true; p.spin = Math.random() * 6;
      this.mesh.setColorAt(idx, this.color.set(Array.isArray(color) ? color[i % color.length] : color));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.live) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; this.mesh.setMatrixAt(i, ZERO); continue; }
      p.v.y -= p.g * dt;
      p.p.addScaledVector(p.v, dt);
      p.spin += dt * 6;
      if (p.floor && p.p.y < 0.02) { p.p.y = 0.02; p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; }
      const s = p.size * Math.min(1, (p.life / p.max) * 2.2);
      M.compose(p.p, Q.setFromEuler(E.set(p.spin, p.spin * 0.7, 0)), S.set(s, s, s));
      this.mesh.setMatrixAt(i, M);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Game {
  constructor(canvas, store, sound, ui) {
    this.canvas = canvas;
    this.store = store;
    this.sound = sound;
    this.ui = ui;
    this.state = 'menu';
    this.stateT = 0;
    this.time = 0;
    this.paused = false;
    this.match = null;
    this.play = null;
    this.loft = false;
    this.loftHeld = false;
    this.shake = 0;
    this.slowT = 0;
    this.fw = 0;
    this.fwT = 0;
    this.guide = false;
    this.stance = 0;         // how far the batter has shuffled across the crease, in metres
    this.moveDir = 0;        // -1, 0 or 1 while a move button or key is held
    this.auto = null;        // test hook: plays shots automatically
    this.onMatchEnd = null;
    this.pendingAfter = null;
    this.errors = 0;
    this.dead = false;
    this.contextLost = false;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const st = store.data.settings;
    this.level = st.quality === 'low' ? 0 : st.quality === 'high' ? 2 : clamp(Number.isInteger(st.autoLevel) ? st.autoLevel : 2, 0, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.level > 0, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.level === 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camPos = new THREE.Vector3(0, 6, 8);
    this.camLook = new THREE.Vector3(0, 1, -12);
    this.world = new World(this.scene);
    this.particles = new Particles(this.scene);

    this.batter = new Batter(this.scene);
    this.bowler = new Bowler(this.scene);
    this.fielders = FIELDER_SHIRTS.map((shirt, i) => {
      const k = new Kid({ shirt, skin: i + 2, scale: 0.98 + (i % 3) * 0.05 });
      this.scene.add(k.group);
      return k;
    });
    this.kids = [this.batter.kid, this.bowler.kid, ...this.fielders];

    this.ballMat = new THREE.MeshLambertMaterial({ color: '#d7f23c', emissive: '#56610f', emissiveIntensity: 0.35 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), this.ballMat);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);
    this.trailLen = 9;
    this.trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, depthWrite: false }), this.trailLen);
    this.trail.frustumCulled = false;
    for (let i = 0; i < this.trailLen; i++) this.trail.setMatrixAt(i, ZERO);
    this.scene.add(this.trail);
    this.trailPts = [];
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 28), new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    // Timing guide: the outer ring closes on the inner one at the moment to swing.
    const ringMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
    this.ringIn = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.31, 36), ringMat('#ffffff', 0.75));
    this.ringOut = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.345, 36), ringMat('#ffe14a', 0.95));
    this.ringIn.renderOrder = this.ringOut.renderOrder = 5;
    this.ringIn.visible = this.ringOut.visible = false;
    this.scene.add(this.ringIn, this.ringOut);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.pause(true); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });

    this.applySkins();
    this.setupMenuScene();
    this.applyLevel(this.level);
    this.fps = { frames: 0, sum: 0, slow: 0, skip: 1.5 };
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  get hand() { return this.store.data.settings.hand; }
  get handSign() { return this.hand === 'L' ? -1 : 1; }
  get lofted() { return this.loft || this.loftHeld; }

  applySkins() {
    this.batter.setSkin(this.store.batSkin());
    const c = this.store.ballSkin().color;
    this.ballMat.color.set(c);
    this.ballMat.emissive.set(c).multiplyScalar(0.3);
    this.batter.setHand(this.hand);
  }

  // ---------- graphics quality ----------

  applyLevel(level) {
    this.level = clamp(level, 0, 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_CAP[this.level]));
    this.world.setShadows(this.level > 0, this.level === 2 ? 2048 : 1024);
    this.world.setLamps(this.level > 0);
    for (const k of this.kids) k.blob.visible = this.level === 0;
    this.resize();
    if (this.fps) { this.fps.frames = 0; this.fps.sum = 0; this.fps.slow = 0; this.fps.skip = 1; }
  }

  // Called when the player changes the Graphics setting.
  setQuality(mode) {
    this.store.setSetting('quality', mode);
    if (mode === 'low') this.applyLevel(0);
    else if (mode === 'high') this.applyLevel(2);
    else { this.store.setSetting('autoLevel', 2); this.applyLevel(2); }
  }

  // In auto mode, step the graphics down when the device cannot keep up.
  // Frame times are averaged over two-second windows; two slow windows in a row lower the level.
  watchFrameRate(rawDt) {
    const f = this.fps;
    if (this.store.data.settings.quality !== 'auto' || this.level === 0 || this.paused || document.hidden) return;
    if (rawDt > 1) return;                                // the tab was in the background
    if (f.skip > 0) { f.skip -= rawDt; return; }          // shaders are still compiling
    f.frames++; f.sum += rawDt;
    if (f.sum < 2 || f.frames < 5) return;
    const avg = f.sum / f.frames;
    f.frames = 0; f.sum = 0;
    f.slow = avg > 1 / 40 ? f.slow + 1 : 0;
    if (f.slow >= 2) {
      this.applyLevel(this.level - 1);
      this.store.setSetting('autoLevel', this.level);
    }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.75 ? 68 : aspect < 1.2 ? 58 : 48;
    this.camera.updateProjectionMatrix();
  }

  // ---------- lighting themes ----------

  clockTheme() {
    const h = new Date().getHours();
    return h >= 6 && h < 17 ? 'day' : h < 19 && h >= 17 ? 'dusk' : 'night';
  }

  matchTheme() {
    const cfg = this.match.cfg;
    if (cfg.mode === 'survival') { const o = this.match.overIndex; return o < 3 ? 'day' : o < 6 ? 'dusk' : 'night'; }
    return cfg.theme || 'day';
  }

  // ---------- match flow ----------

  setupMenuScene() {
    this.state = 'menu';
    this.play = null;
    this.match = null;
    this.ball.visible = false; this.blob.visible = false; this.marker.visible = false;
    this.ringIn.visible = this.ringOut.visible = false;
    this.hideTrail();
    this.fw = 0;
    this.bowler.home();
    this.batter.reset();
    this.world.resetStumps();
    this.world.setTheme(this.clockTheme(), { instant: true });
    this.stance = 0;
    this.batter.setOffset(0, false);
    this.ui.setFreeHit(false);
    const spots = [[-3.2, 12.5], [3.3, 16.5], [-0.9, 25], [2.2, 8], [-2.6, 20]];
    this.fielders.forEach((k, i) => { k.group.visible = i < 4; k.place(spots[i][0], spots[i][1]); k.state = 'idle'; k.group.rotation.y = 0; });
  }

  startMatch(cfg) {
    this.match = new Match(cfg);
    this.world.resetWindows();
    this.world.resetStumps();
    this.world.setTheme(this.matchTheme(), { festive: !!cfg.festive, instant: true });
    this.applySkins();
    this.loft = false;
    this.ui.setLoft(false);
    this.paused = false;
    this.pendingAfter = null;
    this.fw = 0;
    this.stance = 0;
    const st = this.store.data;
    this.guide = st.settings.guide !== false && (cfg.mode === 'practice' || (cfg.mode === 'chase' && cfg.level < 3) || st.stats.innings < 2);
    this.ui.showHud(this.match);
    this.state = 'intro';
    this.stateT = 0;
    this.introOver();
  }

  introOver() {
    const b = this.match.bowler();
    this.bowler.kid.setShirt(b.shirt);
    this.bowler.home();
    const n = this.match.overIndex + 1;
    if (this.match.cfg.mode === 'survival') this.world.setTheme(this.matchTheme(), { instant: this.match.legal === 0 });
    this.ui.overCard(this.match.legal === 0 ? this.match.cfg.title : 'Over ' + n, b.name + ' · ' + b.style);
  }

  beginBall() {
    this.play = this.match.nextPlay(this.hand);
    this.play.stanceX = this.stance;
    this.ui.setFreeHit(this.play.freeHit);
    this.outcomeShown = false;
    const fs = this.play.fielders;
    this.fielders.forEach((k, i) => {
      const f = fs[i + 1];
      k.group.visible = !!f;
      if (f) { k.place(f.x, f.z); k.state = 'ready'; k.group.rotation.y = 0; }
    });
    this.world.resetStumps();
    this.batter.reset();
    this.bowler.start(this.play.d.noBall ? 0.45 : 0);
    this.ball.visible = false; this.blob.visible = false;
    this.hideTrail();
    this.marker.visible = false;
    this.ringIn.visible = this.ringOut.visible = false;
    this.state = 'runup';
    this.stateT = 0;
    this.ui.updateHud(this.match);
  }

  swing(aim) {
    if (this.paused || this.state !== 'live' || !this.play) return false;
    const loft = this.lofted;
    if (!this.play.swingAt(aim, loft)) return false;
    this.batter.swing(aim, loft);
    this.sound.whoosh();
    this.ringIn.visible = this.ringOut.visible = false;
    return true;
  }

  setLoft(on) { this.loft = on; this.ui.setLoft(this.lofted); }
  holdLoft(on) { this.loftHeld = on; this.ui.setLoft(this.lofted); }

  pause(on) {
    if (this.state === 'menu' || this.state === 'ended') return;
    this.paused = on;
    this.ui.showPause(on);
  }

  quit() {
    this.paused = false;
    this.ui.hideHud();
    this.setupMenuScene();
  }

  buzz(pattern) {
    if (this.store.data.settings.haptics === false) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ }
  }

  fireworks(n) { this.fw = Math.max(this.fw, n); }

  finishMatch() {
    this.state = 'ended';
    const m = this.match;
    const result = this.store.record(m, dayNumber());
    const good = m.reason === 'won' || m.medal() || result.newBest;
    if (good) { this.sound.win(); if (this.world.dark) this.fireworks(8); }
    else if (m.cfg.mode === 'chase') this.sound.lose();
    if (result.coins > 0) this.sound.coin();
    this.fielders.forEach((k) => { if (k.group.visible) k.state = m.reason === 'won' ? 'sad' : 'celebrate'; });
    this.ui.showResult(m, result);
    if (this.onMatchEnd) this.onMatchEnd(m, result);
  }

  // ---------- per-frame ----------

  frame(now) {
    requestAnimationFrame(this.frame);
    if (this.dead) return;
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, Math.max(0, raw));
    this.last = now;
    try {
      this.watchFrameRate(raw);
      if (!this.paused) {
        let scale = 1;
        if (this.slowT > 0) { this.slowT -= dt; scale = 0.3; }
        this.update(dt * scale);
      }
      if (!this.contextLost) this.renderer.render(this.scene, this.camera);
      this.errors = 0;
    } catch (err) {
      // One bad frame should not freeze the game; several in a row means something is broken.
      if (window.console) console.error(err);
      if (++this.errors > 4) {
        this.dead = true;
        this.ui.fatal('Something went wrong while running the game. Reload the page to continue. Your saved progress is safe.', true);
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.stateT += dt;
    const play = this.play;
    let bowlerDone = false;

    if (this.state === 'intro') {
      if (this.stateT > 1.7) this.beginBall();
    } else if (this.state === 'runup') {
      if (this.stateT > 0.55) this.batter.backlift();
      bowlerDone = true;
      if (this.bowler.update(dt, null)) {
        this.state = 'live';
        this.stateT = 0;
        this.ball.visible = true; this.blob.visible = true;
        const d = play.d;
        if (d.noBall) { this.ui.call('NO BALL!', 'Free hit next ball'); this.sound.call(); this.buzz(40); }
        if (d.marker) { this.marker.visible = true; this.marker.position.set(d.bounceX, 0.03, -d.bounceZ); }
        if (this.guide) {
          const y = clamp(d.contactY, 0.3, 1.5);
          this.ringIn.position.set(d.contactX, y, -PITCH.idealZ + 0.05);
          this.ringOut.position.copy(this.ringIn.position);
          this.ringIn.visible = this.ringOut.visible = true;
        }
      }
    } else if (this.state === 'live') {
      if (this.auto && !play.swing && play.phase === 'flight') {
        const shot = this.auto(play, this.match);
        if (shot && play.t >= play.d.tIdeal - TIMING.lag + shot.offset) { this.loft = !!shot.loft; this.swing(shot.aim || 0); }
      }
      play.step(dt);
      for (const e of play.drainEvents()) this.onEvent(e);
      if (this.ringOut.visible) this.updateGuide(play);
      if (play.outcome && !this.outcomeShown) this.showOutcome(play.outcome);
      if (play.phase === 'done') this.afterBall();
    } else if (this.state === 'gap') {
      if (this.stateT > this.gapFor) {
        if (this.pendingAfter === 'finish') this.finishMatch();
        else if (this.pendingAfter === 'over') { this.state = 'intro'; this.stateT = 0; this.match.startNewOver(); this.ui.updateHud(this.match); this.introOver(); }
        else this.beginBall();
        this.pendingAfter = null;
      }
    }

    // The batter can shuffle across the crease until the bat has started to swing.
    let moving = false;
    if (this.moveDir && this.match && this.state !== 'ended') {
      const free = this.state !== 'live' || (play && play.phase === 'flight' && !play.swing);
      if (free) {
        const next = clamp(this.stance + this.moveDir * 1.5 * dt, -0.55, 0.55);
        moving = next !== this.stance;
        this.stance = next;
      }
    }
    this.batter.setOffset(this.stance, moving);
    if (play) play.stanceX = this.stance;

    if (!bowlerDone) this.bowler.update(dt, play && this.state === 'live' ? play.fielders[0] : null);
    this.batter.update(dt);
    this.syncFielders(dt);
    this.syncBall(dt);
    this.world.update(dt, this.time);
    this.ballMat.emissiveIntensity = 0.35 + this.world.state.stars * 0.8;
    if (this.fw > 0) {
      this.fwT -= dt;
      if (this.fwT <= 0) {
        this.fw--;
        this.fwT = 0.14 + Math.random() * 0.22;
        const pal = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        // above the far end of the street, where the camera is looking whether it is behind the batter or following the ball
        this.particles.burst((Math.random() - 0.5) * 18, 8 + Math.random() * 6, -(24 + Math.random() * 20), { color: pal, n: 28, speed: 6, size: 0.2, life: 1.3, g: 2.4, sphere: true, floor: false });
        this.sound.pop();
      }
    }
    this.particles.update(dt);
    if (this.marker.visible) { const s = 1 + Math.sin(this.time * 9) * 0.12; this.marker.scale.set(s, s, s); }
    this.updateCamera(dt);
  }

  updateGuide(play) {
    if (play.swing || play.phase !== 'flight') { this.ringIn.visible = this.ringOut.visible = false; return; }
    const rem = play.d.tIdeal - TIMING.lag - play.t;      // time left until the right moment to swing
    if (rem < -0.09) { this.ringIn.visible = this.ringOut.visible = false; return; }
    const s = 1 + clamp(rem / 0.55, 0, 1) * 1.9;
    this.ringOut.scale.set(s, s, s);
    this.ringOut.material.color.set(Math.abs(rem) <= TIMING.good * play.w ? '#7dff9a' : '#ffe14a');
  }

  afterBall() {
    const m = this.match;
    this.state = 'gap';
    this.stateT = 0;
    this.gapFor = 0.35;
    if (m.finished) { this.pendingAfter = 'finish'; this.gapFor = 0.7; }
    else if (this.lastApply && this.lastApply.overDone) { this.pendingAfter = 'over'; this.gapFor = 0.3; }
    else this.pendingAfter = 'ball';
  }

  onEvent(e) {
    const Pt = this.particles;
    switch (e.type) {
      case 'bounce':
        this.sound.bounce();
        Pt.burst(e.x, 0.05, -e.z, { color: '#cdbb9a', n: 5, speed: 1.1, size: 0.05, life: 0.4, g: 4 });
        if (e.pitch) this.marker.visible = false;
        break;
      case 'bat':
        this.sound.bat(e.q);
        this.marker.visible = false;
        this.ringIn.visible = this.ringOut.visible = false;
        this.ui.timing(e.edge ? 'edge' : e.label, this.play.timingErr, this.play.w);
        Pt.burst(e.x, e.y, -e.z, { color: e.label === 'perfect' ? ['#fff2a8', '#ffd23f'] : '#ffffff', n: e.label === 'perfect' ? 12 : 5, speed: 2.4, size: 0.045, life: 0.35, g: 3 });
        if (e.label === 'perfect') {
          this.buzz(e.loft ? 35 : 20);
          if (!this.reduced) { this.shake = 0.12; if (e.loft) this.slowT = 0.13; }
        } else this.buzz(10);
        break;
      case 'miss':
        this.ui.timing(e.label, this.play.timingErr, this.play.w);
        break;
      case 'stumps':
        this.world.knockStumps(e.x * 2);
        this.sound.wicket();
        this.buzz([40, 60, 90]);
        if (!this.reduced) this.shake = 0.18;
        Pt.burst(0, 0.5, -PITCH.stumpsZ, { color: ['#ffd23f', '#e2452f'], n: 10, speed: 3, size: 0.04, life: 0.7 });
        break;
      case 'wall': this.sound.thud(); break;
      case 'glass':
        this.world.breakWindow(e.win);
        this.sound.glass();
        this.buzz([30, 40, 30, 40, 60]);
        Pt.burst(e.side * (STREET.halfW - 0.15), e.y, -e.z, { color: ['#dff4ff', '#a9d8ee', '#ffffff'], n: 26, speed: 3.2, size: 0.07, life: 1.1 });
        break;
      case 'catch': this.sound.catchBall(); this.buzz(60); break;
      case 'drop': this.ui.toast('Dropped!'); break;
      case 'misfield': this.ui.toast('Misfield!'); break;
      default: break;
    }
  }

  line(key) {
    const list = LINES[key];
    return list[(this.match.seq * 7 + this.match.runs + this.match.legal) % list.length];
  }

  showOutcome(o) {
    this.outcomeShown = true;
    const m = this.match;
    this.lastApply = m.apply(o);
    let text = '', sub = '', kind = 'run';
    if (o.out) {
      kind = 'out';
      text = { bowled: 'BOWLED!', caught: 'CAUGHT!', onetip: 'ONE TIP, ONE HAND!', window: 'WINDOW BROKEN!', lost: 'BALL LOST!' }[o.out];
      sub = this.line(o.out);
      if (m.cfg.wickets === Infinity) sub = 'Practice: no wicket lost';
      if (o.out !== 'bowled') this.sound.out();
      this.fielders.forEach((k, i) => { if (k.group.visible && this.play.fielders[i + 1] && this.play.fielders[i + 1].state !== 'catch') k.state = 'celebrate'; });
    } else if (o.boundary === 6) {
      kind = 'six'; text = 'SIX!';
      sub = o.noBall ? 'Off a no ball: 7 runs and a free hit' : m.sixStreak >= 2 ? m.sixStreak + ' sixes in a row' : this.line(o.roof ? 'sixRoof' : 'six');
      this.sound.cheer(true);
      this.buzz([25, 30, 60]);
      this.particles.burst(this.ball.position.x, Math.max(2, this.ball.position.y), this.ball.position.z, { color: ['#ff7a3d', '#ffd23f', '#2e9c8f', '#e2452f', '#5b8def'], n: 30, speed: 4.5, size: 0.09, life: 1.4, g: 5 });
      if (this.world.dark) this.fireworks(m.sixStreak >= 2 ? 5 : 3);
      this.fielders.forEach((k) => { if (k.group.visible) k.state = 'sad'; });
    } else if (o.boundary === 4) {
      kind = 'four'; text = 'FOUR!'; sub = o.noBall ? 'Off a no ball: 5 runs and a free hit' : this.line(o.roof ? 'fourRoof' : 'four');
      this.sound.cheer(false);
    } else if (o.wide) {
      text = 'WIDE'; sub = '+1 and the ball is bowled again';
    } else if (o.saved) {
      // What would have been a wicket does not count off a no ball or on a free hit.
      text = 'NOT OUT!';
      sub = SAVED[o.saved] + ' does not count ' + (o.noBall ? 'off a no ball. Free hit next' : 'on a free hit');
      this.sound.run();
    } else if (o.noBall) {
      text = 'NO BALL'; sub = (o.runs > 1 ? o.runs + ' runs in all. ' : '+1. ') + 'Free hit next ball';
      this.sound.run();
    } else if (o.runs > 0) {
      text = o.runs + (o.runs === 1 ? ' RUN' : ' RUNS'); this.sound.run();
    } else {
      kind = 'dot'; text = 'DOT';
      sub = this.line(o.timing === 'early' ? 'early' : o.timing === 'late' ? 'late' : o.timing ? 'fielded' : 'leave');
    }
    this.ui.banner(text, sub, kind);
    this.ui.updateHud(m);
  }

  syncFielders(dt) {
    const play = this.play;
    if (!play || this.state === 'menu') { this.fielders.forEach((k) => k.update(dt)); return; }
    this.fielders.forEach((k, i) => {
      const f = play.fielders[i + 1];
      if (!f || !k.group.visible) return;
      k.place(f.x, f.z);
      if (!this.outcomeShown || f.state === 'catch' || f.state === 'field') {
        const map = { idle: 'ready', run: 'run', ready: 'ready', catch: 'catch', field: 'field', drop: 'drop' };
        k.state = map[f.state] || 'ready';
      }
      if (f.state === 'run') k.face(f.dirX, f.dirZ, dt);
      else k.face(-f.x * 0.05, -1, dt, 5);
      k.update(dt);
    });
  }

  syncBall() {
    const play = this.play;
    if (!play || this.state === 'menu' || this.state === 'runup' || this.state === 'intro') return;
    const b = play.ball;
    let x = b.x, y = b.y, z = b.z;
    if (b.held >= 0) { const f = play.fielders[b.held]; x = f.x; z = f.z; y = f.state === 'catch' ? 1.75 : 0.35; }
    this.ball.visible = !b.hidden;
    this.ball.position.set(x, y, -z);
    this.blob.visible = !b.hidden && y < 12;
    this.blob.position.set(x, 0.025, -z);
    const s = 1 + y * 0.18;
    this.blob.scale.set(s, s, s);
    this.blob.material.opacity = Math.max(0.06, 0.38 - y * 0.045);

    // a short white streak behind a fast ball makes it easier to follow
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    this.trailPts.unshift({ x, y, z: -z });
    if (this.trailPts.length > this.trailLen + 1) this.trailPts.pop();
    const on = speed > 9 && b.held < 0 && !b.hidden;
    for (let i = 0; i < this.trailLen; i++) {
      const p = this.trailPts[i + 1];
      if (on && p) {
        const k = 1 - i * 0.09;
        M.compose(P.set(p.x, p.y, p.z), Q.identity(), S.set(k, k, k));
        this.trail.setMatrixAt(i, M);
      } else this.trail.setMatrixAt(i, ZERO);
    }
    this.trail.instanceMatrix.needsUpdate = true;
  }

  hideTrail() {
    this.trailPts.length = 0;
    for (let i = 0; i < this.trailLen; i++) this.trail.setMatrixAt(i, ZERO);
    this.trail.instanceMatrix.needsUpdate = true;
  }

  updateCamera(dt) {
    const hs = this.handSign;
    // the camera slides with the batter so the ball is never hidden behind them
    const camX = 0.45 * hs + this.stance * 0.8;
    const pos = P.set(camX, 2.15, 4.7);
    const look = S.set(this.stance * 0.45, 0.95, -9);
    let rate = 3.5;
    if (this.state === 'menu' || this.state === 'ended') {
      const a = this.time * 0.12;
      pos.set(Math.sin(a) * 3.2, 5.2 + Math.sin(a * 0.7) * 0.6, 7.5);
      look.set(0, 1.2, -13);
      rate = 1.2;
    } else if (this.play && (this.play.phase === 'struck' || (this.play.phase !== 'flight' && this.play.struckT > 0))) {
      const b = this.play.ball;
      const bz = Math.max(0, b.z);
      pos.set(camX + b.x * 0.22, 2.15 + Math.min(3.2, b.y * 0.22 + bz * 0.03), 4.7 - Math.min(7.5, bz * 0.3));
      look.set(b.x * 0.85, Math.max(0.6, b.y * 0.85), -Math.max(4, b.z));
      rate = 5;
    }
    this.camPos.x = damp(this.camPos.x, pos.x, rate, dt);
    this.camPos.y = damp(this.camPos.y, pos.y, rate, dt);
    this.camPos.z = damp(this.camPos.z, pos.z, rate, dt);
    this.camLook.x = damp(this.camLook.x, look.x, rate * 1.4, dt);
    this.camLook.y = damp(this.camLook.y, look.y, rate * 1.4, dt);
    this.camLook.z = damp(this.camLook.z, look.z, rate * 1.4, dt);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.6);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.camLook);
  }
}
