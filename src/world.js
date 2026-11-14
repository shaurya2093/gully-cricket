// The street: road, houses, walls, stumps, props, sky and lighting. Scene z is the
// negative of simulation z, so "down the street" is towards -z here.
//
// Almost everything in the street never moves, so it is merged into a handful of
// meshes with per-vertex colours. That keeps the number of draw calls low, which is
// what decides the frame rate on budget phones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREET, PITCH, RUN_LINES, STUMPS } from './config.js';
import { HOUSES } from './street.js';
import { RNG } from './rng.js';

const lam = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

// Lighting moods. `lamp` is how strongly the street lamps glow, `glass` the lit windows.
export const THEMES = {
  day: {
    sky: ['#2f5fa8', '#7fa6d6', '#f6c08a', '#ffdcae'], fog: '#f3c89f',
    hemiSky: '#ffe7c4', hemiGround: '#7a644e', hemi: 1.25,
    sun: '#ffd09a', sunI: 2.1, sunPos: [-9, 16, 4], glass: 0.55, lamp: 0, stars: 0
  },
  dusk: {
    sky: ['#1c2759', '#5d4a8c', '#e9805a', '#ffbe78'], fog: '#c98a78',
    hemiSky: '#f3bfa6', hemiGround: '#5b4a57', hemi: 0.95,
    sun: '#ff9a5a', sunI: 1.45, sunPos: [-15, 7.5, 2], glass: 1.0, lamp: 0.55, stars: 0.25
  },
  night: {
    sky: ['#050a1c', '#0d1736', '#1b2a52', '#2c3d68'], fog: '#18223f',
    hemiSky: '#93a8e6', hemiGround: '#262a3d', hemi: 0.78,
    sun: '#a9bcff', sunI: 0.6, sunPos: [7, 18, -5], glass: 1.5, lamp: 1, stars: 1
  },
  // A power cut: no lamps, dark windows, only the moon.
  blackout: {
    sky: ['#040816', '#0a1330', '#16244a', '#24345c'], fog: '#131c36',
    hemiSky: '#9fb2ee', hemiGround: '#23273a', hemi: 0.95,
    sun: '#b5c5ff', sunI: 0.85, sunPos: [7, 18, -5], glass: 0.08, lamp: 0, stars: 1
  }
};

function themeState(def) {
  return {
    sky: def.sky.map((c) => new THREE.Color(c)), fog: new THREE.Color(def.fog),
    hemiSky: new THREE.Color(def.hemiSky), hemiGround: new THREE.Color(def.hemiGround), hemi: def.hemi,
    sun: new THREE.Color(def.sun), sunI: def.sunI, sunPos: new THREE.Vector3(...def.sunPos),
    glass: def.glass, lamp: def.lamp, stars: def.stars
  };
}

function mixState(a, b, t, out) {
  for (let i = 0; i < 4; i++) out.sky[i].lerpColors(a.sky[i], b.sky[i], t);
  for (const k of ['fog', 'hemiSky', 'hemiGround', 'sun']) out[k].lerpColors(a[k], b[k], t);
  out.sunPos.lerpVectors(a.sunPos, b.sunPos, t);
  for (const k of ['hemi', 'sunI', 'glass', 'lamp', 'stars']) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Gives a geometry one flat colour so it can be merged with others.
function tint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.batch = { cast: [], flat: [], lit: [], bulbs: [] };
    this.lines = [];
    this.windowInfo = [];
    this.broken = [];
    this.flagData = [];
    this.lampSpots = [];
    this.lampsAllowed = true;
    this.festive = false;
    this.build();
    this.state = themeState(THEMES.day);
    this.from = themeState(THEMES.day);
    this.to = themeState(THEMES.day);
    this.mix = 1;
    this.themeName = 'day';
    this.applyState(this.state);
  }

  // A static coloured box. It ends up inside one of the merged meshes.
  box(w, h, d, color, x, y, z, opts = {}) {
    this.solid(new THREE.BoxGeometry(w, h, d), color, x, y, z, opts);
  }

  solid(geo, color, x, y, z, { cast = true, rx = 0, ry = 0, rz = 0, into = null } = {}) {
    const g = tint(geo, color);
    M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), ONE);
    g.applyMatrix4(M);
    this.batch[into || (cast ? 'cast' : 'flat')].push(g);
  }

  build() {
    this.buildSky();
    this.buildLights();
    this.buildRoad();
    this.buildHouses();
    this.buildWalls();
    this.buildStumps();
    this.buildProps();
    this.finish();
  }

  finish() {
    const add = (geos, material, cast) => {
      if (!geos.length) return null;
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
      geos.forEach((g) => g.dispose());
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      return mesh;
    };
    this.staticMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    add(this.batch.cast, this.staticMat, true);
    add(this.batch.flat, this.staticMat, false);
    this.glassLit = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#f2a93b', emissiveIntensity: 0.55 });
    const lit = add(this.batch.lit, this.glassLit, false);
    if (lit) lit.receiveShadow = false;
    this.bulbMat = new THREE.MeshBasicMaterial({ color: '#6b665c' });
    const bulbs = add(this.batch.bulbs, this.bulbMat, false);
    if (bulbs) bulbs.receiveShadow = false;
    this.batch = null;

    // every wire and string in one object
    const pts = [];
    for (const line of this.lines) for (let i = 0; i < line.length - 1; i++) pts.push(line[i], line[i + 1]);
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#2a2a2a' }));
    wires.matrixAutoUpdate = false;
    this.root.add(wires);
    this.lines = null;
  }

  // ---------- sky and light ----------

  buildSky() {
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 16; this.skyCanvas.height = 512;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog('#f3c89f', 45, 130);

    // stars and a moon for the night matches
    const rng = new RNG(77);
    const pos = [];
    for (let i = 0; i < 170; i++) {
      const az = rng.range(0, Math.PI * 2), el = rng.range(0.16, 1.35), r = 150;
      pos.push(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r - 20);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.moonMat = new THREE.MeshBasicMaterial({ color: '#f3f0dc', transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(5.5, 28), this.moonMat);
    this.moon.position.set(34, 62, -118);
    this.moon.lookAt(0, 2, 0);
    this.scene.add(this.moon);
  }

  drawSky(colors) {
    const g = this.skyCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    [0, 0.45, 0.72, 1].forEach((stop, i) => grad.addColorStop(stop, '#' + colors[i].getHexString()));
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 512);
    this.skyTex.needsUpdate = true;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#ffe7c4', '#7a644e', 1.25);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffd09a', 2.1);
    sun.position.set(-9, 16, 4);
    sun.target.position.set(0, 0, -12);
    this.scene.add(sun, sun.target);
    const c = sun.shadow.camera;
    c.left = -24; c.right = 24; c.top = 22; c.bottom = -22; c.near = 1; c.far = 70;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.lamps = [];
  }

  // Turns sun shadows on or off, and sets their sharpness.
  setShadows(on, size = 2048) {
    const s = this.sun;
    if (s.shadow.mapSize.x !== size) {
      s.shadow.mapSize.set(size, size);
      if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    }
    s.castShadow = on;
  }

  // Street-lamp lights cost a little on every pixel, so the fast graphics level skips them.
  setLamps(allowed) {
    this.lampsAllowed = allowed;
    this.applyState(this.state);
  }

  // ---------- themes ----------

  setTheme(name, { festive = false, instant = true } = {}) {
    const def = THEMES[name] || THEMES.day;
    this.festive = festive;
    this.fairy.visible = festive;
    if (name === this.themeName && this.mix >= 1) return;
    this.themeName = name;
    this.to = themeState(def);
    if (instant) { this.mix = 1; mixState(this.to, this.to, 1, this.state); this.applyState(this.state); }
    else { this.from = themeState(THEMES.day); mixState(this.state, this.state, 1, this.from); this.mix = 0; }
  }

  get dark() { return this.state.stars > 0.6; }

  applyState(s) {
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    const lampsOn = this.lampsAllowed && s.lamp > 0.02;
    // without lamp lights the street needs a little more fill to stay readable
    this.hemi.intensity = s.hemi + (!this.lampsAllowed ? s.lamp * 0.3 : 0);
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.sun.position.copy(s.sunPos);
    this.scene.fog.color.copy(s.fog);
    if (this.glassLit) this.glassLit.emissiveIntensity = s.glass;
    for (const l of this.lamps) { l.visible = lampsOn; l.intensity = 40 * s.lamp; }
    if (this.bulbMat) this.bulbMat.color.set('#6b665c').lerp(V_WARM, Math.min(1, s.lamp * 1.4));
    this.starMat.opacity = s.stars;
    this.moonMat.opacity = Math.min(1, s.stars * 1.2);
    this.stars.visible = this.moon.visible = s.stars > 0.01;
    this.drawSky(s.sky);
  }

  // ---------- road ----------

  buildRoad() {
    const len = STREET.endZ - STREET.backZ;
    const W = 512, H = 2048;
    const px = (x) => ((x + STREET.halfW) / (STREET.halfW * 2)) * W;
    const py = (z) => (1 - (z - STREET.backZ) / len) * H;
    const tex = canvasTexture(W, H, (g) => {
      g.fillStyle = '#66625d'; g.fillRect(0, 0, W, H);
      const rng = new RNG(31);
      for (let i = 0; i < 9000; i++) {
        const v = rng.int(70, 125);
        g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.35)`;
        g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 3), rng.range(1, 3));
      }
      for (let i = 0; i < 26; i++) {           // patches and cracks
        g.fillStyle = `rgba(40,38,36,${rng.range(0.08, 0.2)})`;
        g.beginPath(); g.ellipse(rng.range(0, W), rng.range(0, H), rng.range(10, 60), rng.range(8, 40), rng.range(0, 3), 0, 7); g.fill();
      }
      // worn pitch
      const pg = g.createLinearGradient(px(-1.5), 0, px(1.5), 0);
      pg.addColorStop(0, 'rgba(196,170,128,0)'); pg.addColorStop(0.25, 'rgba(196,170,128,0.55)');
      pg.addColorStop(0.75, 'rgba(196,170,128,0.55)'); pg.addColorStop(1, 'rgba(196,170,128,0)');
      g.fillStyle = pg; g.fillRect(px(-1.5), py(PITCH.releaseZ + 0.8), px(1.5) - px(-1.5), py(PITCH.stumpsZ - 0.5) - py(PITCH.releaseZ + 0.8));
      // chalk
      g.strokeStyle = 'rgba(250,246,235,0.9)'; g.lineWidth = 5; g.lineCap = 'round';
      const line = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(px(x0), py(z0)); g.lineTo(px(x1), py(z1)); g.stroke(); };
      line(-1.3, 0.6, 1.3, 0.6); line(-1.3, PITCH.releaseZ, 1.3, PITCH.releaseZ);
      g.setLineDash([22, 16]); g.lineWidth = 6;
      g.font = '900 86px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      RUN_LINES.forEach((z, i) => {
        g.strokeStyle = 'rgba(250,246,235,0.85)';
        line(-STREET.halfW + 0.2, z, STREET.halfW - 0.2, z);
        g.fillStyle = 'rgba(250,246,235,0.9)';
        g.fillText(String(i + 1), px(-3.6), py(z + 1.3)); g.fillText(String(i + 1), px(3.6), py(z + 1.3));
      });
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,214,90,0.95)';
      g.fillText('4', px(-2.6), py(STREET.endZ - 1.6)); g.fillText('4', px(2.6), py(STREET.endZ - 1.6));
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(STREET.halfW * 2, len), new THREE.MeshLambertMaterial({ map: tex }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -(STREET.backZ + STREET.endZ) / 2);
    road.receiveShadow = true;
    this.root.add(road);
    // ground beyond the play area
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), lam('#7b756c'));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -20);
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  // ---------- houses ----------

  buildHouses() {
    const frame = '#f4efe4';
    const doorColors = ['#6b4a2f', '#2f6f66', '#8a3b2f', '#3c4f7a'];
    const rng = new RNG(88);
    const signTex = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#fff7e0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#b3261e'; g.lineWidth = 14; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#b3261e'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 78px Arial Black, Arial, sans-serif'; g.fillText('ROOF = OUT', w / 2, 96);
      g.font = '700 40px Arial, sans-serif'; g.fillText('Ball will not be returned', w / 2, 184);
    });
    const signMat = new THREE.MeshLambertMaterial({ map: signTex });

    for (const side of [-1, 1]) {
      for (const b of HOUSES[side]) {
        const len = b.z1 - b.z0, cz = -(b.z0 + b.z1) / 2, depth = 7;
        const wallX = side * STREET.halfW;
        this.box(depth, b.h, len - 0.04, b.color, side * (STREET.halfW + depth / 2), b.h / 2, cz);
        // parapet and plinth
        this.box(0.25, 0.5, len, shade(b.color, -0.12), wallX + side * 0.12, b.h + 0.25, cz);
        this.box(0.14, 0.35, len, shade(b.color, -0.22), wallX - side * 0.05, 0.175, cz, { cast: false });
        for (let f = 1; f < b.floors; f++) this.box(0.1, 0.12, len, shade(b.color, -0.1), wallX - side * 0.04, f * 3, cz, { cast: false });

        for (const w of b.windows) {
          const wz = -(w.z0 + w.z1) / 2, wy = (w.y0 + w.y1) / 2;
          const wh = w.y1 - w.y0, wl = w.z1 - w.z0;
          this.box(0.08, wh + 0.16, wl + 0.16, frame, wallX - side * 0.03, wy, wz, { cast: false });
          const lit = rng.chance(0.4);
          this.box(0.06, wh, wl, lit ? '#ffd98a' : '#35506e', wallX - side * 0.06, wy, wz, { cast: false, into: lit ? 'lit' : null });
          this.box(0.07, wh, 0.05, frame, wallX - side * 0.07, wy, wz, { cast: false });
          w.broken = false;
          this.windowInfo.push({ w, x: wallX - side * 0.075, y: wy, z: wz, h: wh, len: wl });
        }
        if (b.door) {
          const d = b.door, dz = -(d.z0 + d.z1) / 2;
          this.box(0.08, d.y1, d.z1 - d.z0, rng.pick(doorColors), wallX - side * 0.04, d.y1 / 2, dz, { cast: false });
          this.box(0.5, 0.14, d.z1 - d.z0 + 0.5, '#8d8477', wallX - side * 0.25, 0.07, dz, { cast: false });
          this.box(0.7, 0.06, d.z1 - d.z0 + 0.6, rng.pick(['#d1503f', '#3f8f86', '#e2a03c']), wallX - side * 0.3, d.y1 + 0.3, dz, { rz: side * 0.35 });
        }
        if (b.balcony) {
          const bz = -(b.z0 + len * 0.5);
          this.box(0.4, 0.1, Math.min(len * 0.5, 3), shade(b.color, -0.18), wallX - side * 0.2, 3.02, bz);
          this.box(0.04, 0.5, Math.min(len * 0.5, 3), '#3b3b3b', wallX - side * 0.38, 3.32, bz, { cast: false });
        }
        if (b.tank && !b.out) {
          this.solid(new THREE.CylinderGeometry(0.65, 0.7, 1.2, 12), '#23282d', side * (STREET.halfW + 2.2), b.h + 0.85, cz + rng.range(-1, 1));
        }
        if (b.out) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), signMat);
          sign.position.set(wallX - side * 0.09, 3.0 + 0.05, cz);
          sign.rotation.y = -side * Math.PI / 2;
          sign.matrixAutoUpdate = false; sign.updateMatrix();
          this.root.add(sign);
          // broken glass on the parapet makes the "do not hit it here" message obvious
          for (let k = 0; k < 9; k++) {
            this.solid(new THREE.ConeGeometry(0.07, 0.3, 4), '#e9f3f5', wallX + side * 0.12, b.h + 0.62, -(b.z0 + (len * (k + 0.5)) / 9), { cast: false });
          }
        }
      }
    }
    this.paneGeo = new THREE.BoxGeometry(1, 1, 1);
    this.brokenMat = lam('#10151c');
  }

  // ---------- end walls and what lies beyond ----------

  buildWalls() {
    const brick = canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#a5533f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(240,225,205,0.55)'; g.lineWidth = 3;
      for (let r = 0; r < 4; r++) {
        g.beginPath(); g.moveTo(0, r * 32); g.lineTo(w, r * 32); g.stroke();
        for (let c = 0; c < 5; c++) { const x = c * 64 + (r % 2) * 32; g.beginPath(); g.moveTo(x, r * 32); g.lineTo(x, r * 32 + 32); g.stroke(); }
      }
    });
    brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
    const wall = (h, z, repeatY) => {
      const tex = brick.clone(); tex.repeat.set(8, repeatY); tex.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.BoxGeometry(STREET.halfW * 2, h, 0.35), new THREE.MeshLambertMaterial({ map: tex }));
      m.position.set(0, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.root.add(m);
    };
    wall(STREET.endWallH, -(STREET.endZ + 0.17), 1.2);
    wall(STREET.backWallH, -(STREET.backZ - 0.17), 2);
    this.box(STREET.halfW * 2 + 0.2, 0.1, 0.5, '#d8cbb4', 0, STREET.endWallH + 0.05, -(STREET.endZ + 0.17));

    const fourTex = canvasTexture(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#ffd24a'; g.font = '900 210px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('4', w / 2, h / 2 + 10);
    });
    const fours = [-3, 0, 3].map((x) => new THREE.PlaneGeometry(1.1, 1.1).translate(x, 0.78, -(STREET.endZ - 0.02)));
    const fourMesh = new THREE.Mesh(mergeGeometries(fours, false), new THREE.MeshBasicMaterial({ map: fourTex, transparent: true }));
    fourMesh.matrixAutoUpdate = false;
    this.root.add(fourMesh);

    // the cross street beyond the far wall
    const rng = new RNG(5);
    const far = ['#cfae8c', '#a7c4c9', '#d9a38c', '#c3cfa5', '#e0c9a1'];
    let x = -30;
    while (x < 30) {
      const w = rng.range(6, 10), h = rng.range(6, 12);
      this.box(w - 0.1, h, 8, rng.pick(far), x + w / 2, h / 2, -(STREET.endZ + 16), { cast: false });
      x += w;
    }
    for (const tx of [-7.5, 8.5, 2.5]) this.tree(tx, -(STREET.endZ + 6 + Math.abs(tx) * 0.3), 1 + Math.abs(tx) * 0.04);
  }

  tree(x, z, s = 1) {
    this.solid(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 3 * s, 7), '#6b4a32', x, 1.5 * s, z);
    for (const [dx, dy, dz, r] of [[0, 3.6, 0, 1.6], [0.9, 3.1, 0.3, 1.1], [-0.8, 3.2, -0.4, 1.2], [0.1, 4.5, 0.2, 1.0]]) {
      this.solid(new THREE.IcosahedronGeometry(r * s, 0), '#4f8f4a', x + dx * s, dy * s, z + dz * s);
    }
  }

  // ---------- stumps ----------

  buildStumps() {
    const g = new THREE.Group();
    g.position.set(0, 0, -PITCH.stumpsZ);
    const mat = lam('#ffd23f'), bailMat = lam('#e2452f');
    this.stumpParts = [];
    for (const x of [-0.11, 0, 0.11]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, STUMPS.h, 8), mat);
      s.position.set(x, STUMPS.h / 2, 0); s.castShadow = true;
      g.add(s); this.stumpParts.push(s);
    }
    for (const x of [-0.055, 0.055]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.025), bailMat);
      b.position.set(x, STUMPS.h + 0.012, 0);
      g.add(b); this.stumpParts.push(b);
    }
    this.box(0.5, 0.05, 0.22, '#3a3a3a', 0, 0.025, -PITCH.stumpsZ);
    this.stumpHome = this.stumpParts.map((p) => ({ p: p.position.clone(), r: p.rotation.clone() }));
    this.stumpVel = null;
    this.root.add(g);
    // a couple of bricks mark the bowler's end
    this.box(0.24, 0.1, 0.12, '#a5533f', -0.35, 0.05, -(PITCH.releaseZ + 0.4));
    this.box(0.24, 0.1, 0.12, '#a5533f', -0.35, 0.15, -(PITCH.releaseZ + 0.42));
  }

  knockStumps(dir = 0) {
    const rng = new RNG(Math.floor(performance.now()));
    this.stumpVel = this.stumpParts.map(() => ({
      v: new THREE.Vector3(rng.range(-1.2, 1.2) + dir, rng.range(2, 4.2), rng.range(1.5, 3.5)),
      w: new THREE.Vector3(rng.range(-9, 9), rng.range(-4, 4), rng.range(-9, 9))
    }));
  }

  resetStumps() {
    this.stumpVel = null;
    this.stumpParts.forEach((p, i) => { p.position.copy(this.stumpHome[i].p); p.rotation.copy(this.stumpHome[i].r); });
  }

  // ---------- props ----------

  buildProps() {
    const dark = '#2c2f36';
    // scooter against the right wall
    const sx = STREET.halfW - 0.55, sz = -5.2;
    this.box(0.34, 0.5, 1.1, '#2e9c8f', sx, 0.55, sz);
    this.box(0.3, 0.12, 0.6, '#1d1d1f', sx, 0.86, sz + 0.2);
    this.box(0.32, 0.55, 0.12, '#2e9c8f', sx, 0.85, sz - 0.5);
    this.box(0.5, 0.05, 0.05, dark, sx, 1.16, sz - 0.52);
    for (const z of [0.42, -0.5]) this.solid(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12), dark, sx, 0.2, sz + z, { rz: Math.PI / 2 });

    // potted plants by a few doors
    for (const [x, z] of [[-4.55, -3], [4.5, -9.5], [-4.55, -15.5], [4.55, -22], [-4.5, -8.4]]) {
      this.solid(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 8), '#b0623f', x, 0.15, z);
      this.solid(new THREE.IcosahedronGeometry(0.3, 0), '#4c9a54', x, 0.55, z);
    }
    // crates
    this.box(0.5, 0.4, 0.5, '#b98a4e', -4.5, 0.2, -18.6);
    this.box(0.45, 0.35, 0.45, '#a67a42', -4.5, 0.58, -18.55, { ry: 0.3 });

    // lamp posts and the wires between them
    const poles = [[-4.7, -2], [4.7, -11], [-4.7, -20]];
    for (const [x, z] of poles) {
      const inward = -Math.sign(x);
      this.solid(new THREE.CylinderGeometry(0.07, 0.09, 8.5, 6), '#5a5148', x, 4.25, z);
      this.box(1.1, 0.07, 0.07, '#5a5148', x, 8.1, z, { cast: false });
      // lamp arm, shade and bulb
      this.box(1.3, 0.06, 0.06, '#4a433c', x + inward * 0.65, 6.6, z, { cast: false });
      this.box(0.5, 0.08, 0.3, '#3a352f', x + inward * 1.25, 6.56, z, { cast: false });
      this.box(0.34, 0.1, 0.18, '#ffffff', x + inward * 1.25, 6.47, z, { into: 'bulbs' });
      const light = new THREE.PointLight('#ffca85', 0, 26, 1.7);
      light.position.set(x + inward * 1.25, 6.3, z);
      light.visible = false;
      this.scene.add(light);
      this.lamps.push(light);
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const [x0, z0] = poles[i], [x1, z1] = poles[i + 1];
      const pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, 8.1 - Math.sin(t * Math.PI) * 0.7, z0 + (z1 - z0) * t)); }
      this.lines.push(pts);
    }

    // festive bunting high across the street, and fairy lights for festival nights
    const colors = ['#ff7a3d', '#ffd23f', '#2e9c8f', '#e2452f', '#5b8def', '#f08ac0'];
    const strings = [-6.5, -14.5, -24];
    const n = 13;
    const shape = new THREE.Shape();
    shape.moveTo(-0.22, 0); shape.lineTo(0.22, 0); shape.lineTo(0, -0.42); shape.closePath();
    this.flags = new THREE.InstancedMesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), strings.length * n);
    const col = new THREE.Color();
    const sag = (t) => 7.4 - Math.sin(t * Math.PI) * 0.9;
    const fairyPos = [];
    strings.forEach((z, si) => {
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const i = si * n + k;
        this.flagData.push({ x: -STREET.halfW + t * STREET.halfW * 2, y: sag(t), z, phase: k * 0.7 + z });
        this.flags.setColorAt(i, col.set(colors[k % colors.length]));
      }
      const pts = [];
      for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new THREE.Vector3(-STREET.halfW + t * STREET.halfW * 2, sag(t), z)); }
      this.lines.push(pts);
      for (let k = 0; k <= 26; k++) { const t = k / 26; fairyPos.push([-STREET.halfW + t * STREET.halfW * 2, sag(t) - 0.5, z + 0.05]); }
    });
    // extra strings of lights zig-zagging lower down
    for (const [z0, z1] of [[-3, -9], [-11, -18], [-20, -27]]) {
      for (let k = 0; k <= 30; k++) { const t = k / 30; fairyPos.push([-STREET.halfW + t * STREET.halfW * 2, 5.7 - Math.sin(t * Math.PI) * 0.8, z0 + (z1 - z0) * t]); }
    }
    this.flags.instanceColor.needsUpdate = true;
    this.root.add(this.flags);

    const fairyColors = ['#ffd76a', '#ff6f6f', '#7fe0a2', '#7cc4ff', '#ffa3e0'];
    this.fairy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ fog: false }), fairyPos.length);
    fairyPos.forEach(([x, y, z], i) => {
      M.makeTranslation(x, y, z);
      this.fairy.setMatrixAt(i, M);
      this.fairy.setColorAt(i, col.set(fairyColors[i % fairyColors.length]));
    });
    this.fairy.instanceColor.needsUpdate = true;
    this.fairy.visible = false;
    this.root.add(this.fairy);
  }

  // ---------- windows ----------

  resetWindows() {
    for (const m of this.broken) this.root.remove(m);
    this.broken.length = 0;
    for (const info of this.windowInfo) info.w.broken = false;
  }

  breakWindow(win) {
    const info = this.windowInfo.find((x) => x.w === win);
    if (!info || win.broken) return;
    win.broken = true;
    const m = new THREE.Mesh(this.paneGeo, this.brokenMat);
    m.position.set(info.x, info.y, info.z);
    m.scale.set(0.1, info.h, info.len);
    this.root.add(m);
    this.broken.push(m);
  }

  update(dt, time) {
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt / 2.5);
      const t = this.mix * this.mix * (3 - 2 * this.mix);
      this.applyState(mixState(this.from, this.to, t, this.state));
    }
    for (let i = 0; i < this.flagData.length; i++) {
      const f = this.flagData[i];
      M.compose(V.set(f.x, f.y, f.z), Q.setFromEuler(E.set(Math.sin(time * 2.2 + f.phase) * 0.35, 0, 0)), ONE);
      this.flags.setMatrixAt(i, M);
    }
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.stumpVel) {
      this.stumpParts.forEach((p, i) => {
        const s = this.stumpVel[i];
        s.v.y -= 9.8 * dt;
        p.position.addScaledVector(s.v, dt);
        p.rotation.x += s.w.x * dt; p.rotation.z += s.w.z * dt;
        if (p.position.y < 0.03) { p.position.y = 0.03; s.v.set(s.v.x * 0.5, 0, s.v.z * 0.5); s.w.multiplyScalar(0.4); }
      });
    }
  }
}

const V_WARM = new THREE.Color('#ffe2a6');

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}
