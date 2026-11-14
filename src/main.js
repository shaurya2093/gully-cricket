import { Store } from './store.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { setupInput } from './input.js';

function boot() {
  const store = new Store();
  const sound = new Sound(store.data.settings.sound);
  const ui = new UI(store, sound);
  let game;
  try {
    game = new Game(document.getElementById('stage'), store, sound, ui);
  } catch (err) {
    ui.fatal('This browser could not start 3D graphics (WebGL). Try updating the browser or opening the game on another device.');
    return;
  }
  ui.attach(game);
  setupInput(game, sound, document.getElementById('touch'));
  ui.home();
  window.__gs = { game, store, ui }; // handy for debugging and automated tests

  // Offline support when the game is hosted as files. Not available inside previews.
  if ('serviceWorker' in navigator && /^https:$/.test(location.protocol) && !window.__SINGLE_FILE__) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
