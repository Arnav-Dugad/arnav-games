import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The 1.0.0 rename: the Arnav Games name, the Ascent mark and the wordmark (docs/BRAND.md).

async function open(page: Page, query = '?reduced') {
  await page.addInitScript(() => sessionStorage.setItem('vystral.introPlayed', '1'));
  await page.goto(`/${query}`);
  await expect(page.locator('.shell')).toBeVisible();
}

test.describe('brand', () => {
  test('the window is Arnav Games, with the mark and the wordmark in the title bar', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle('Arnav Games');
    const brand = page.locator('.titlebar__brand');
    await expect(brand.locator('.wordmark')).toHaveText('Arnav Games');
    await expect(brand.locator('.wordmark')).toHaveCSS('text-transform', 'uppercase');
    // The mark is decorative next to the name, and drawn inline so it follows the theme.
    await expect(brand.locator('.brand-mark')).toHaveAttribute('aria-hidden', 'true');
    await expect(brand.locator('.brand-mark .brand-mark__star')).toHaveCount(1);
    const axe = await new AxeBuilder({ page }).include('.titlebar').analyze();
    expect(axe.violations).toEqual([]);
  });

  for (const [theme, star] of [['light', 'rgb(109, 77, 242)'], ['contrast', null]] as const) {
    test(`the mark follows the ${theme} theme`, async ({ page }) => {
      await open(page, `?reduced&theme=${theme}`);
      const mark = page.locator('.titlebar__mark');
      if (star) await expect(mark.locator('.brand-mark__star')).toHaveCSS('fill', star);
      // High contrast: one ink, no shaded blade.
      else await expect(mark.locator('.brand-mark__shaded')).toBeHidden();
    });
  }

  test('the mode-switch flare lands exactly on the star of the mark', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const m = await import('/src/components/brand/BrandMark.tsx');
      const el = document.querySelector('.titlebar__mark') as HTMLElement;
      const b = el.getBoundingClientRect();
      const star = el.querySelector('.brand-mark__star')!.getBoundingClientRect();
      return {
        calc: m.starInMark({ x: b.left, y: b.top, w: b.width, h: b.height }),
        real: { x: star.left + star.width / 2, y: star.top + star.height / 2, height: star.height },
      };
    });
    expect(Math.abs(r.calc.x - r.real.x)).toBeLessThan(0.5);
    expect(Math.abs(r.calc.y - r.real.y)).toBeLessThan(0.5);
    expect(Math.abs(r.calc.height - r.real.height)).toBeLessThan(0.5);
  });

  test('the intro resolves the Arnav Games wordmark', async ({ page }) => {
    await page.goto('/');
    const word = page.locator('.intro__word');
    await expect(word).toHaveAttribute('aria-label', 'Arnav Games');
    await expect(word.locator('span')).toHaveText(['A', 'R', 'N', 'A', 'V', 'G', 'A', 'M', 'E', 'S']);
    await expect(word.locator('.intro__light')).toHaveCount(5);
    await expect(page.locator('.intro__mark path')).not.toHaveCount(0);
  });

  test('reduced motion skips the intro', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.shell')).toBeVisible();
    await expect(page.locator('.intro')).toHaveCount(0);
  });

  test('About shows the app icon and the wordmark', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+,');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'About' }).click();
    const about = page.locator('.about');
    await expect(about.locator('img')).toHaveAttribute('src', './arnav-games-icon.svg');
    await expect(about.locator('.wordmark')).toHaveText('Arnav Games');
    expect(await about.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  });
});
