// Builds the Arnav Games identity from one parametric drawing of the mark ("Ascent"):
// SVG sources (symbol, mono, light, app icon, lockups, favicon), the PNG set, the .ico,
// the installer splash, the README hero and a review board. See docs/BRAND.md.
//
// The wordmark is outlined separately (fonts to paths): python ui/scripts/outline-wordmark.py
// Usage (from ui/): node scripts/render-brand-arnav.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { star4, squircle, f } from './brand-geometry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const brand = resolve(root, 'assets/brand');
const at = (...p) => resolve(root, ...p);
mkdirSync(resolve(brand, 'png'), { recursive: true });

// ---------------------------------------------------------------------------------------------
// Geometry. The master is drawn on a 512 grid; small icon sizes get their own hinted drawing.
//   xo    outer edge of the left foot (the right foot mirrors it)
//   base  baseline (feet), apex  the tip of the A
//   foot  width of each blade at the baseline
// Everything else is derived, so all sizes share one construction:
//   inner apex (where the counter closes) at 38.3% of the height, star centre at 76%,
//   star radius 11.9% of the symbol's width, horizontal arms 86% of the vertical ones.
// ---------------------------------------------------------------------------------------------
const MASTER = { size: 512, xo: 96, base: 404, apex: 96, foot: 84 };
// Hinted drawings: integer feet and baseline, the facet seam on a pixel boundary (even sizes),
// a proportionally larger symbol and a heavier foot as the icon gets smaller.
const HINTED = {
  16: { size: 16, xo: 2, base: 13, apex: 2, foot: 3.25 },
  20: { size: 20, xo: 3, base: 16, apex: 2.5, foot: 3.75 },
  24: { size: 24, xo: 3, base: 19.5, apex: 3, foot: 4.5 },
  32: { size: 32, xo: 5, base: 26, apex: 4, foot: 5.5 },
  40: { size: 40, xo: 6, base: 32, apex: 5, foot: 6.75 },
  48: { size: 48, xo: 7, base: 38.5, apex: 6, foot: 8 },
};

function geometry(spec) {
  const { size, xo, base, apex, foot } = spec;
  const cx = size / 2;
  const h = base - apex;
  const w = size - 2 * xo;
  const innerApex = apex + 0.383 * h;
  const r = Math.max(size <= 20 ? 1.7 : 2, 0.119 * w);
  return {
    size,
    cx,
    apex,
    base,
    outerL: xo,
    outerR: size - xo,
    innerL: xo + foot,
    innerR: size - xo - foot,
    innerApex,
    star: { cx, cy: apex + 0.76 * h, r, rx: r * 0.86 },
    bbox: { x: xo, y: apex, w, h },
    small: size < 64,
  };
}
const master = geometry(MASTER);

// ---------------------------------------------------------------------------------------------
// Colour. Light comes from the upper left: the left blade is lit (star white into brand violet),
// the right blade is in shade (ice blue into brand blue). The star is the brightest point.
// Hex values are sRGB renderings of the tokens in ui/src/styles/tokens.css.
// ---------------------------------------------------------------------------------------------
const C = {
  star: '#FFFFFF',
  litTop: '#F5F2FF', // --star
  litMid: '#BBA8FF', // --violet-hi
  litLow: '#8466FF', // --violet, a touch deeper at the foot
  shadeTop: '#C9D5FF',
  shadeMid: '#7F9CFF', // --blue-hi → --blue
  shadeLow: '#3F5FEA',
  tileTop: '#1D1A2B',
  tileLow: '#09090F',
  glow: '#7C5CFF',
  ink: '#F2EFFA', // --text-1
  inkDark: '#14121C',
  // For light backgrounds (the pale blade would vanish on white)
  lightLit: ['#8B6CFF', '#6D4DF2', '#4B2FD0'],
  lightShade: ['#6F8DFF', '#3E63E8', '#2445C2'],
  lightStar: '#6D4DF2',
};

/** The symbol's drawing in the coordinate space of `g`. `id` keeps gradient ids unique per document;
 *  `halo` adds a soft glow under the blades (tile only: it would be clipped by a tight artboard). */
function symbol(g, id, mode = 'colour', halo = false) {
  const { cx, apex, base, outerL, outerR, innerL, innerR, innerApex, star } = g;
  const silhouette = `M${f(outerL)} ${f(base)}L${f(cx)} ${f(apex)}L${f(outerR)} ${f(base)}L${f(innerR)} ${f(base)}L${f(cx)} ${f(innerApex)}L${f(innerL)} ${f(base)}Z`;
  const shade = `M${f(cx)} ${f(apex)}L${f(outerR)} ${f(base)}L${f(innerR)} ${f(base)}L${f(cx)} ${f(innerApex)}Z`;
  const starD = star4(star.cx, star.cy, star.r, g.small ? 0.3 : 0.22, star.rx);
  if (mode === 'mono') return `<path d="${silhouette}" fill="currentColor"/><path d="${starD}" fill="currentColor"/>`;
  const lit = mode === 'light' ? C.lightLit : [C.litTop, C.litMid, C.litLow];
  const shd = mode === 'light' ? C.lightShade : [C.shadeTop, C.shadeMid, C.shadeLow];
  const grad = (name, stops, x2) =>
    `<linearGradient id="${name}${id}" gradientUnits="userSpaceOnUse" x1="${f(cx)}" y1="${f(apex)}" x2="${f(x2)}" y2="${f(base)}">${stops
      .map((s, i) => `<stop offset="${[0, 0.48, 1][i]}" stop-color="${s}"/>`)
      .join('')}</linearGradient>`;
  const fx = !g.small && mode === 'colour';
  const blur = g.size * 0.016;
  return `<defs>${grad('lit', lit, outerL + (innerL - outerL) / 2)}${grad('shd', shd, outerR - (outerR - innerR) / 2)}${
    fx ? `<filter id="soft${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(blur)}"/></filter>` : ''
  }</defs>${
    fx && halo ? `<path d="${silhouette}" fill="${C.glow}" opacity="0.38" filter="url(#soft${id})"/>` : ''
  }<path d="${silhouette}" fill="url(#lit${id})"/><path d="${shade}" fill="url(#shd${id})"/>${
    fx ? `<circle cx="${f(star.cx)}" cy="${f(star.cy)}" r="${f(star.r * 0.85)}" fill="#C8B6FF" opacity="0.5" filter="url(#soft${id})"/>` : ''
  }<path d="${starD}" fill="${mode === 'light' ? C.lightStar : C.star}"/>`;
}

/** App icon: the symbol on an obsidian superellipse tile. */
function icon(spec, id = 'i') {
  const g = geometry(spec);
  const S = g.size;
  const sq = squircle(S, 4.4);
  const rim = S >= 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<defs>
<linearGradient id="tile${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.tileTop}"/><stop offset="1" stop-color="${C.tileLow}"/></linearGradient>
<radialGradient id="aura${id}" cx="0.5" cy="0.74" r="0.58"><stop offset="0" stop-color="${C.glow}" stop-opacity="${g.small ? 0.34 : 0.46}"/><stop offset="0.6" stop-color="#3D63FF" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="rim${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0.08"/></linearGradient>
<clipPath id="clip${id}"><path d="${sq}"/></clipPath>
</defs>
<path d="${sq}" fill="url(#tile${id})"/>
<path d="${sq}" fill="url(#aura${id})"/>
${rim ? `<path d="${sq}" fill="none" stroke="url(#rim${id})" stroke-width="${f(S / 128)}" clip-path="url(#clip${id})"/>` : ''}
${symbol(g, id, 'colour', true)}
</svg>
`;
}

/** Bare symbol, tight to its bounding box (apex to baseline, outer foot to outer foot). */
function symbolFile(mode) {
  const { x, y, w, h } = master.bbox;
  const colour = mode === 'mono' ? ' color="#14121C"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"${colour} role="img" aria-label="Arnav Games">
<title>Arnav Games</title>
${symbol(master, mode[0], mode)}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------
// Lockups. Units are the master grid's; the wordmark comes from arnav-games-wordmark.svg.
// ---------------------------------------------------------------------------------------------
function readWordmark(light) {
  const svg = readFileSync(resolve(brand, `arnav-games-wordmark${light ? '-light' : ''}.svg`), 'utf8');
  const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const cap = Number(svg.match(/data-cap-height="([^"]+)"/)[1]);
  const paths = [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]).join('');
  return { vx, vy, vw, vh, cap, paths };
}

function lockup(kind, light) {
  const wm = readWordmark(light);
  const { x, y, w, h } = master.bbox;
  const mode = light ? 'light' : 'colour';
  const id = `${kind[0]}${light ? 'l' : 'd'}`;
  let k; // wordmark scale
  let tx; // wordmark translate
  let ty;
  let W;
  let H;
  let sx = 0; // symbol offset
  if (kind === 'horizontal') {
    // Cap height 30% of the symbol's height; caps centred 4% below the symbol's middle, which
    // sits them on the A's visual centre of mass (a triangle's weight is low).
    const capH = 0.3 * h;
    k = capH / wm.cap;
    const gap = 0.34 * h;
    const capTop = 0.54 * h - capH / 2;
    tx = w + gap - wm.vx * k;
    ty = capTop;
    W = w + gap + wm.vw * k;
    H = h;
  } else {
    // Wordmark 2.7× the symbol's width, centred; gap 30% of the symbol's height.
    const wmW = 2.7 * w;
    k = wmW / wm.vw;
    const gap = 0.3 * h;
    W = wmW;
    sx = (W - w) / 2;
    tx = -wm.vx * k;
    ty = h + gap;
    H = h + gap + (wm.cap - Math.min(0, wm.vy)) * k + Math.max(0, wm.vy + wm.vh - wm.cap) * k;
  }
  const pad = 0; // tight artboard; clear space is documented in docs/BRAND.md
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad)} ${f(-pad)} ${f(W + 2 * pad)} ${f(H + 2 * pad)}" width="${f(W)}" height="${f(H)}" role="img" aria-label="Arnav Games">
<title>Arnav Games</title>
<g transform="translate(${f(sx - x)} ${f(-y)})">${symbol(master, id, mode)}</g>
<g transform="translate(${f(tx)} ${f(ty)}) scale(${(k).toFixed(5)})">${wm.paths}</g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------
// Write the SVG sources
// ---------------------------------------------------------------------------------------------
const write = (p, s) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
};
const iconMaster = icon(MASTER, 'm');
write(resolve(brand, 'arnav-games-mark.svg'), symbolFile('colour'));
write(resolve(brand, 'arnav-games-mark-mono.svg'), symbolFile('mono'));
write(resolve(brand, 'arnav-games-mark-light.svg'), symbolFile('light'));
write(resolve(brand, 'arnav-games-icon.svg'), iconMaster);
for (const s of Object.keys(HINTED)) write(resolve(brand, `icon-hinted/arnav-games-icon-${s}.svg`), icon(HINTED[s], `h${s}`));
for (const kind of ['horizontal', 'stacked']) {
  write(resolve(brand, `arnav-games-lockup-${kind}.svg`), lockup(kind, false));
  write(resolve(brand, `arnav-games-lockup-${kind}-light.svg`), lockup(kind, true));
}
write(at('ui/public/arnav-games-mark.svg'), symbolFile('colour'));
write(at('ui/public/arnav-games-icon.svg'), iconMaster);
// Favicon candidate: the 32 px hinted drawing (browsers show favicons at 16–32 px).
write(at('ui/public/arnav-games-favicon.svg'), icon(HINTED[32], 'fav'));

// ---------------------------------------------------------------------------------------------
// Rasters
// ---------------------------------------------------------------------------------------------
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const font = (name, file) =>
  `data:font/woff2;base64,${readFileSync(at(`ui/node_modules/@fontsource-variable/${name}/files/${file}`)).toString('base64')}`;
const fontFaces = `@font-face { font-family: Geist; src: url('${font('geist', 'geist-latin-wght-normal.woff2')}'); font-weight: 100 900; }`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = {};
for (const size of sizes) {
  const svg = HINTED[size] ? icon(HINTED[size], 'r') : iconMaster.replace('width="512" height="512"', `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  pngs[size] = buf;
  write(resolve(brand, `png/arnav-games-${size}.png`), buf);
}

// .ico with embedded PNGs (Windows Vista and later), hinted drawings at 16–48 px.
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
const entries = [];
let offset = 6 + 16 * icoSizes.length;
for (const size of icoSizes) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[size].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[size].length;
  entries.push(e);
}
const ico = Buffer.concat([header, ...entries, ...icoSizes.map((s) => pngs[s])]);
write(resolve(brand, 'arnav-games.ico'), ico);
// The app project's copies: ApplicationIcon (exe, taskbar, Start menu, Alt+Tab), the window icon and the
// icon registered with the app's AUMID for notifications (Host/ShellIntegration.cs).
write(at('src/Vystral.App/Assets/arnav-games.ico'), ico);
write(at('src/Vystral.App/Assets/arnav-games-256.png'), pngs[256]);

const stacked = readFileSync(resolve(brand, 'arnav-games-lockup-stacked.svg'), 'utf8');
const horizontal = readFileSync(resolve(brand, 'arnav-games-lockup-horizontal.svg'), 'utf8');
const markSvg = symbolFile('colour');

// Installer splash, 640 × 400 like the old one.
await page.setViewportSize({ width: 640, height: 400 });
await page.setContent(`<!doctype html><html><head><style>${fontFaces}
html,body{margin:0;width:640px;height:400px;overflow:hidden}
body{display:grid;place-items:center;font-family:Geist;background:
 radial-gradient(46% 52% at 50% 46%, rgb(124 92 255 / .22), transparent 70%),
 radial-gradient(70% 80% at 86% -6%, rgb(95 70 210 / .30), transparent 70%),
 radial-gradient(60% 70% at 4% 106%, rgb(52 86 220 / .26), transparent 70%), #09090e}
.c{display:flex;flex-direction:column;align-items:center}
.c img{width:300px}
.t{margin-top:26px;font-size:11px;font-weight:450;letter-spacing:.34em;text-indent:.34em;color:#a29cbb}
</style></head><body><div class="c"><img src="${uri(stacked)}"><div class="t">YOUR UNIVERSE OF PLAY</div></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(brand, 'arnav-games-installer-splash.png') });

// README hero, 1600 × 600.
const starfield = Array.from({ length: 70 }, (_, i) => {
  // Deterministic scatter (no Math.random) so re-renders are identical.
  const x = (i * 977) % 1600;
  const y = (i * 571 + 37) % 600;
  const r = ((i * 13) % 10) / 10 + 0.4;
  const o = (((i * 7) % 10) / 10) * 0.35 + 0.08;
  return `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
}).join('');
await page.setViewportSize({ width: 1600, height: 600 });
await page.setContent(`<!doctype html><html><head><style>${fontFaces}
html,body{margin:0;width:1600px;height:600px;overflow:hidden}
body{position:relative;font-family:Geist;background:
 radial-gradient(38% 60% at 50% 58%, rgb(124 92 255 / .20), transparent 72%),
 radial-gradient(50% 70% at 92% -10%, rgb(95 70 210 / .34), transparent 70%),
 radial-gradient(46% 70% at 6% 110%, rgb(52 86 220 / .28), transparent 70%),
 linear-gradient(#0d0c15, #08080d)}
svg.sf{position:absolute;inset:0}
.horizon{position:absolute;left:0;right:0;top:438px;height:1px;background:linear-gradient(90deg,transparent,rgb(200 186 255 / .22) 30%,rgb(200 186 255 / .22) 70%,transparent)}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:30px}
.c img{width:820px}
.t{margin-top:40px;font-size:15px;font-weight:450;letter-spacing:.42em;text-indent:.42em;color:#a29cbb}
</style></head><body><svg class="sf" viewBox="0 0 1600 600">${starfield}</svg><div class="horizon"></div>
<div class="c"><img src="${uri(horizontal)}"><div class="t">YOUR UNIVERSE OF PLAY</div></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(brand, 'arnav-games-readme-hero.png') });

// Review board: every deliverable at a glance, including the true small rasters blown up.
const pix = (size) => `<figure><img class="px" src="data:image/png;base64,${pngs[size].toString('base64')}" style="width:${size * 6}px"><figcaption>${size} px ×6</figcaption></figure>`;
await page.setViewportSize({ width: 1400, height: 900 });
await page.setContent(`<!doctype html><html><head><style>${fontFaces}
body{margin:0;width:1400px;font:13px Geist;color:#a29cbb;background:#0b0b10}
section{padding:28px 36px;border-bottom:1px solid #1f1d29;display:flex;gap:30px;align-items:flex-end;flex-wrap:wrap}
section.light{background:#f4f3f8;color:#5d5870}
h2{width:100%;margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.2em;color:#e9e5f7}
section.light h2{color:#14121c}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px}
.px{image-rendering:pixelated}
</style></head><body>
<section><h2>APP ICON (TILE)</h2>${[1024, 256, 128, 64, 48, 40, 32, 24, 20, 16]
  .map((s) => `<figure><img src="data:image/png;base64,${pngs[s].toString('base64')}" width="${Math.min(s, 256)}" height="${Math.min(s, 256)}"><figcaption>${s}${s > 256 ? ' (shown 256)' : ''}</figcaption></figure>`)
  .join('')}</section>
<section><h2>SMALL SIZES, TRUE PIXELS ×6</h2>${[16, 20, 24, 32, 48].map(pix).join('')}</section>
<section><h2>SYMBOL ON DARK</h2><img src="${uri(markSvg)}" height="160">${[64, 32, 20, 14].map((s) => `<img src="${uri(markSvg)}" height="${s}">`).join('')}</section>
<section class="light"><h2>SYMBOL ON LIGHT · MONO</h2><img src="${uri(symbolFile('light'))}" height="160"><img src="${uri(symbolFile('mono'))}" height="160">${[64, 32, 20, 14].map((s) => `<img src="${uri(symbolFile('light'))}" height="${s}">`).join('')}</section>
<section><h2>LOCKUPS</h2><img src="${uri(horizontal)}" width="760"><img src="${uri(stacked)}" width="300"></section>
<section class="light"><h2>LOCKUPS ON LIGHT</h2><img src="${uri(lockup('horizontal', true))}" width="760"><img src="${uri(lockup('stacked', true))}" width="300"></section>
<section><h2>SMALL LOCKUPS</h2><img src="${uri(horizontal)}" width="200"><img src="${uri(horizontal)}" width="160"><img src="${uri(stacked)}" width="120"></section>
</body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(brand, 'concepts/final-board.png'), fullPage: true });
await browser.close();
console.log('Rendered the Arnav Games set:', sizes.join(', '), 'px, arnav-games.ico, splash, README hero and final-board.png');
