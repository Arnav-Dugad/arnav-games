// Dev helper: captures the startup animation in a fresh browser (no stored session flags), frame by frame.
// Usage (from ui/, with `npx vite` running): PORT=5173 OUT=../.playwright-mcp/imm FRAMES=200,400,… node scripts/intro-check.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const port = process.env.PORT ?? '5173';
const out = process.env.OUT ?? '../.playwright-mcp/imm';
const frames = (process.env.FRAMES ?? '400,1000,1600,2200').split(',').map(Number);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
// CLOCK=1: a fake clock, so each frame is exactly at its time even on a busy PC.
const fake = !!process.env.CLOCK;
if (fake) await page.clock.install();
await page.goto(`http://localhost:${port}/`, { waitUntil: 'commit' });
await page.waitForSelector('.intro');
if (fake) {
  let at = 0;
  for (const ms of frames) {
    await page.clock.runFor(ms - at);
    at = ms;
    await page.screenshot({ path: `${out}/intro-${ms}.png` });
    console.log(ms, 'ms: intro visible =', await page.locator('.intro').isVisible().catch(() => false));
  }
  await browser.close();
  process.exit(0);
}
const t0 = Date.now();
for (const ms of frames) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  await page.screenshot({ path: `${out}/intro-${ms}.png` });
  console.log(Date.now() - t0, 'ms: intro visible =', await page.locator('.intro').isVisible().catch(() => false));
}
await page.waitForTimeout(2000);
console.log('after the last frame + 2s: intro visible =', await page.locator('.intro').isVisible().catch(() => false));
await browser.close();
