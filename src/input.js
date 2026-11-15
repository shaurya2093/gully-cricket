// Keyboard, mouse and touch controls.
// Swipe mode (default): swipe or drag in the direction you want to hit; a plain tap hits straight.
// Tap mode: the swing starts the moment the finger lands, and where it lands across the
// screen (left, middle, right) sets the direction.
const SWIPE_PX = 22;
const MAX_AIM = 1.2;

export function setupInput(game, sound, surface) {
  let start = null;

  const aimFrom = (dx, dy) => {
    // Up the screen is straight down the street. Downward swipes count as straight.
    const a = Math.atan2(dx, Math.max(-dy, Math.abs(dx) * 0.35));
    return Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
  };

  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    sound.unlock();
    if (game.store.data.settings.controls === 'tap') {
      const w = surface.clientWidth || window.innerWidth || 1;
      const f = (e.clientX / w - 0.5) * 2;       // -1 at the left edge, +1 at the right edge
      const aim = Math.abs(f) < 0.2 ? 0 : Math.sign(f) * Math.min(MAX_AIM, 0.25 + (Math.abs(f) - 0.2) * 1.5);
      game.swing(aim);
      start = null;
      return;
    }
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, fired: false };
    if (surface.setPointerCapture) { try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ } }
  });
  surface.addEventListener('pointermove', (e) => {
    if (!start || start.fired || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) >= SWIPE_PX) { start.fired = true; game.swing(aimFrom(dx, dy)); }
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (!start.fired && e.type === 'pointerup') game.swing(0);
    start = null;
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  const KEYS = {
    ArrowLeft: -0.6, KeyA: -0.6, ArrowUp: 0, KeyW: 0, Space: 0, Enter: 0, ArrowRight: 0.6, KeyD: 0.6,
    KeyQ: -1.1, KeyE: 1.1
  };
  // Moving across the crease: hold Z / C (or , / .) or the on-screen arrow buttons.
  const MOVE_KEYS = { KeyZ: -1, Comma: -1, KeyC: 1, Period: 1 };
  const heldKeys = new Set();
  const moveFromKeys = () => {
    let dir = 0;
    for (const code of heldKeys) dir += MOVE_KEYS[code];
    game.moveDir = Math.sign(dir);
  };
  for (const [id, dir] of [['moveL', -1], ['moveR', 1]]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const stop = () => { if (game.moveDir === dir) game.moveDir = 0; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.unlock();
      game.moveDir = dir;
      btn.classList.add('on');
      if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ } }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code in MOVE_KEYS) { heldKeys.add(e.code); moveFromKeys(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { game.holdLoft(true); return; }
    if (e.repeat) return;
    if (e.code === 'KeyL') { game.setLoft(!game.loft); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { game.pause(!game.paused); return; }
    if (e.code in KEYS && game.state !== 'menu' && game.state !== 'ended' && !game.paused) {
      e.preventDefault();
      sound.unlock();
      game.swing(KEYS[e.code]);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') game.holdLoft(false);
    if (e.code in MOVE_KEYS) { heldKeys.delete(e.code); moveFromKeys(); }
  });
  window.addEventListener('blur', () => { game.holdLoft(false); heldKeys.clear(); game.moveDir = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(true); });
  window.addEventListener('resize', () => game.resize());
}
