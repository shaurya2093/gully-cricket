// One ball, from the bowler's hand to the result. No rendering here: the 3D scene reads
// positions from this object and plays the events it emits.
import { G, BALL_R, STREET, PITCH, RUN_LINES, STUMPS, WIDE_X, TIMING, SUBSTEP } from './config.js';
import { stepDelivery } from './deliveries.js';
import { buildingAt, windowAt } from './street.js';
import { clamp, lerp } from './rng.js';

const DEG = Math.PI / 180;
const DRAG = 0.006;
const ROLL_DECEL = 4.6;
const CATCH_R = 0.8;

export class Play {
  constructor({ delivery, field, rng, hand = 'R', windowScale = 1 }) {
    const d = delivery;
    this.d = d;
    this.rng = rng;
    this.handSign = hand === 'L' ? -1 : 1;
    this.w = windowScale;
    this.t = 0;
    this.acc = 0;
    this.phase = 'flight'; // flight -> struck -> settle -> done
    this.ball = { x: d.rx, y: d.ry, z: d.rz, vx: d.vx, vy: d.vy, vz: d.vz, bounces: 0, wallHits: 0, rolling: false, held: -1, free: false, hidden: false };
    this.swing = null;
    this.timing = null;
    this.timingErr = null;
    this.outcome = null;
    this.outcomeT = 0;
    this.settleFor = 0.9;
    this.struckT = 0;
    this.maxZ = 0;
    this.retarget = 0;
    this.events = [];
    this.fielders = field.map((f) => ({
      x: f.x, z: f.z, hx: f.x, hz: f.z, tx: f.x, tz: f.z,
      speed: f.speed ?? 5.2, skill: f.skill ?? 0.85, react: f.react ?? 0.28,
      bowler: !!f.bowler, tried: false, state: 'idle', dirX: 0, dirZ: -1
    }));
  }

  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // The player's input. aim is in radians (0 = straight, positive = to the right).
  swingAt(aim, loft) {
    if (this.swing) return false;
    if (this.phase === 'settle' && this.struckT === 0) {
      // The ball has already gone past: the bat still swings, far too late.
      this.swing = { t: this.t, aim, loft: !!loft, done: true };
      this.timing = 'late';
      if (this.outcome) this.outcome.timing = 'late';
      return true;
    }
    if (this.phase !== 'flight') return false;
    this.swing = { t: this.t, aim: clamp(aim, -1.3, 1.3), loft: !!loft, done: false };
    return true;
  }

  step(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= SUBSTEP && this.phase !== 'done') {
      this.acc -= SUBSTEP;
      this.t += SUBSTEP;
      if (this.phase === 'flight') this.subFlight(SUBSTEP);
      else if (this.phase === 'struck') this.subStruck(SUBSTEP);
      else this.subSettle(SUBSTEP);
    }
  }

  finish(o) {
    this.outcome = { runs: 0, out: null, boundary: 0, wide: false, legal: true, timing: this.timing, timingErr: this.timingErr, fielder: -1, ...o };
    this.outcomeT = this.t;
    this.phase = 'settle';
    if (this.outcome.boundary === 6 || this.outcome.out === 'lost') this.settleFor = 1.5;
    else if (this.outcome.out) this.settleFor = 1.2;
  }

  // ---------- ball on its way to the batter ----------

  subFlight(h) {
    const b = this.ball;
    const pz = b.z;
    if (stepDelivery(b, this.d, h)) this.emit('bounce', { x: b.x, z: b.z, pitch: true });

    if (this.swing && !this.swing.done && this.t >= this.swing.t + TIMING.lag) {
      this.swing.done = true;
      this.resolveSwing();
      if (this.phase !== 'flight') return;
    }

    if (pz > PITCH.stumpsZ && b.z <= PITCH.stumpsZ) {
      if (this.swing && !this.timing) { this.timing = 'late'; this.timingErr = TIMING.late; }
      if (Math.abs(b.x) <= STUMPS.halfW + BALL_R * 0.5 && b.y <= STUMPS.h + BALL_R) {
        this.emit('stumps', { x: b.x, y: b.y });
        b.vz *= -0.12; b.vy = 1.6; b.vx += this.rng.range(-1, 1);
        this.finish({ out: 'bowled' });
      } else if (!this.swing && Math.abs(this.d.creaseX ?? b.x) > WIDE_X) {
        this.finish({ runs: 1, wide: true, legal: false });
      } else {
        this.finish({});
      }
    }
  }

  resolveSwing() {
    const b = this.ball, d = this.d, s = this.swing, rng = this.rng;
    const e = this.t - d.tIdeal;
    this.timingErr = e;
    const earlyLim = TIMING.early * this.w;
    const lateLim = Math.min(TIMING.late * this.w, d.tStumps - d.tIdeal - 0.012);
    const perfect = TIMING.perfect * this.w;
    const good = TIMING.good * this.w;

    if (e < -earlyLim || b.z > 3.4) { this.timing = 'early'; this.emit('miss', { label: 'early' }); return; }
    if (e > lateLim || b.z < PITCH.stumpsZ + 0.1) { this.timing = 'late'; this.emit('miss', { label: 'late' }); return; }
    if (Math.abs(b.x) > 1.0 || b.y > 1.75) { this.timing = 'miss'; this.emit('miss', { label: 'miss' }); return; }

    const ae = Math.abs(e);
    let q, label;
    if (ae <= perfect && e <= lateLim) { q = 1; label = 'perfect'; }
    else if (ae <= good) { q = 0.92 - 0.24 * ((ae - perfect) / (good - perfect)); label = 'good'; }
    else {
      const lim = e < 0 ? earlyLim : Math.max(lateLim, good + 0.001);
      q = 0.6 - 0.25 * clamp((ae - good) / (lim - good), 0, 1);
      label = e < 0 ? 'early' : 'late';
    }
    this.timing = label;

    const edge = (label === 'early' || label === 'late') && rng.chance(0.28);
    let loft = s.loft;
    let elevMul = 1;
    if (b.y < 0.22) { q *= 0.86; elevMul = 0.6; }            // yorker: hard to get under
    const highBall = b.y > 1.25;
    if (highBall) q *= 0.9;
    const wide = Math.abs(b.x);
    if (wide > 0.6) q *= 1 - (wide - 0.6) * 0.6;

    // Early swings drag the ball to the leg side, late ones squirt it to the off side.
    const lim = e < 0 ? earlyLim : Math.max(lateLim, 0.02);
    const drift = this.handSign * Math.sign(e) * Math.pow(clamp(ae / lim, 0, 1), 1.5) * 0.5;
    let theta = clamp(s.aim + drift + rng.range(-0.035, 0.035), -1.45, 1.45);
    let speed, elev;
    if (edge) {
      speed = rng.range(6, 10);
      theta = (rng.chance(0.5) ? 1 : -1) * rng.range(1.9, 2.7);
      elev = rng.range(5, 35) * DEG;
      loft = false;
    } else if (loft) {
      speed = 12 + 13 * q;
      elev = ((25 + (1 - q) * 24) * elevMul + rng.range(-2, 2)) * DEG;
    } else {
      speed = 11 + 15 * q;
      elev = (3 + (1 - q) * 9 + rng.range(0, 3) + (highBall ? 8 : 0)) * DEG;
    }
    if (!edge) speed += (d.speed - 14) * 0.25;

    const ch = Math.cos(elev) * speed;
    b.vx = Math.sin(theta) * ch;
    b.vz = Math.cos(theta) * ch;
    b.vy = Math.sin(elev) * speed;
    b.bounces = 0; b.wallHits = 0; b.rolling = false;
    this.phase = 'struck';
    this.struckT = this.t;
    this.maxZ = b.z;
    this.emit('bat', { q, label, loft, edge, x: b.x, y: b.y, z: b.z });
  }

  // ---------- ball in play ----------

  subStruck(h) {
    const b = this.ball, rng = this.rng;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (b.rolling) {
      const hs = Math.hypot(b.vx, b.vz);
      const ns = Math.max(0, hs - ROLL_DECEL * h);
      const k = hs > 0 ? ns / hs : 0;
      b.vx *= k; b.vz *= k;
    } else {
      const k = 1 - DRAG * sp * h;
      b.vx *= k; b.vy *= k; b.vz *= k;
      b.vy -= G * h;
    }
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    if (!b.rolling && b.y < BALL_R && b.vy < 0) {
      b.y = BALL_R;
      if (Math.abs(b.vy) < 1.3) { b.vy = 0; b.rolling = true; }
      else { b.vy = -b.vy * 0.5; b.vx *= 0.82; b.vz *= 0.82; this.emit('bounce', { x: b.x, z: b.z }); }
      b.bounces++;
    }
    if (b.z > this.maxZ) this.maxZ = b.z;

    // Side walls, windows and roofs.
    if (Math.abs(b.x) > STREET.halfW - BALL_R) {
      const side = Math.sign(b.x);
      const house = buildingAt(side, b.z);
      if (b.y > house.h) {
        b.free = true;
        const clean = b.bounces === 0 && b.wallHits === 0;
        if (house.out) { this.emit('lost', { side, z: b.z }); this.finish({ out: 'lost' }); }
        else { this.emit('boundary', { runs: clean ? 6 : 4, roof: true }); this.finish({ runs: clean ? 6 : 4, boundary: clean ? 6 : 4, roof: true }); }
        return;
      }
      const win = windowAt(side, b.z, b.y);
      if (win && sp > 5) {
        b.hidden = true;
        this.emit('glass', { side, z: (win.z0 + win.z1) / 2, y: (win.y0 + win.y1) / 2, win });
        this.finish({ out: 'window' });
        return;
      }
      b.x = side * (STREET.halfW - BALL_R);
      b.vx = -b.vx * 0.55; b.vz *= 0.85; b.vy *= 0.85;
      b.wallHits++;
      this.emit('wall', { x: b.x, y: b.y, z: b.z });
    }

    // Far wall: four along the ground or off it, six if it clears on the full.
    if (b.z >= STREET.endZ - BALL_R) {
      if (b.y > STREET.endWallH + BALL_R) {
        const clean = b.bounces === 0 && b.wallHits === 0;
        b.free = true;
        this.emit('boundary', { runs: clean ? 6 : 4 });
        this.finish({ runs: clean ? 6 : 4, boundary: clean ? 6 : 4 });
      } else {
        b.z = STREET.endZ - BALL_R; b.vz = -b.vz * 0.35; b.vx *= 0.5;
        this.emit('boundary', { runs: 4 });
        this.finish({ runs: 4, boundary: 4 });
      }
      return;
    }

    // Wall behind the batter.
    if (b.z <= STREET.backZ + BALL_R) {
      if (b.y > STREET.backWallH) { b.free = true; this.finish({}); return; }
      b.z = STREET.backZ + BALL_R; b.vz = -b.vz * 0.5; b.wallHits++;
      this.emit('wall', { x: b.x, y: b.y, z: b.z });
    }

    if (this.updateFielders(h)) return;

    if (b.rolling && Math.hypot(b.vx, b.vz) < 0.5) { this.finish({ runs: this.runsFor(this.maxZ), how: 'stopped' }); return; }
    if (this.t - this.struckT > 7) this.finish({ runs: this.runsFor(this.maxZ), how: 'stopped' });
  }

  runsFor(z) {
    let r = 0;
    for (const line of RUN_LINES) if (z >= line) r++;
    return r;
  }

  // Where a fielder should run to meet the ball.
  predict(f) {
    const b = this.ball;
    const lim = STREET.halfW - 0.5;
    const airborne = !b.rolling && (b.y > 0.7 || b.vy > 2);
    if (airborne) {
      // Time until the ball drops to catching height.
      const a = -0.5 * G, bb = b.vy, c = b.y - 1.1;
      const disc = bb * bb - 4 * a * c;
      if (disc > 0) {
        const tl = (-bb - Math.sqrt(disc)) / (2 * a);
        if (tl > 0.15) return { x: clamp(b.x + b.vx * tl * 0.94, -lim, lim), z: clamp(b.z + b.vz * tl * 0.94, STREET.backZ + 1, STREET.endZ - 0.6) };
      }
    }
    const hs = Math.hypot(b.vx, b.vz);
    if (hs < 0.3) return { x: b.x, z: b.z };
    const ux = b.vx / hs, uz = b.vz / hs;
    let px = b.x, pz = b.z;
    for (let tau = 0.1; tau <= 2.6; tau += 0.1) {
      const dist = Math.max(0, hs * tau - 0.5 * ROLL_DECEL * tau * tau);
      px = clamp(b.x + ux * dist, -lim, lim);
      pz = clamp(b.z + uz * dist, STREET.backZ + 1, STREET.endZ - 0.6);
      if (Math.hypot(px - f.x, pz - f.z) <= f.speed * tau) break;
      if (hs - ROLL_DECEL * tau <= 0) break;
    }
    return { x: px, z: pz };
  }

  // Returns true if a fielder ended the play.
  updateFielders(h) {
    const b = this.ball, rng = this.rng;
    const since = this.t - this.struckT;
    this.retarget -= h;
    const re = this.retarget <= 0;
    if (re) this.retarget = 0.08;
    const sp = Math.hypot(b.vx, b.vy, b.vz);

    for (let i = 0; i < this.fielders.length; i++) {
      const f = this.fielders[i];
      if (since < f.react) continue;
      if (re) { const p = this.predict(f); f.tx = p.x; f.tz = p.z; }
      const dx = f.tx - f.x, dz = f.tz - f.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.08) {
        const mv = Math.min(dist, f.speed * h);
        f.x += (dx / dist) * mv; f.z += (dz / dist) * mv;
        f.dirX = dx / dist; f.dirZ = dz / dist;
        f.state = 'run';
      } else if (f.state === 'run') f.state = 'ready';

      if (f.tried) continue;
      const near = Math.hypot(b.x - f.x, b.z - f.z);
      if (near > CATCH_R || b.y > 2.3) continue;

      const clean = b.bounces === 0 && b.wallHits === 0;
      if (clean && b.y > 0.15) {
        f.tried = true;
        const p = f.skill * clamp(1.12 - (sp - 8) / 36, 0.3, 1);
        if (rng.chance(p)) return this.caught(i, 'caught');
        this.drop(f);
        continue;
      }
      if (b.bounces === 1 && b.wallHits === 0 && !b.rolling && b.y > 0.4 && b.y < 2.0 && sp < 18) {
        f.tried = true;
        if (rng.chance(0.3 * f.skill)) return this.caught(i, 'onetip');
        this.drop(f);
        continue;
      }
      if (b.y < 0.55 || ((b.bounces >= 2 || b.wallHits > 0) && b.y < 1.7)) {
        f.tried = true;
        if (sp > 23 && rng.chance(0.35)) { b.vx *= 0.6; b.vz *= 0.6; f.state = 'drop'; this.emit('misfield', { i }); continue; }
        b.held = i; b.vx = b.vy = b.vz = 0;
        f.state = 'field';
        this.emit('field', { i });
        this.finish({ runs: this.runsFor(this.maxZ), how: 'fielded', fielder: i });
        return true;
      }
    }
    return false;
  }

  caught(i, how) {
    const b = this.ball, f = this.fielders[i];
    b.held = i; b.vx = b.vy = b.vz = 0;
    f.state = 'catch';
    this.emit('catch', { i, how });
    this.finish({ out: how, fielder: i });
    return true;
  }

  drop(f) {
    const b = this.ball;
    b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.abs(b.vy) * 0.2 + 1;
    b.bounces = Math.max(b.bounces, 2); // a dropped ball can no longer be caught or score six
    f.state = 'drop';
    this.emit('drop', {});
  }

  // ---------- after the result: let the ball finish moving for the camera ----------

  subSettle(h) {
    const b = this.ball;
    if (b.held < 0 && !b.hidden) {
      if (b.rolling) {
        const hs = Math.hypot(b.vx, b.vz);
        const k = hs > 0 ? Math.max(0, hs - ROLL_DECEL * h) / hs : 0;
        b.vx *= k; b.vz *= k;
      } else b.vy -= G * h;
      b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      if (!b.free) {
        if (b.y < BALL_R && b.vy < 0) {
          b.y = BALL_R;
          if (Math.abs(b.vy) < 1.3) { b.vy = 0; b.rolling = true; } else { b.vy = -b.vy * 0.5; b.vx *= 0.8; b.vz *= 0.8; }
        }
        if (b.z <= STREET.backZ + BALL_R && b.vz < 0) { b.z = STREET.backZ + BALL_R; b.vz = -b.vz * 0.4; }
        if (b.z >= STREET.endZ - BALL_R && b.vz > 0) { b.z = STREET.endZ - BALL_R; b.vz = -b.vz * 0.35; }
        if (Math.abs(b.x) > STREET.halfW - BALL_R) { b.x = Math.sign(b.x) * (STREET.halfW - BALL_R); b.vx = -b.vx * 0.5; }
      }
    }
    for (const f of this.fielders) {
      if (f.state !== 'run') continue;
      const dx = f.tx - f.x, dz = f.tz - f.z, dist = Math.hypot(dx, dz);
      if (dist > 0.1) { const mv = Math.min(dist, f.speed * h); f.x += (dx / dist) * mv; f.z += (dz / dist) * mv; }
      else f.state = 'ready';
    }
    if (this.t - this.outcomeT >= this.settleFor) this.phase = 'done';
  }
}

export { lerp };
