// The layout of the houses on both sides of the street. The simulation needs it for
// wall heights and window positions, and the 3D scene draws the same data.
import { RNG } from './rng.js';

const PALETTE = ['#e9c79a', '#9cc7c1', '#e7a37c', '#c8d7a0', '#dbb6c6', '#f0deb0', '#a8bdd4', '#e2a198', '#b9d3b0', '#f2c078'];

function generate() {
  const rng = new RNG(4217);
  const sides = { '-1': [], '1': [] };
  for (const side of [-1, 1]) {
    let z = -12;
    let idx = 0;
    while (z < 46) {
      const len = rng.range(5.6, 8.2);
      const floors = rng.chance(0.28) ? 3 : 2;
      const h = floors * 3 + rng.range(0.3, 0.8);
      const b = {
        side, idx: idx++, z0: z, z1: z + len, h, floors,
        color: rng.pick(PALETTE), out: false, windows: [], door: null,
        balcony: floors >= 2 && rng.chance(0.55), tank: rng.chance(0.5)
      };
      const slots = len > 6.8 ? 3 : 2;
      const doorSlot = rng.int(0, slots - 1);
      for (let f = 0; f < floors; f++) {
        for (let s = 0; s < slots; s++) {
          const cz = b.z0 + (len * (s + 0.5)) / slots;
          if (f === 0 && s === doorSlot) {
            b.door = { z0: cz - 0.55, z1: cz + 0.55, y0: 0, y1: 2.1 };
            continue;
          }
          const y0 = f * 3 + 1.15;
          b.windows.push({ z0: cz - 0.6, z1: cz + 0.6, y0, y1: y0 + 1.15, broken: false });
        }
      }
      sides[side].push(b);
      z += len;
    }
  }
  // One house on each side belongs to a neighbour who keeps the ball: clearing its roof is out.
  const pickOut = (side, targetZ) => {
    const b = sides[side].find((x) => x.z0 <= targetZ && x.z1 > targetZ);
    b.out = true;
    b.floors = 2;
    b.h = 6.5;
    b.windows = b.windows.filter((w) => w.y0 < 6);
    b.color = '#d9534a';
  };
  pickOut(1, 13);
  pickOut(-1, 21);
  return sides;
}

export const HOUSES = generate();

export function buildingAt(side, z) {
  const list = HOUSES[side > 0 ? 1 : -1];
  for (const b of list) if (z >= b.z0 && z < b.z1) return b;
  return z < list[0].z0 ? list[0] : list[list.length - 1];
}

export function windowAt(side, z, y) {
  const b = buildingAt(side, z);
  for (const w of b.windows) {
    if (z >= w.z0 - 0.05 && z <= w.z1 + 0.05 && y >= w.y0 - 0.05 && y <= w.y1 + 0.05) return w;
  }
  return null;
}
