import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Track E3: performance insights (preview data only). ?perfTrends adds a laptop history for Redline Rivals — a GPU about
// 7 °C hotter this month, a driver change (572.16 → 576.02), sessions on battery and a 60 fps goal; ?perfNote announces a
// driver note shortly after start, as the app does when the session that caused it ends.

async function open(page: Page, query = '?perfTrends&reduced') {
  await page.addInitScript(() => sessionStorage.setItem('vystral.introPlayed', '1'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await expect(page.locator('.shell, .imm, .onb').first()).toBeVisible();
  return { errors };
}

async function nav(page: Page, name: RegExp | string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click();
}

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
}

async function noSeriousViolations(page: Page, include?: string) {
  await settle(page);
  let builder = new AxeBuilder({ page }).exclude('.living-canvas');
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

const card = (page: Page, heading: RegExp | string) => page.locator('section.e3-card', { has: page.getByRole('heading', { name: heading }) });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Performance sections' });

test.describe('Performance › Trends', () => {
  test('the Overview flags a game running hotter; Trends explains it with medians, safe tips and a table', async ({ page }) => {
    const { errors } = await open(page);
    await nav(page, /Performance/);
    const banner = page.locator('.e3-banner');
    await expect(banner).toContainText('Your GPU runs 7 °C hotter in Redline Rivals');
    await banner.getByRole('button', { name: 'See why' }).click();
    await expect(tabs(page).getByRole('tab', { name: 'Trends' })).toHaveAttribute('aria-selected', 'true');

    const thermal = card(page, /GPU temperature over time/);
    await expect(thermal).toContainText('Your GPU runs 7 °C hotter in Redline Rivals than in the months before.');
    await expect(thermal.locator('.e3-figure').filter({ hasText: 'Last 30 days' })).toContainText('74 °C');
    await expect(thermal.locator('.e3-figure').filter({ hasText: 'The months before' })).toContainText('67 °C');
    await expect(thermal).toContainText('Clean the vents and fans');
    await expect(thermal).toContainText('laptop stand');
    await expect(thermal).toContainText('Arnav Games never changes fan speeds, clocks or power limits.');
    await expect(thermal).toContainText('can’t measure the room’s temperature');
    await expect(thermal).toContainText('Left out: 4 sessions on battery.');

    // The dot chart reads by keyboard; its table lists the same sessions.
    const chart = thermal.getByRole('group', { name: /Average GPU temperature per session in Redline Rivals: typically 74 °C/ });
    await chart.focus();
    await page.keyboard.press('Home');
    await expect(chart.locator('.e3-tip')).toContainText('average GPU temperature');
    await thermal.getByRole('button', { name: 'Show as table' }).click();
    await expect(thermal.getByRole('region', { name: 'GPU temperature per session, as a table' }).locator('tbody tr')).toHaveCount(15);

    await noSeriousViolations(page, '.pf');
    expect(errors).toEqual([]);
  });

  test('a frame-rate goal per game: the share of frames that met it, per session, changed and cleared', async ({ page }) => {
    await open(page);
    await nav(page, /Performance/);
    await tabs(page).getByRole('tab', { name: 'Trends' }).click();
    const goals = card(page, /Frame-rate goals/);
    const row = goals.getByRole('listitem').filter({ hasText: 'Redline Rivals' });
    await expect(row).toContainText('60 fps');
    await expect(row).toContainText(/about \d+% latest/);
    await row.getByRole('button', { name: 'Open the Redline Rivals goal' }).click();

    // The page's game filter now shows Redline Rivals; its goal card has the picker, figures and a column per session.
    await expect(page.getByRole('combobox').filter({ hasText: /Redline Rivals/ }).first()).toBeVisible();
    const goal = card(page, /Frame-rate goal · Redline Rivals/);
    const picker = goal.getByRole('radiogroup', { name: 'Frame-rate goal for Redline Rivals' });
    await expect(picker.getByRole('radio', { name: '60' })).toHaveAttribute('aria-checked', 'true');
    await expect(goal.locator('.e3-figure').filter({ hasText: 'Latest session' })).toContainText(/about \d+%/);
    await expect(goal).toContainText('That falls inside the 14–17 ms bucket, so the share is estimated');
    const chart = goal.getByRole('group', { name: /Share of frames that met the 60 fps goal in each of the last 19 Redline Rivals sessions/ });
    await expect(chart).toBeVisible();
    await chart.focus();
    await page.keyboard.press('End');
    await expect(chart.locator('.e3-tip')).toContainText('of frames at 60 fps or better');

    // 50 fps falls on a bucket edge (20 ms): exact shares.
    await picker.getByRole('radio', { name: 'Other' }).click();
    await goal.getByRole('spinbutton', { name: 'Target frame rate' }).fill('50');
    await goal.getByRole('button', { name: 'Set goal' }).click();
    await expect(page.getByText('Goal set: 50 fps')).toBeVisible();
    await expect(goal).toContainText('The limit falls on a bucket edge, so these shares are exact.');
    await goal.getByRole('button', { name: 'Show as table' }).click();
    const table = goal.getByRole('region', { name: 'Frame-rate goal per session, as a table' });
    await expect(table.locator('tbody tr')).toHaveCount(19);
    await expect(table.locator('tbody tr').first()).toContainText('50 fps');

    // Out of range is refused before it's sent.
    await picker.getByRole('radio', { name: 'Other' }).click();
    await goal.getByRole('spinbutton', { name: 'Target frame rate' }).fill('500');
    await expect(goal.getByRole('button', { name: 'Set goal' })).toBeDisabled();

    await picker.getByRole('radio', { name: 'Off' }).click();
    await expect(page.getByText('Goal removed')).toBeVisible();
    await expect(goal).toContainText('Pick a target to see how often each Redline Rivals session kept up');
    await noSeriousViolations(page, '.pf');
  });

  test('on a laptop, battery against plugged in per game; hidden on a PC without a battery', async ({ page }) => {
    await open(page);
    await nav(page, /Performance/);
    await tabs(page).getByRole('tab', { name: 'Trends' }).click();
    const battery = card(page, /On battery and plugged in/);
    await expect(battery).toContainText('On battery, Redline Rivals runs at 47 fps against 71 fps plugged in (35% slower).');
    await expect(battery.getByRole('table', { name: 'Redline Rivals: medians on battery and plugged in' })).toBeVisible();
    await expect(battery).toContainText('battery saver was on for 1 of 4 sessions');
    await noSeriousViolations(page, '.e3-trends');

    await open(page, '?reduced');
    await nav(page, /Performance/);
    await tabs(page).getByRole('tab', { name: 'Trends' }).click();
    await expect(card(page, /GPU temperature over time/)).toBeVisible();
    await expect(card(page, /On battery and plugged in/)).toHaveCount(0);
  });
});

test.describe('driver notes', () => {
  test('System lists the note; the session it points to shows it, with its goal result', async ({ page }) => {
    await open(page);
    await nav(page, /Performance/);
    await tabs(page).getByRole('tab', { name: 'System' }).click();
    const notes = card(page, /Driver update notes/);
    const item = notes.getByRole('listitem').first();
    await expect(item).toContainText('Driver 576.02: Redline Rivals +2 fps average, 1% lows −3 fps');
    await expect(item).toContainText('against the median of the last 5 on 572.16');
    await expect(item).toContainText('within normal variation');
    await noSeriousViolations(page, '.pf');

    await item.getByRole('button', { name: /Open the Redline Rivals session/ }).click();
    await expect(tabs(page).getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
    const strip = page.getByRole('group', { name: 'Insights for this session' });
    await expect(strip).toContainText('First session on driver 576.02: +2 fps average, 1% lows −3 fps');
    await expect(strip).toContainText(/Met 60 fps for about \d+% of frames/);
    await expect(strip).toContainText('This game runs 7 °C hotter this month');
    await strip.getByRole('button', { name: 'See why' }).click();
    await expect(tabs(page).getByRole('tab', { name: 'Trends' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a note announced after a session becomes a toast that opens the session', async ({ page }) => {
    await open(page, '?perfTrends&perfNote&reduced');
    const toast = page.locator('.toast').filter({ hasText: 'Driver 576.02: Redline Rivals +2 fps average, 1% lows −3 fps' });
    await expect(toast).toBeVisible({ timeout: 8000 });
    await toast.getByRole('button', { name: 'View session' }).click();
    await expect(tabs(page).getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('group', { name: 'Insights for this session' })).toContainText('First session on driver 576.02');
  });
});

test('a game page shows its goal, thermal trend and battery comparison on the Sessions tab', async ({ page }) => {
  await open(page);
  await nav(page, /Library/);
  await page.getByRole('button', { name: /Redline Rivals/ }).first().click();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  const goal = card(page, /Frame-rate goal/);
  await expect(goal.getByRole('radiogroup', { name: 'Frame-rate goal for Redline Rivals' })).toBeVisible();
  await expect(card(page, /GPU temperature over time/)).toContainText('7 °C hotter');
  await expect(card(page, /On battery and plugged in/)).toBeVisible();
  await noSeriousViolations(page, '.e3-game-insights');
});
