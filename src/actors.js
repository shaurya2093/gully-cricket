// Blocky kids: the batter, the bowler and the fielders, with simple procedural animation.
// Each kid is six meshes (body, head, two arms, two legs) that share one material, with
// the colours baked into the vertices, so a whole team costs very few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const lam = (color) => new THREE.MeshLambertMaterial({ color });
const SKINS = ['#c98d5e', '#b9794a', '#d9a273', '#a86a3d'];
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const KID_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const BLOB_GEO = new THREE.CircleGeometry(0.34, 14);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false });

// Builds one mesh from coloured boxes: [w, h, d, colour, x, y, z, tag].
// Boxes with a tag can be recoloured later (used for the shirt).
function part(boxes) {
  const geos = [], tags = [];
  let offset = 0;
  for (const [w, h, d, color, x, y, z, tag] of boxes) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
    if (tag) tags.push({ tag, start: offset, count: n });
    offset += n;
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), KID_MAT);
  geos.forEach((g) => g.dispose());
  mesh.castShadow = true;
  mesh.userData.tags = tags;
  return mesh;
}

function recolor(mesh, tag, color) {
  const c = new THREE.Color(color);
  const attr = mesh.geometry.attributes.color;
  for (const t of mesh.userData.tags) {
    if (t.tag !== tag) continue;
    for (let i = t.start; i < t.start + t.count; i++) attr.setXYZ(i, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

export class Kid {
  constructor({ shirt = '#3d9be9', shorts = '#2f3b52', skin = 0, hair = '#1d1410', scale = 1 } = {}) {
    const sk = SKINS[skin % SKINS.length];
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.group.scale.setScalar(scale);

    this.torso = part([[0.4, 0.46, 0.24, shirt, 0, 0.79, 0, 'shirt'], [0.4, 0.16, 0.25, shorts, 0, 0.52, 0]]);
    // the face looks along +z; eyes make it clear which way a fielder is facing
    this.head = part([
      [0.3, 0.3, 0.28, sk, 0, 0, 0], [0.32, 0.12, 0.3, hair, 0, 0.14, 0], [0.32, 0.2, 0.08, hair, 0, 0.04, -0.13],
      [0.05, 0.06, 0.02, '#1d1410', 0.075, 0.01, 0.142], [0.05, 0.06, 0.02, '#1d1410', -0.075, 0.01, 0.142]
    ]);
    this.head.position.y = 1.2;
    const arm = () => part([[0.11, 0.42, 0.11, sk, 0, -0.21, 0], [0.121, 0.099, 0.1375, sk, 0, -0.42, 0], [0.13, 0.16, 0.13, shirt, 0, -0.07, 0, 'shirt']]);
    const leg = () => part([[0.14, 0.44, 0.14, sk, 0, -0.22, 0], [0.154, 0.126, 0.175, '#f4f4f4', 0, -0.44, 0]]);
    this.armL = arm(); this.armR = arm();
    this.armL.position.set(0.26, 0.98, 0);
    this.armR.position.set(-0.26, 0.98, 0);
    this.legL = leg(); this.legR = leg();
    this.legL.position.set(0.11, 0.46, 0);
    this.legR.position.set(-0.11, 0.46, 0);
    this.body.add(this.torso, this.head, this.armL, this.armR, this.legL, this.legR);

    // a soft disc under the feet stands in for a shadow when real shadows are off
    this.blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.02;
    this.blob.visible = false;
    this.group.add(this.blob);

    this.state = 'idle';
    this.time = Math.random() * 10;
    this.cur = { legL: 0, legR: 0, aLx: 0, aRx: 0, aLz: 0.1, aRz: -0.1, lean: 0, y: 0 };
    this.override = null; // lets the bowler and batter drive specific joints
  }

  setShirt(color) { recolor(this.torso, 'shirt', color); recolor(this.armL, 'shirt', color); recolor(this.armR, 'shirt', color); }

  // Face a direction given in simulation coordinates.
  face(dx, dz, dt = 1, rate = 12) {
    const target = Math.atan2(dx, -dz);
    let diff = target - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, rate * dt);
  }

  place(x, z) { this.group.position.set(x, 0, -z); }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const g = { legL: 0, legR: 0, aLx: 0, aRx: 0, aLz: 0.1, aRz: -0.1, lean: 0, y: 0 };
    switch (this.state) {
      case 'run': {
        const ph = t * 13;
        g.legL = Math.sin(ph) * 0.95; g.legR = -Math.sin(ph) * 0.95;
        g.aLx = -Math.sin(ph) * 0.9; g.aRx = Math.sin(ph) * 0.9;
        g.lean = 0.2; g.y = Math.abs(Math.sin(ph)) * 0.05;
        break;
      }
      case 'ready': g.lean = 0.4; g.aLx = -0.75; g.aRx = -0.75; g.legL = -0.25; g.legR = -0.25; g.y = -0.03; break;
      case 'catch': g.aLx = -2.7; g.aRx = -2.7; g.aLz = -0.25; g.aRz = 0.25; g.y = 0.05; break;
      case 'field': g.lean = 0.9; g.aLx = -1.3; g.aRx = -1.3; g.y = -0.1; break;
      case 'celebrate': g.aLx = -2.9 + Math.sin(t * 9) * 0.25; g.aRx = -2.9 - Math.sin(t * 9) * 0.25; g.aLz = 0.5; g.aRz = -0.5; g.y = Math.abs(Math.sin(t * 7)) * 0.28; break;
      case 'drop': g.aLx = -2.5; g.aRx = -2.5; g.aLz = -0.75; g.aRz = 0.75; g.lean = 0.12; break;
      case 'sad': g.lean = 0.3; g.aLx = 0.1; g.aRx = 0.1; break;
      default: g.y = Math.sin(t * 2) * 0.012; g.aLx = Math.sin(t * 1.4) * 0.06; g.aRx = -Math.sin(t * 1.4) * 0.06;
    }
    if (this.override) Object.assign(g, this.override);
    const c = this.cur, rate = this.state === 'run' ? 30 : 12;
    for (const k of Object.keys(g)) c[k] = damp(c[k], g[k], rate, dt);
    this.legL.rotation.x = c.legL; this.legR.rotation.x = c.legR;
    this.armL.rotation.x = c.aLx; this.armR.rotation.x = c.aRx;
    this.armL.rotation.z = c.aLz; this.armR.rotation.z = c.aRz;
    this.body.rotation.x = c.lean;
    this.body.position.y = c.y;
  }
}

// The batter and the bat. The bat follows the batter's hands and is aimed by a set of key poses.
export class Batter {
  constructor(scene) {
    this.kid = new Kid({ shirt: '#f4f1e8', shorts: '#28324a', skin: 0, scale: 1.05 });
    scene.add(this.kid.group);
    this.bat = new THREE.Group();
    this.bladeMat = lam('#d9b47a');
    this.gripMat = lam('#2d2d2d');
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), this.gripMat);
    handle.position.y = -0.1;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.56, 0.045), this.bladeMat);
    blade.position.y = -0.52; blade.castShadow = true;
    this.bat.add(handle, blade);
    scene.add(this.bat);
    this.hand = 1;
    this.mode = 'stance';
    this.t = 0;
    this.aim = 0;
    this.loft = false;
    this.q = new THREE.Quaternion();
    this.offset = 0;      // sideways shuffle across the crease
    this.moving = false;
    this.setHand('R');
  }

  setSkin(skin) { this.bladeMat.color.set(skin.blade); this.gripMat.color.set(skin.grip); }

  setHand(hand) {
    this.hand = hand === 'L' ? -1 : 1;
    this.kid.place(-0.4 * this.hand + this.offset, 0.1);
    this.kid.group.rotation.y = (Math.PI / 2) * this.hand;
    this.kid.head.rotation.y = (Math.PI / 2) * 0.8 * this.hand;
    this.reset();
  }

  reset() { this.mode = 'stance'; this.t = 0; }
  setOffset(x, moving) { this.offset = x; this.moving = moving; }
  backlift() { if (this.mode === 'stance') { this.mode = 'backlift'; this.t = 0; } }
  swing(aim, loft) { this.mode = 'swing'; this.t = 0; this.aim = aim; this.loft = loft; }

  // Direction the bat points (from the hands) for each pose, in scene coordinates.
  dirFor(pose) {
    const h = this.hand, a = this.aim;
    if (pose === 'stance') return new THREE.Vector3(0.12 * h, -1, 0.3);
    if (pose === 'backlift') return new THREE.Vector3(0.1 * h, 0.55, 1);
    if (pose === 'contact') return new THREE.Vector3(Math.sin(a) * 0.5, -1, -0.45);
    return new THREE.Vector3(Math.sin(a), this.loft ? 1.1 : 0.45, -Math.cos(a)); // follow-through
  }

  update(dt) {
    this.t += dt;
    const k = this.kid, h = this.hand;
    let from = 'stance', to = 'stance', f = 1, arms = -0.55, twist = 0;
    if (this.mode === 'backlift') { from = 'stance'; to = 'backlift'; f = Math.min(1, this.t / 0.3); arms = -0.55 - 0.5 * f; }
    else if (this.mode === 'swing') {
      if (this.t < 0.07) { from = 'backlift'; to = 'contact'; f = this.t / 0.07; arms = -1.05 - 0.2 * f; twist = 0.3 * f; }
      else if (this.t < 0.24) { from = 'contact'; to = 'follow'; f = (this.t - 0.07) / 0.17; arms = -1.25 - (this.loft ? 1.2 : 0.7) * f; twist = 0.3 + 0.6 * f; }
      else if (this.t < 0.75) { from = 'follow'; to = 'follow'; arms = this.loft ? -2.45 : -1.95; twist = 0.9; }
      else { this.mode = 'stance'; this.t = 0; }
    }
    k.place(-0.4 * h + this.offset, 0.1);
    k.override = { aLx: arms, aRx: arms, aLz: -0.45, aRz: 0.45, lean: 0.22 };
    if (this.moving) {
      // quick little steps while shuffling across
      const ph = k.time * 20;
      k.override.legL = Math.sin(ph) * 0.45; k.override.legR = -Math.sin(ph) * 0.45; k.override.y = Math.abs(Math.sin(ph)) * 0.03;
    }
    const base = (Math.PI / 2) * h;
    const target = base + twist * h * (1 - Math.abs(this.aim) * 0.3);
    k.group.rotation.y += (target - k.group.rotation.y) * Math.min(1, dt * 22);
    k.update(dt);

    // Put the bat in the hands.
    k.group.updateMatrixWorld(true);
    const handPos = new THREE.Vector3(0, -0.44, 0);
    k.armL.localToWorld(handPos);
    const other = new THREE.Vector3(0, -0.44, 0);
    k.armR.localToWorld(other);
    handPos.lerp(other, 0.5);
    this.bat.position.copy(handPos);
    const down = new THREE.Vector3(0, -1, 0);
    const qa = new THREE.Quaternion().setFromUnitVectors(down, this.dirFor(from).normalize());
    const qb = new THREE.Quaternion().setFromUnitVectors(down, this.dirFor(to).normalize());
    const ease = f * f * (3 - 2 * f);
    qa.slerp(qb, ease);
    this.q.slerp(qa, Math.min(1, dt * 40));
    this.bat.quaternion.copy(this.q);
  }
}

// The bowler runs in, turns the arm over and follows through.
export class Bowler {
  constructor(scene) {
    this.kid = new Kid({ shirt: '#3d9be9', skin: 1, scale: 1.08 });
    scene.add(this.kid.group);
    this.kid.group.rotation.y = 0;
    this.phase = 'wait';
    this.t = 0;
    this.runTime = 1.25;
    this.overstep = 0;
    this.home();
  }

  home() { this.kid.place(0.55, 17.2); this.kid.state = 'idle'; this.kid.override = null; this.phase = 'wait'; this.kid.group.rotation.y = 0; }

  // overstep: extra distance past the crease, used when the ball is a no ball
  start(overstep = 0) { this.phase = 'run'; this.t = 0; this.overstep = overstep; this.kid.place(0.55, 17.2); this.kid.group.rotation.y = 0; }

  // Returns true on the frame the ball should leave the hand.
  update(dt, fielderState) {
    const k = this.kid;
    this.t += dt;
    let released = false;
    if (this.phase === 'run') {
      const f = Math.min(1, this.t / this.runTime);
      k.place(0.55, 17.2 - (4.2 + this.overstep) * f);
      k.state = 'run';
      const armStart = this.runTime - 0.26;
      if (this.t >= armStart) {
        const a = Math.min(1, (this.t - armStart) / 0.26);
        k.override = { aRx: a * Math.PI, aLx: -1.4 + a * 1.2, aRz: 0, lean: 0.1 };
        k.cur.aRx = a * Math.PI;
      }
      if (f >= 1) { this.phase = 'follow'; this.t = 0; released = true; }
    } else if (this.phase === 'follow') {
      const a = Math.min(1, this.t / 0.3);
      k.place(0.55 - 0.05 * a, 13 - this.overstep - 1.8 * a);
      k.state = 'run';
      k.override = { aRx: Math.PI + a * 1.7, aLx: 0.4, lean: 0.45 * (1 - a * 0.5) };
      k.cur.aRx = Math.PI + a * 1.7;
      if (a >= 1) { this.phase = 'field'; k.override = null; k.cur.aRx = 0; k.state = 'ready'; }
    } else if (this.phase === 'field' && fielderState) {
      k.place(fielderState.x, fielderState.z);
      k.state = fielderState.state === 'idle' ? 'ready' : fielderState.state;
      if (fielderState.state === 'run') k.face(fielderState.dirX, fielderState.dirZ, dt);
      else k.face(0, -1, dt, 6);
    }
    k.update(dt);
    return released;
  }

  // Scene position of the bowling hand at the top of the action.
  static get release() { return { x: 0.45, y: 1.75 }; }
}
