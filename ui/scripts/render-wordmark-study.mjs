// Wordmark study for Arnav Games: candidate typefaces, weights and tracking with the chosen mark.
// Output: assets/brand/concepts/wordmark-sheet.png. Usage (from ui/): node scripts/render-wordmark-study.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const font = (name, file) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, `ui/node_modules/@fontsource-variable/${name}/files/${file}`)).toString('base64')}`;
const mark = readFileSync(resolve(root, 'assets/brand/concepts/11-facet-star-mono.svg'), 'utf8').replace(
  'width="512" height="512"',
  'width="64" height="64" style="color:#fff"',
).replaceAll('#15131D', '#F2EFFA');

const options = [
  ['Unbounded 600, caps, +0.32em', `font-family:U;font-weight:600;letter-spacing:.32em;font-size:30px`, 'ARNAV GAMES'],
  ['Unbounded 500, caps, +0.18em', `font-family:U;font-weight:500;letter-spacing:.18em;font-size:30px`, 'ARNAV GAMES'],
  ['Geist 600, caps, +0.26em', `font-family:G;font-weight:600;letter-spacing:.26em;font-size:34px`, 'ARNAV GAMES'],
  ['Geist 600 / 300, caps, +0.26em', `font-family:G;letter-spacing:.26em;font-size:34px`, '<b style="font-weight:600">ARNAV</b> <span style="font-weight:300">GAMES</span>'],
  ['Geist 560, title case, -0.02em', `font-family:G;font-weight:560;letter-spacing:-.02em;font-size:40px`, 'Arnav Games'],
  ['Unbounded 500, title case, -0.01em', `font-family:U;font-weight:500;letter-spacing:-.01em;font-size:34px`, 'Arnav Games'],
];

const html = `<!doctype html><html><head><style>
@font-face { font-family: U; src: url('${font('unbounded', 'unbounded-latin-wght-normal.woff2')}'); font-weight: 200 900; }
@font-face { font-family: G; src: url('${font('geist', 'geist-latin-wght-normal.woff2')}'); font-weight: 100 900; }
body{margin:0;width:1100px;background:#0b0b10;color:#f2effa;font-family:G}
.r{display:flex;align-items:center;gap:26px;padding:26px 36px;border-bottom:1px solid #222}
.l{width:260px;color:#9a95ad;font-size:13px}
.w{white-space:nowrap}
</style></head><body>${options
  .map(([label, css, text]) => `<div class="r"><div class="l">${label}</div>${mark}<div class="w" style="${css}">${text}</div></div>`)
  .join('')}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 600 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, 'assets/brand/concepts/wordmark-sheet.png'), fullPage: true });
await browser.close();
console.log('Rendered wordmark-sheet.png');
