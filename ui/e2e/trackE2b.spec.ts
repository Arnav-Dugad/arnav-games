import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contrastRatio, gamutMap, lchToRgb, parseOklch, type RGB } from '../src/lib/color';

// Track E2b: the living interface — the sidebar's motion states, smooth number changes (prices after a currency
// switch), "Use a game's colours" (contrast-checked in every theme, High contrast always wins) and the Living
// Canvas's quality levels. Preview switches: ?theme=light|contrast, ?canvasQuality=high|balanced|low, ?canvasOff,
// ?audioReact, ?noParallax, ?dataSaver (bridge/preview.trackE2b.ts).

async function open(page: Page, query = '') {
  await page.addInitScript(() => sessionStorage.setItem('vystral.introPlayed', '1'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await expect(page.locator('.shell').first()).toBeVisible();
  return errors;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function settings(page: Page, section = 'Appearance') {
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
}

async function noSeriousViolations(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

const iconStyle = (page: Page, name: string) =>
  nav(page).getByRole('button', { name: new RegExp(`^${name}`) }).locator('.nav-item__icon').evaluate((el) => {
    const svg = el.querySelector('svg')!;
    const cs = getComputedStyle(el);
    return { fillOpacity: Number(getComputedStyle(svg).fillOpacity), fill: getComputedStyle(svg).fill, animation: cs.animationName, transform: cs.transform };
  });

test.describe('living sidebar', () => {
  test('the active icon fills in and pops, the indicator moves, hover nudges, counts spring in', async ({ page }) => {
    const errors = await open(page);
    const home = await iconStyle(page, 'Home');
    expect(home.fillOpacity).toBeGreaterThan(0.2);
    expect(home.animation).toBe('nav-icon-pop');
    expect((await iconStyle(page, 'Library')).fillOpacity).toBe(0);
    await expect(nav(page).locator('.nav-item__count').first()).toHaveCSS('animation-name', 'nav-badge-in');

    await nav(page).getByRole('button', { name: /^Library/ }).click();
    await expect(nav(page).getByRole('button', { name: /^Library/ })).toHaveAttribute('aria-current', 'page');
    // The bar and pill now live in Library (they glide there: one shared layout id each).
    await expect(nav(page).locator('.nav-item__bar')).toHaveCount(1);
    await expect(nav(page).getByRole('button', { name: /^Library/ }).locator('.nav-item__bar')).toHaveCount(1);
    await expect.poll(async () => (await iconStyle(page, 'Library')).fillOpacity).toBeGreaterThan(0.2);
    await expect.poll(async () => (await iconStyle(page, 'Home')).fillOpacity).toBe(0);

    // Hover: the icon leans toward its label.
    await nav(page).getByRole('button', { name: 'Journal', exact: true }).hover();
    await expect.poll(async () => (await iconStyle(page, 'Journal')).transform).toMatch(/matrix\(1, 0, 0, 1, 2, 0\)/);
    expect(errors).toEqual([]);
  });

  test('reduced motion: plain state changes, no pops, nudges or springs', async ({ page }) => {
    await open(page, '?reduced');
    const home = await iconStyle(page, 'Home');
    expect(home.animation).toBe('none');
    expect(home.fillOpacity).toBeGreaterThan(0.2); // the state itself still shows
    await expect(nav(page).locator('.nav-item__count').first()).toHaveCSS('animation-name', 'none');
    await nav(page).getByRole('button', { name: 'Journal', exact: true }).hover();
    await page.waitForTimeout(300);
    expect((await iconStyle(page, 'Journal')).transform).toBe('none');
  });

  test('High contrast: no washes or glows, a solid edge on the active item', async ({ page }) => {
    await open(page, '?theme=contrast&reduced');
    expect((await iconStyle(page, 'Home')).fill).toBe('none');
    await expect(nav(page).locator('.nav-item__bar')).toHaveCSS('box-shadow', 'none');
    await expect(nav(page).locator('.nav-item__pill')).toHaveCSS('box-shadow', /inset/);
    await noSeriousViolations(page, 'nav.sidebar');
  });

  test('the sidebar has no serious or critical axe violations', async ({ page }) => {
    await open(page, '?reduced');
    await noSeriousViolations(page, 'nav.sidebar');
  });
});

test.describe('smooth number changes', () => {
  test('converted prices roll to their new value after a currency change; screen readers get the final value', async ({ page }) => {
    const errors = await open(page, '?currency=USD');
    await settings(page);
    // The euro example is shown for both dollars and rupees, so it is the same element before and after.
    const sample = page.getByTestId('currency-settings').locator('.cur-sample').filter({ hasText: '€' }).locator('.cur-sample__to');
    await expect(sample).toContainText('$');
    // Record the transition as it happens (it lasts well under half a second).
    await page.evaluate(() => {
      const w = window as unknown as { __shift?: unknown };
      const root = document.querySelector('[data-testid="currency-settings"]')!;
      const mo = new MutationObserver(() => {
        const el = [...root.querySelectorAll('.cur-sample')].find((s) => s.textContent?.includes('€'))?.querySelector('.nshift[data-shift]');
        if (!el || w.__shift) return;
        w.__shift = {
          mode: el.getAttribute('data-shift'),
          spoken: el.querySelector(':scope > .visually-hidden')?.textContent,
          animHidden: el.querySelector('.nshift__anim')?.getAttribute('aria-hidden'),
          out: el.querySelector('.nshift__out')?.textContent,
          in: el.querySelector('.nshift__in')?.textContent,
        };
        mo.disconnect();
      });
      mo.observe(root, { subtree: true, childList: true, attributes: true });
    });
    await page.getByLabel('Show prices in').selectOption('INR');
    const shift = await page.waitForFunction(() => (window as unknown as { __shift?: Record<string, string> }).__shift).then((h) => h.jsonValue());
    expect(shift.mode).toBe('crossfade'); // "$" → "₹": a different currency crossfades rather than rolling digits
    expect(shift.spoken).toMatch(/^≈ ₹[\d,]+/); // screen readers get the final value straight away
    expect(shift.animHidden).toBe('true');
    expect(shift.out).toContain('$');
    expect(shift.in).toContain('₹');
    // Then it lands on the plain text, exactly as without the effect.
    await expect(sample.locator('.nshift')).toHaveCount(0);
    await expect(sample).toHaveText(/^≈ ₹[\d,]+(\.\d+)?$/);
    expect(errors).toEqual([]);
  });

  test('reduced motion changes numbers instantly', async ({ page }) => {
    await open(page, '?currency=USD&reduced');
    await settings(page);
    // The euro example is shown for both dollars and rupees, so it is the same element before and after.
    const sample = page.getByTestId('currency-settings').locator('.cur-sample').filter({ hasText: '€' }).locator('.cur-sample__to');
    await expect(sample).toContainText('$');
    await page.getByLabel('Show prices in').selectOption('INR');
    await expect(sample).toHaveText(/^≈ ₹/);
    await expect(sample.locator('.nshift')).toHaveCount(0);
  });
});

/** Reads a resolved custom property as a colour (registered accent-set props resolve to plain oklch()/rgb()). */
async function cssColour(page: Page, name: string): Promise<RGB> {
  const v = await page.evaluate((n) => {
    // Resolve through a probe so var() chains and relative colours become a used colour.
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
  const ok = parseOklch(v);
  if (ok) return lchToRgb(gamutMap(ok));
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(v);
  if (!m) throw new Error(`unreadable colour ${name}: ${v}`);
  const k = v.startsWith('color(') ? 1 : 255;
  return [Number(m[1]) / k, Number(m[2]) / k, Number(m[3]) / k];
}

async function pickGame(page: Page, title: string) {
  await page.getByRole('button', { name: /Choose a game|Change…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Use a game’s colours' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search your games' }).fill(title.slice(0, 6));
  await dialog.getByRole('button', { name: title }).click();
  await expect(dialog.getByTestId('gacc-preview')).toBeVisible();
  return dialog;
}

async function expectReadable(page: Page, theme: 'dark' | 'light') {
  const surfaces = await Promise.all(['--bg-0', '--bg-1', '--bg-2'].map((n) => cssColour(page, n)));
  const text = await cssColour(page, '--accent-text');
  const accent = await cssColour(page, '--accent');
  const hi = await cssColour(page, '--accent-hi');
  const on = await cssColour(page, '--text-on-accent');
  const ring = await cssColour(page, '--focus-outline');
  for (const s of surfaces) {
    expect(contrastRatio(text, s), `${theme} accent text`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ring, s), `${theme} focus ring`).toBeGreaterThanOrEqual(3);
  }
  expect(contrastRatio(on, accent), `${theme} text on accent`).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(on, hi), `${theme} text on hover`).toBeGreaterThanOrEqual(4.5);
}

test.describe('use a game’s colours', () => {
  test('previews live, reports contrast, applies, and reverts (dark)', async ({ page }) => {
    const errors = await open(page, '?reduced');
    await settings(page);
    const dialog = await pickGame(page, 'Hollow Lantern');
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'cover');
    // Every pairing the preview lists meets its WCAG threshold.
    const ratios = await dialog.locator('.gacc-tokens__ratio').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ratio'))));
    expect(ratios).toHaveLength(5);
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(3);
    await expect(dialog.getByText('Meets WCAG AA contrast in Obsidian, OLED and Light.')).toBeVisible();
    await expectReadable(page, 'dark');
    await noSeriousViolations(page, '[role="dialog"]');

    // Cancel puts everything back.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent-set', /.+/);

    // Apply: saved, and the game's swatch joins the accent choices.
    const again = await pickGame(page, 'Hollow Lantern');
    await again.getByRole('button', { name: 'Use these colours' }).click();
    await expect(again).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'cover');
    await expect(page.getByRole('radio', { name: 'Game colours' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('game-accent')).toContainText('Hollow Lantern');

    // Revert goes back to the accent chosen before (Automatic here).
    await page.getByTestId('game-accent').getByRole('button', { name: 'Revert' }).click();
    await expect(page.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-accent-set', /.+/);
    expect(errors).toEqual([]);
  });

  test('stays readable in the Light theme', async ({ page }) => {
    await open(page, '?reduced&theme=light');
    await settings(page);
    const dialog = await pickGame(page, 'Ember Run');
    await dialog.getByRole('button', { name: 'Use these colours' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'cover');
    await expectReadable(page, 'light');
    await noSeriousViolations(page, '[data-testid="game-accent"]');
  });

  test('High contrast always wins', async ({ page }) => {
    await open(page, '?reduced&theme=contrast');
    await settings(page);
    await expect(page.getByTestId('game-accent')).toContainText('High contrast always keeps its own colours');
    const dialog = await pickGame(page, 'Hollow Lantern');
    await dialog.getByRole('button', { name: 'Use these colours' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'cover');
    // The contrast theme's yellow accent and ring are untouched.
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('oklch(0.88 0.16 100)');
    const ring = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--focus-outline').trim());
    expect(ring).toBe('oklch(0.9 0.18 100)');
  });

  test('works alongside the Windows accent: switching hands colour back', async ({ page }) => {
    await open(page, '?reduced');
    await settings(page);
    await page.getByRole('radio', { name: 'Windows accent' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'system');
    const dialog = await pickGame(page, 'Hollow Lantern');
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'cover'); // the preview wins while open
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent-set', 'system');
    await expectReadable(page, 'dark');
  });
});

const canvas = (page: Page) => page.locator('.living-canvas');

test.describe('Living Canvas quality levels', () => {
  test('High draws three depth layers at 55 % resolution; Balanced two at 40 %', async ({ page }) => {
    await open(page, '?canvasQuality=high');
    await expect(canvas(page)).toHaveAttribute('data-quality', 'high');
    await expect(canvas(page)).toHaveAttribute('data-layers', '3');
    await expect(canvas(page)).toHaveAttribute('data-state', 'running');
    await expect(canvas(page)).toHaveAttribute('data-parallax', 'on');
    const w = await page.locator('.living-canvas__gl').evaluate((c: HTMLCanvasElement) => c.width / innerWidth);
    expect(w).toBeCloseTo(0.55, 1);
    // It is animating: frames keep coming, each costing well under a millisecond of script.
    const frames = async () => Number(await canvas(page).getAttribute('data-frames'));
    await expect.poll(frames, { timeout: 5000 }).toBeGreaterThan(10);
    const jsMs = Number(await canvas(page).getAttribute('data-js-ms'));
    expect(jsMs).toBeLessThan(2);

    await page.goto('/?canvasQuality=balanced');
    await expect(canvas(page)).toHaveAttribute('data-quality', 'balanced');
    await expect(canvas(page)).toHaveAttribute('data-layers', '2');
    const wb = await page.locator('.living-canvas__gl').evaluate((c: HTMLCanvasElement) => c.width / innerWidth);
    expect(wb).toBeCloseTo(0.4, 1);
  });

  test('Low and off draw nothing (static gradient)', async ({ page }) => {
    await open(page, '?canvasQuality=low');
    await expect(canvas(page)).toHaveAttribute('data-enabled', 'false');
    await expect(canvas(page)).toHaveAttribute('data-state', 'off');
    await expect(page.locator('.living-canvas__gl')).toHaveCount(0);
    await page.goto('/?canvasOff');
    await expect(canvas(page)).toHaveAttribute('data-state', 'off');
  });

  test('reduced motion and Performance Mode hold a still frame with no parallax or sound reaction', async ({ page }) => {
    await open(page, '?reduced&audioReact');
    await expect(canvas(page)).toHaveAttribute('data-state', 'still');
    await expect(canvas(page)).toHaveAttribute('data-parallax', 'off');
    await expect(canvas(page)).toHaveAttribute('data-audio', 'off');
    // A still frame redraws only while a colour change settles (a couple of seconds at most), then stops.
    const frames = async () => Number(await canvas(page).getAttribute('data-frames'));
    await expect.poll(async () => {
      const a = await frames();
      await page.waitForTimeout(1000);
      return (await frames()) - a;
    }, { timeout: 15_000 }).toBe(0);
    expect(await frames()).toBeLessThan(400); // never a running loop

    await page.goto('/?nowPlaying');
    await expect(canvas(page)).toHaveAttribute('data-state', 'still');
    await expect(canvas(page)).toHaveAttribute('data-parallax', 'off');
  });

  test('Data saver keeps to the lightest form; the sound reaction is opt-in', async ({ page }) => {
    await open(page, '?dataSaver&canvasQuality=high&audioReact');
    await expect(canvas(page)).toHaveAttribute('data-fps', '20');
    await expect(canvas(page)).toHaveAttribute('data-layers', '2');
    await expect(canvas(page)).toHaveAttribute('data-parallax', 'off');
    await expect(canvas(page)).toHaveAttribute('data-audio', 'off');
    await page.goto('/?audioReact');
    await expect(canvas(page)).toHaveAttribute('data-audio', 'on');
    await page.goto('/?noParallax');
    await expect(canvas(page)).toHaveAttribute('data-parallax', 'off');
  });

  test('pauses while the window is hidden', async ({ page }) => {
    await open(page);
    await expect(canvas(page)).toHaveAttribute('data-state', 'running');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(canvas(page)).toHaveAttribute('data-state', 'paused');
    const a = await canvas(page).getAttribute('data-frames');
    await page.waitForTimeout(1500);
    expect(await canvas(page).getAttribute('data-frames')).toBe(a);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(canvas(page)).toHaveAttribute('data-state', 'running');
  });

  test('the appearance settings for the canvas have no serious or critical axe violations', async ({ page }) => {
    await open(page, '?reduced');
    await settings(page);
    await expect(page.getByRole('switch', { name: 'Depth with the pointer' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Breathe with ambient sound' })).not.toBeChecked();
    await noSeriousViolations(page, '.settings__content');
  });
});
