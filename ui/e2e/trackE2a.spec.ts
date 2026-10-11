import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Track E2a: "Similar in your library" weighting, collection covers, the Completed 100% ceremony, the wishlist's
// "years waiting" and calendar peel, and the "Open on start" setting. Preview backend, fictional data.

const SHOTS = process.env.E2A_SHOTS; // a folder: save screenshots there while developing
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(page: Page, query = '?reduced') {
  await page.addInitScript(() => sessionStorage.setItem('vystral.introPlayed', '1'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await expect(page.locator('.shell, .imm').first()).toBeVisible();
  await expect.poll(() => page.evaluate("import('/src/state/store.ts').then((m) => m.useStore.getState().libraryLoaded)")).toBe(true);
  return errors;
}

const go = (page: Page, route: object) =>
  page.evaluate(`import('/src/state/store.ts').then((m) => m.useStore.getState().navigate(${JSON.stringify(route)}))`);
const gameId = (page: Page, title: string) =>
  page.evaluate(`import('/src/state/store.ts').then((m) => m.useStore.getState().library.games.find((g) => g.title === ${JSON.stringify(title)}).id)`) as Promise<string>;
const setting = (page: Page, key: string) =>
  page.evaluate(`import('/src/state/store.ts').then((m) => m.useStore.getState().settings[${JSON.stringify(key)}])`);

async function serious(page: Page, include: string) {
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).include(include).exclude('.living-canvas').analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test.describe('Similar in your library (Track E2a weighting)', () => {
  test('a racer suggests racers, names Racing, and leaves the sci-fi horror out', async ({ page }) => {
    // ?tags=clean: each game gets only the tags its genres imply (the plain ?tags adds random extras to every game).
    const errors = await open(page, '?tags=clean&reduced');
    await go(page, { name: 'game', id: await gameId(page, 'Nebula Drift') });
    const strip = page.locator('.similar');
    // Tags arrive a moment after the page (the preview fills them in the background).
    await expect(strip.locator('.similar__why').first()).toContainText('Racing', { timeout: 8000 });
    const titles = await strip.locator('.similar__item .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    // The three racers lead (two of them on other stores: no tags, so their shared Racing genre carries them).
    expect(titles.length).toBeGreaterThanOrEqual(3);
    for (const t of titles.slice(0, 3)) expect(t).toMatch(/^(Circuit Apex|Redline Rivals|Night Courier)/);
    // Anything else is only there because IGDB lists it as similar (the preview's fictional IGDB facts), and says so.
    const whys = await strip.locator('.similar__why').allInnerTexts();
    whys.forEach((why, i) => {
      if (i < 3) expect(why).toMatch(/^Shares Racing/);
      else expect(why).toMatch(/^IGDB calls it similar/);
      expect(why).not.toMatch(/Singleplayer|Atmospheric|Action/);
    });
    // Last Signal (sci-fi horror) shares Sci-fi, Atmospheric and Singleplayer with it: not enough.
    expect(titles.some((t) => t.startsWith('Last Signal'))).toBe(false);
    await strip.scrollIntoViewIfNeeded();
    await shot(page, 'similar-racing');
    expect(await serious(page, '.similar')).toEqual([]);

    // A game with nothing specific in common with the rest shows no strip rather than weak picks.
    await go(page, { name: 'game', id: await gameId(page, 'Lumen Garden') });
    await expect(page.locator('.detail, .game-page, main').first()).toBeVisible();
    await page.waitForTimeout(600);
    const lumen = await page.locator('.similar__why').allInnerTexts();
    for (const why of lumen) expect(why).not.toMatch(/^Shares (Casual|Indie)$/);
    expect(errors).toEqual([]);
  });
});

test.describe('Collection covers', () => {
  test('each collection gets a collage of its games in the sidebar, the Library header and Immersive; a pin wins', async ({ page }) => {
    const errors = await open(page, '?covers&reduced');
    const nav = page.getByRole('navigation', { name: 'Main' });
    // Sidebar: a small cover for every collection with games; the empty one keeps its folder.
    await expect(nav.getByRole('button', { name: 'Racing nights' }).locator('.ccover--sm')).toHaveAttribute('data-kind', 'quad');
    await expect(nav.getByRole('button', { name: 'Among the stars' }).locator('.ccover--sm')).toHaveAttribute('data-kind', 'trio');
    await expect(nav.getByRole('button', { name: 'Weekend list' }).locator('.ccover--sm')).toHaveAttribute('data-kind', 'mosaic');
    await expect(nav.getByRole('button', { name: 'Someday' }).locator('.ccover')).toHaveCount(0);

    // Library header: the large cover. A mosaic shows five and counts the rest.
    await nav.getByRole('button', { name: 'Weekend list' }).click();
    // The page being left can still be fading out: always look at the header with this collection's title.
    const headOf = (name: string) => page.locator('.lib-head').filter({ has: page.getByRole('heading', { name, exact: true }) });
    let head = headOf('Weekend list');
    await expect(head.locator('.ccover--lg')).toHaveAttribute('data-kind', 'mosaic');
    await expect(head.locator('.ccover--lg .ccover__tile')).toHaveCount(5);
    await expect(head.locator('.ccover__more')).toHaveText('+3');
    await shot(page, 'cover-mosaic');
    expect(await serious(page, '.lib-head')).toEqual([]);

    // Pin one game's art as the cover, then go back to the automatic collage.
    await nav.getByRole('button', { name: 'Racing nights' }).click();
    head = headOf('Racing nights');
    await expect(head.locator('.ccover--lg')).toHaveAttribute('data-kind', 'quad');
    await head.getByRole('button', { name: 'Cover', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cover for “Racing nights”' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Automatic/ })).toHaveAttribute('aria-checked', 'true');
    // One Tab stop; arrows move between the choices without choosing.
    await expect(dialog.getByRole('radio', { name: /Automatic/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio').nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(dialog.getByRole('radio', { name: /Automatic/ })).toBeFocused();
    await shot(page, 'cover-picker');
    expect(await serious(page, '.dialog')).toEqual([]);
    await dialog.getByRole('radio', { name: 'Circuit Apex' }).click();
    await expect(dialog).toBeHidden();
    await expect(head.locator('.ccover--lg')).toHaveAttribute('data-kind', 'single');
    await expect(head.locator('.ccover--lg')).toHaveAttribute('data-pinned', 'true');
    const circuit = await gameId(page, 'Circuit Apex');
    expect(await setting(page, 'library.collectionCovers')).toBe(`e2a0c0de000000000000000000000001:${circuit}`);
    await expect(nav.getByRole('button', { name: 'Racing nights' }).locator('.ccover--sm')).toHaveAttribute('data-kind', 'single');
    await head.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('dialog').getByRole('radio', { name: /Automatic/ }).click();
    await expect(head.locator('.ccover--lg')).toHaveAttribute('data-kind', 'quad');
    expect(await setting(page, 'library.collectionCovers')).toBe('');

    // Membership changes rebuild the cover: a fourth game turns the 1+2 into a 2×2.
    await page.evaluate(async (id) => {
      const b = await import('/src/bridge/bridge.ts');
      await b.call('collections.setMembership', { collectionId: 'e2a0c0de000000000000000000000002', gameId: id, member: true });
      const m = await import('/src/state/store.ts');
      await m.useStore.getState().refreshLibrary();
    }, await gameId(page, 'Solace Station'));
    await expect(nav.getByRole('button', { name: 'Among the stars' }).locator('.ccover--sm')).toHaveAttribute('data-kind', 'quad');

    // Immersive: collection rows carry their cover beside the title.
    await page.evaluate("import('/src/state/store.ts').then((m) => m.useStore.getState().setMode('immersive', { instant: true }))");
    await expect(page.locator('.imm').first()).toBeVisible();
    await expect(page.locator('.imm__row--collection .imm__row-title .ccover--row').first()).toBeAttached({ timeout: 8000 });
    expect(errors).toEqual([]);
  });

  test('a pinned cover from settings shows straight away', async ({ page }) => {
    await open(page, '?covers&coverPinned&covers100&reduced');
    const racing = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Racing nights' });
    await expect(racing.locator('.ccover--sm')).toHaveAttribute('data-pinned', 'true');
    await expect(racing.locator('.ccover--sm img')).toHaveCount(1);
  });
});

/** A Steam game that isn't Completed 100% yet (achievements are known for it in the preview). */
async function uncompletedSteamGame(page: Page): Promise<string> {
  return page.evaluate(`import('/src/state/store.ts').then((m) => m.useStore.getState().library.games.find((g) =>
    !g.hidden && g.status !== 'completed' && g.installations.some((i) => i.platform === 'steam') && !['Glasswing', 'Last Signal'].includes(g.title)).title)`) as Promise<string>;
}

test.describe('Completed 100% ceremony', () => {
  test('plays once per game: cover, achievements ring, hours, a saved image; reduced motion fades', async ({ page }) => {
    const errors = await open(page, '?reduced');
    const title = await uncompletedSteamGame(page);
    await go(page, { name: 'game', id: await gameId(page, title) });
    const picker = page.locator('.status-picker');
    await picker.getByRole('button', { name: 'Completed 100%' }).click();

    const moment = page.getByRole('dialog', { name: title });
    await expect(moment).toBeVisible();
    await expect(moment.locator('.c100__eyebrow')).toHaveText('Completed 100%');
    await expect(moment.locator('.c100__ring-words')).toContainText(/\d+ of \d+/);
    await expect(moment.locator('.c100__fact').filter({ hasText: 'played' })).toBeVisible();
    // Reduced motion: no light sweep and no motes.
    await expect(moment.locator('.c100__sweep')).toHaveCount(0);
    await expect(moment.locator('.c100__motes')).toHaveCount(0);
    await expect(moment.getByRole('button', { name: 'Done' })).toBeFocused();
    await shot(page, 'ceremony');
    expect(await serious(page, '.c100')).toEqual([]);

    await moment.getByRole('button', { name: 'Save image' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Image saved' })).toBeVisible();
    const images = await page.evaluate("import('/src/bridge/bridge.ts').then((b) => b.call('preview.completionImages'))") as { kind: string; bytes: number }[];
    expect(images).toHaveLength(1);
    expect(images[0].kind).toBe('save');
    expect(images[0].bytes).toBeGreaterThan(20_000);

    await page.keyboard.press('Escape');
    await expect(moment).toBeHidden();
    // Once per game: back to Playing and Completed again — no second ceremony.
    await picker.getByRole('button', { name: 'Playing' }).click();
    await picker.getByRole('button', { name: 'Completed 100%' }).click();
    await expect(picker.getByRole('button', { name: 'Completed 100%' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    await expect(page.locator('.c100')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('with motion: the cover rises and the golden light sweeps across; Undo closes it', async ({ page }) => {
    await open(page, '');
    const title = await uncompletedSteamGame(page);
    await go(page, { name: 'game', id: await gameId(page, title) });
    await page.locator('.status-picker').getByRole('button', { name: 'Completed 100%' }).click();
    const moment = page.locator('.c100');
    await expect(moment).toBeVisible();
    await expect(moment.locator('.c100__sweep')).toBeAttached();
    await expect(moment.locator('.c100__motes span')).toHaveCount(14);
    await page.waitForTimeout(1800);
    await shot(page, 'ceremony-motion');
    // The status toast's Undo stays reachable above the moment, and undoing closes it.
    await page.locator('.toast').filter({ hasText: 'Completed 100%' }).getByRole('button', { name: 'Undo' }).click();
    await expect(moment).toBeHidden();
  });
});

test.describe('Wishlist: years waiting and the calendar peel', () => {
  async function openWishlist(page: Page, query: string) {
    const errors = await open(page, query);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Wishlist' }).click();
    await expect(page.getByRole('region', { name: 'Release calendar' })).toBeVisible({ timeout: 15_000 });
    return errors;
  }

  test('cards say how long each game has waited, sorted longest first from the stat chip', async ({ page }) => {
    const errors = await openWishlist(page, '?wishlist&reduced');
    const chip = page.getByRole('button', { name: /^Longest wait: Deep Field, on your list for 1 year 11 months/ });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('longest wait');
    await chip.click();
    await expect(page.getByRole('combobox', { name: 'Sort wishlist' })).toHaveValue('waiting');
    const cards = page.locator('.wish-card');
    await expect(cards.first().locator('.wish-card__title')).toHaveText('Deep Field');
    await expect(cards.first().locator('.wwait')).toHaveText(/On your list for 1 year 11 months/);
    await expect(cards.nth(1).locator('.wish-card__title')).toHaveText('Clockwork Pilgrim');
    await shot(page, 'wishlist-waiting');
    expect(await serious(page, '.wish__stats')).toEqual([]);
    expect(await serious(page, '.wish__list')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('hovering a release peels its cover up and shows how long it has been on your list', async ({ page }) => {
    await openWishlist(page, '?wishlist');
    const cover = page.locator('.wcal-game').first();
    await cover.hover();
    const peek = page.locator('.wpeek');
    await expect(peek).toBeVisible();
    await expect(peek.locator('.wpeek__wait')).toContainText(/On your list for|Added to your list today/);
    await page.waitForTimeout(300);
    const transform = await cover.evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe('none');
    await shot(page, 'calendar-peel');
    // Spoken label carries the same words for keyboard and screen reader users.
    await expect(cover).toHaveAttribute('aria-label', /on your list for|added to your list today/);
    await page.mouse.move(5, 5);
    await expect(peek).toHaveCount(0);
    // The agenda rows say it too.
    await expect(page.locator('.wcal-row .wwait').first()).toBeVisible();
  });

  test('reduced motion: no peel, the card still shows', async ({ page }) => {
    await openWishlist(page, '?wishlist&reduced');
    const cover = page.locator('.wcal-game').first();
    await cover.focus();
    await expect(page.locator('.wpeek')).toBeVisible();
    expect(await cover.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(await serious(page, '.wcal')).toEqual([]);
  });
});

test.describe('Open on start', () => {
  test('a chosen page opens first, even on the very first frame of the next start', async ({ page }) => {
    // Record whether Home was ever drawn.
    await page.addInitScript(() => {
      (window as unknown as { __sawHome: boolean }).__sawHome = false;
      new MutationObserver(() => {
        if (document.querySelector('.home')) (window as unknown as { __sawHome: boolean }).__sawHome = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const errors = await open(page, '?startPage=library&reduced');
    await expect(page.locator('.library')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('vystral.startPage'))).toBe('library');
    // The next start: the remembered choice decides the first frame.
    await page.reload();
    await expect(page.locator('.library')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sawHome: boolean }).__sawHome)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('Settings: pick a page, Immersive Mode, or back to the last page; the Controller switch agrees', async ({ page }) => {
    const errors = await open(page, '?reduced');
    await go(page, { name: 'settings', section: 'appearance' });
    const select = page.getByRole('combobox', { name: 'Open on start' });
    await expect(select).toHaveValue('last');
    await select.selectOption('journal');
    await expect.poll(() => setting(page, 'startup.page')).toBe('journal');
    expect(await page.evaluate(() => localStorage.getItem('vystral.startPage'))).toBe('journal');
    await shot(page, 'start-page');
    expect(await serious(page, '[data-row="start-page"]')).toEqual([]);

    await select.selectOption('immersive');
    await expect.poll(() => setting(page, 'startup.immersive')).toBe(true);
    expect(await setting(page, 'startup.page')).toBe('immersive');
    await go(page, { name: 'settings', section: 'controller' });
    const toggle = page.getByRole('switch', { name: 'Start in Immersive Mode' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect.poll(() => setting(page, 'startup.page')).toBe('last');
    expect(await setting(page, 'startup.immersive')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('Immersive Mode as the start page opens in Immersive Mode', async ({ page }) => {
    await open(page, '?startPage=immersive&reduced');
    await expect(page.locator('.imm').first()).toBeVisible();
  });
});
