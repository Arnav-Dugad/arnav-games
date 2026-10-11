import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Track E4: Xbox Store IDs for exact matching, on the preview backend (fictional data; the preview never touches the
// network — asserted in every test). ?xboxstore turns "Xbox Store details" on: the preview's Xbox games then list a
// fictional Microsoft Store product (9NPREVIEW…) found by package lookup, and Circuit Apex's Steam match also comes
// through Wikidata by that Store ID.

async function open(page: Page, query = '?reduced') {
  await page.addInitScript(() => sessionStorage.setItem('vystral.introPlayed', '1'));
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.goto(`/${query}`);
  await expect(page.locator('.shell, .imm, .onb').first()).toBeVisible();
  return { errors, external };
}

async function openVersions(page: Page, title: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Library/ }).click();
  await page.getByLabel('Filter library').fill(title);
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeAttached();
  await page.getByRole('tab', { name: /Versions/ }).click();
  const card = page.getByTestId('identity-card');
  await expect(card).toBeVisible();
  return card;
}

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
}

async function noSeriousViolations(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).exclude('.living-canvas').include(include).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

test.describe('Xbox Store IDs for exact matching', () => {
  test('an Xbox game lists its Microsoft Store ID, found by package lookup, and its Steam match through that ID; axe-clean', async ({ page }) => {
    const { errors, external } = await open(page, '?reduced&xboxstore');
    const card = await openVersions(page, 'Circuit Apex');

    const store = card.locator('[data-kind="msstore"]');
    await expect(store).toBeVisible();
    await expect(store).toContainText('Microsoft Store');
    await expect(store).toContainText(/9NPREVIEW[0-9A-Z]{3}/);
    await expect(store).toContainText('From the Microsoft Store (package lookup)');
    await expect(store).toContainText('Store ID');
    await expect(store).toContainText('Certain');
    await expect(store.getByRole('button', { name: 'Open on Microsoft Store (opens your browser)' })).toBeVisible();

    // The Steam match now comes through Wikidata by that Store ID, not the title.
    const steam = card.locator('[data-kind="steam"]');
    await expect(steam).toContainText('Matched via Wikidata (a store ID link)');
    await expect(steam).toContainText('Used');

    await settled(page);
    await noSeriousViolations(page, '[data-testid="identity-card"]');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('with Xbox Store details off, nothing is looked up and no Store ID is shown', async ({ page }) => {
    const { errors, external } = await open(page);
    const card = await openVersions(page, 'Circuit Apex');
    await expect(card.locator('[data-kind="steam"]')).toContainText('Matched via');
    await expect(card.locator('[data-kind="msstore"]')).toHaveCount(0);
    await expect(card.locator('[data-kind="steam"]')).not.toContainText('a store ID link');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('Xbox Store details is an opt-in source in Settings › Data sources, with what it sends; axe-clean', async ({ page }) => {
    const { errors, external } = await open(page);
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Library & stores' }).click();
    const section = page.getByRole('region', { name: /Data sources/ });
    await expect(section).toBeVisible();
    const card = section.getByRole('article', { name: 'Xbox Store details' });
    await expect(card).toBeVisible();
    const toggle = card.getByRole('switch', { name: 'Use Xbox Store details' });
    await expect(toggle).not.toBeChecked();
    await card.getByRole('button', { name: /What’s sent and licence/ }).click();
    await expect(card).toContainText('package names of the Xbox games installed on this PC');
    await expect(card).toContainText('Not a documented API');
    await toggle.click();
    await expect(toggle).toBeChecked();

    await settled(page);
    await noSeriousViolations(page, '.dsrc');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
});
