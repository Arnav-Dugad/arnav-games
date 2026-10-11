// Renders the Arnav Games mark exploration: one SVG per concept plus a comparison sheet
// (tile at 256/64/32/16 px on dark, bare mark at 64/32/16 px on light, and the true 16 px
// raster blown up 6x). Output: assets/brand/concepts/.
// Usage (from ui/): node scripts/render-brand-concepts.mjs
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundPoly, star4, f } from './brand-geometry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'assets/brand/concepts');
mkdirSync(out, { recursive: true });

// Every concept draws in a 512 grid; `c` is the paint (a colour or url(#paint)).
const concepts = [
  {
    id: '01-monoline',
    title: 'Monoline',
    idea: 'One continuous stroke: up the left leg, over the apex, down the right leg, then back across as the bar.',
    draw: (c) =>
      `<path d="M150 404 L256 124 L337 338 L176 338" fill="none" stroke="${c}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: '02-delta',
    title: 'Delta',
    idea: 'A solid, softened triangle (a play button standing up) with the counter and the gap between the legs cut out.',
    draw: (c, k) => `<mask id="m${k}"><rect width="512" height="512" fill="#fff"/>
      <path d="${roundPoly([[256, 236], [298, 314], [214, 314]], 8)}" fill="#000"/>
      <path d="${roundPoly([[256, 352], [306, 440], [206, 440]], 10)}" fill="#000"/></mask>
      <path mask="url(#m${k})" d="${roundPoly([[256, 96], [428, 410], [84, 410]], [44, 24, 24])}" fill="${c}"/>`,
  },
  {
    id: '03-facet',
    title: 'Facet',
    idea: 'Two blades lean together into an A; a four-point star is the bar. The VYSTRAL V, turned over and reborn.',
    draw: (c) => `<polygon points="100,404 176,404 256,206 256,108" fill="${c}"/>
      <polygon points="412,404 336,404 256,206 256,108" fill="${c}" opacity="0.78"/>
      <path d="${star4(256, 338, 40)}" fill="${c}"/>`,
  },
  {
    id: '04-crest',
    title: 'Crest',
    idea: 'A soft shield with the A carried as negative space.',
    draw: (c, k) => `<mask id="m${k}"><rect width="512" height="512" fill="#fff"/>
      <path d="M180 360 L256 166 L332 360 M206 300 H306" fill="none" stroke="#000" stroke-width="36" stroke-linejoin="round" stroke-linecap="round"/></mask>
      <path mask="url(#m${k})" d="M256 86 C306 108 356 120 410 124 V262 C410 352 344 408 256 436 C168 408 102 352 102 262 V124 C156 120 206 108 256 86 Z" fill="${c}"/>`,
  },
  {
    id: '05-orbit',
    title: 'Orbit',
    idea: 'A peak circled by a tilted orbit that doubles as the bar, with one bright body on its path.',
    draw: (c, k) => `<mask id="m${k}"><rect width="512" height="512" fill="#fff"/>
      <ellipse cx="256" cy="316" rx="172" ry="50" transform="rotate(-12 256 316)" fill="none" stroke="#000" stroke-width="40"/></mask>
      <path mask="url(#m${k})" d="M156 404 L256 132 L356 404" fill="none" stroke="${c}" stroke-width="46" stroke-linejoin="round"/>
      <path d="M86 340 A172 50 -12 0 1 410 260" transform="rotate(0)" fill="none" stroke="${c}" stroke-width="18" stroke-linecap="round"/>
      <circle cx="402" cy="262" r="22" fill="${c}"/>`,
  },
  {
    id: '06-cards',
    title: 'House of cards',
    idea: 'Two game cards lean into an apex and a third lies across: a library that spells A.',
    draw: (c) => `<rect x="-46" y="-150" width="92" height="300" rx="20" transform="translate(204 272) rotate(21)" fill="${c}" opacity="0.72"/>
      <rect x="-46" y="-150" width="92" height="300" rx="20" transform="translate(308 272) rotate(-21)" fill="${c}"/>
      <rect x="170" y="322" width="172" height="40" rx="14" fill="${c}"/>`,
  },
  {
    id: '07-ag',
    title: 'AG ligature',
    idea: 'The A’s right leg sweeps round into a G, sharing the bar.',
    draw: (c) =>
      `<path d="M128 404 L232 132 L282 262 M196 308 H330 V352 A96 96 0 1 1 352 238" fill="none" stroke="${c}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: '08-peak-play',
    title: 'Peak + Play',
    idea: 'A bold peak with a play triangle as its bar: A for Arnav, play for Games.',
    draw: (c) => `<path d="M138 404 L256 118 L374 404" fill="none" stroke="${c}" stroke-width="56" stroke-linejoin="round"/>
      <path d="${roundPoly([[230, 282], [298, 322], [230, 362]], 9)}" fill="${c}"/>`,
  },
  {
    id: '09-apex',
    title: 'Apex',
    idea: 'Two weighted strokes and a sheared crossbar resolve into one sharp, faceted A; the bar floats free of the legs.',
    draw: (c) => apex(c),
  },
  {
    id: '10-split',
    title: 'Split A',
    idea: 'A solid A cut down the middle into two tones: two stores, one library.',
    draw: (c, k) => `<mask id="m${k}"><rect width="512" height="512" fill="#fff"/>
      <path d="${roundPoly([[256, 238], [296, 314], [216, 314]], 6)}" fill="#000"/>
      <path d="${roundPoly([[256, 356], [302, 440], [210, 440]], 8)}" fill="#000"/></mask>
      <clipPath id="c${k}"><path d="${roundPoly([[256, 96], [428, 410], [84, 410]], [44, 24, 24])}"/></clipPath>
      <g mask="url(#m${k})"><path d="${roundPoly([[256, 96], [428, 410], [84, 410]], [44, 24, 24])}" fill="${c}"/>
      <rect x="256" y="0" width="256" height="512" fill="#000" opacity="0.28" clip-path="url(#c${k})"/></g>`,
  },
];

// Apex: a geometric A with a light left stroke, a heavy right stroke and a flat-cut apex.
function apex(c) {
  return `<path d="M116 404 L236 104 H290 L410 404 H344 L252 174 L160 404 Z" fill="${c}"/>
    <path d="M206 300 H298 L308 326 H196 Z" fill="${c}"/>`;
}

const tile = (k, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="t${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B1828"/><stop offset="1" stop-color="#09090F"/></linearGradient>
    <radialGradient id="g${k}" cx="0.5" cy="0.7" r="0.6"><stop offset="0" stop-color="#7C5CFF" stop-opacity="0.42"/><stop offset="0.6" stop-color="#3D63FF" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="p${k}" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#F4F0FF"/><stop offset="0.5" stop-color="#C9B8FF"/><stop offset="1" stop-color="#7E9BFF"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#t${k})"/>
  <rect width="512" height="512" rx="116" fill="url(#g${k})"/>
  <rect x="2" y="2" width="508" height="508" rx="114" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="2"/>
  ${inner(`url(#p${k})`, `T${k}`)}
</svg>`;

const bare = (k, inner, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner(color, `B${k}`)}</svg>`;

// Round two: refinements of the strongest ideas (Facet, Delta) before choosing.
const innerX = (y) => 178 + ((410 - y) / 192) * 78; // left blade's inner edge
const finalists = [
  {
    id: '11-facet-star',
    title: 'Facet II (star bar)',
    idea: 'Facet with wedge blades that widen to the foot, a tighter apex and an optically centred star.',
    draw: (c) => `<polygon points="92,410 178,410 256,218 256,98" fill="${c}"/>
      <polygon points="420,410 334,410 256,218 256,98" fill="${c}" opacity="0.74"/>
      <path d="${star4(256, 336, 38)}" fill="${c}"/>`,
  },
  {
    id: '12-facet-bar',
    title: 'Facet II (floating bar)',
    idea: 'The same blades with a bar that floats free of the legs: quieter, more typographic.',
    draw: (c) => `<polygon points="92,410 178,410 256,218 256,98" fill="${c}"/>
      <polygon points="420,410 334,410 256,218 256,98" fill="${c}" opacity="0.74"/>
      <polygon points="${f(innerX(314) + 14)},314 ${f(512 - innerX(314) - 14)},314 ${f(512 - innerX(340) - 14)},340 ${f(innerX(340) + 14)},340" fill="${c}"/>`,
  },
  {
    id: '13-star-window',
    title: 'Star window',
    idea: 'A solid, faceted A whose counter is the four-point star: light shining through the letter.',
    draw: (c, k) => `<mask id="m${k}"><rect width="512" height="512" fill="#fff"/>
      <path d="${star4(256, 300, 50, 0.2)}" fill="#000"/>
      <path d="${roundPoly([[256, 372], [300, 452], [212, 452]], 8)}" fill="#000"/></mask>
      <clipPath id="c${k}"><path d="${roundPoly([[256, 90], [434, 412], [78, 412]], [36, 20, 20])}"/></clipPath>
      <g mask="url(#m${k})"><path d="${roundPoly([[256, 90], [434, 412], [78, 412]], [36, 20, 20])}" fill="${c}"/>
      <rect x="256" y="0" width="256" height="512" fill="#0B0A12" opacity="0.26" clip-path="url(#c${k})"/></g>`,
  },
];

const renderList = (list, prefix) =>
  list.map((cpt, i) => ({ ...cpt, tileSvg: tile(prefix + i, cpt.draw), bareSvg: bare(prefix + i, cpt.draw, '#15131D') }));

const old = readFileSync(resolve(root, 'assets/brand/vystral-mark.svg'), 'utf8');
const reference = { id: '00-vystral', title: 'VYSTRAL (today)', idea: 'For reference.', tileSvg: old, bareSvg: old };
const round1 = renderList(concepts, 'a');
const round2 = renderList(finalists, 'b');
for (const cpt of [...round1, ...round2]) {
  writeFileSync(resolve(out, `${cpt.id}.svg`), cpt.tileSvg);
  writeFileSync(resolve(out, `${cpt.id}-mono.svg`), cpt.bareSvg);
}

const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const rows = (all) =>
  all.map(
    (cpt) => `<div class="row">
  <div class="meta"><b>${cpt.title}</b><span>${cpt.idea}</span></div>
  <div class="dark">${[256, 64, 32, 16].map((s) => `<img src="${uri(cpt.tileSvg)}" width="${s}" height="${s}">`).join('')}
    <canvas data-src="${uri(cpt.tileSvg)}" width="16" height="16"></canvas></div>
  <div class="light">${[64, 32, 16].map((s) => `<img src="${uri(cpt.bareSvg)}" width="${s}" height="${s}">`).join('')}
    <canvas data-src="${uri(cpt.bareSvg)}" width="16" height="16"></canvas></div>
</div>`,
  )
  .join('');
const html = (all) => `<!doctype html><html><head><style>
body{margin:0;background:#0b0b10;font:13px/1.4 'Segoe UI',sans-serif;color:#cfcbe0;width:1240px}
.row{display:grid;grid-template-columns:240px 1fr 360px;align-items:center;border-bottom:1px solid #222}
.meta{padding:16px}.meta b{display:block;color:#fff;font-size:15px;margin-bottom:4px}
.dark,.light{display:flex;align-items:center;gap:22px;padding:14px 18px}
.light{background:#f3f2f7;height:100%;box-sizing:border-box}
canvas{width:96px;height:96px;image-rendering:pixelated;outline:1px solid #8884}
</style></head><body>${rows(all)}
<script>
window.done = Promise.all([...document.querySelectorAll('canvas')].map(cv => new Promise(res => {
  const im = new Image(); im.onload = () => { cv.getContext('2d').drawImage(im, 0, 0, 16, 16); res(); }; im.src = cv.dataset.src;
})));
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 800 } });
for (const [file, list] of [
  ['concept-sheet.png', [reference, ...round1]],
  ['finalists-sheet.png', [reference, ...round2]],
]) {
  await page.setContent(html(list));
  await page.evaluate(() => window.done);
  await page.screenshot({ path: resolve(out, file), fullPage: true });
}
await browser.close();
console.log('Rendered', concepts.length + finalists.length, 'concepts and both sheets');
