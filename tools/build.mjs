// Bundles the game.
//   app.js                  the script index.html loads (commit this file)
//   dist/gully-sixes.html   the whole game in one file, handy for sharing or previews
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  outfile: 'app.js',
  legalComments: 'none',
  logLevel: 'warning'
});

const js = readFileSync('app.js', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const icon = readFileSync('icon.svg', 'utf8');
let html = readFileSync('index.html', 'utf8');
const iconUri = 'data:image/svg+xml,' + encodeURIComponent(icon);
html = html
  .replace('<link rel="manifest" href="manifest.json">\n', '')
  .replace('  <link rel="apple-touch-icon" href="apple-touch-icon.png">\n', '')
  .replace('  <meta property="og:image" content="og.jpg">\n', '')
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', () => `<link rel="icon" href="${iconUri}">`)
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
  .replace('<script src="app.js"></script>', () => `<script>window.__SINGLE_FILE__=true;</script>\n<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/gully-sixes.html', html);
console.log(`app.js ${(js.length / 1024).toFixed(0)} KB, dist/gully-sixes.html ${(html.length / 1024).toFixed(0)} KB`);
