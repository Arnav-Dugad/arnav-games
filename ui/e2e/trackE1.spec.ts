import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Track E1: Assistant upgrades against the preview backend's FAKE provider (no AI is contacted, no microphone is used;
// voice input is simulated; fictional data only). Switches: ?aiCloud (Claude ready), ?voice, ?voiceMicBlocked, ?memories,
// ?recapNotify, ?summaries, ?dupes, ?lagNote.

async function open(page: Page, query = '?aiCloud&reduced') {
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

const nav = (page: Page, name: RegExp | string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click();
const composer = (page: Page) => page.getByLabel('Message the Assistant');

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

async function noSeriousViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).exclude('.living-canvas');
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

async function openSettingsAi(page: Page) {
  await nav(page, 'Settings');
  await page.getByRole('button', { name: /^AI\b/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Memory, voice and recaps' })).toBeVisible();
}

test.describe('Track E1: Assistant memory', () => {
  test('“remember that…” proposes a memory you confirm; it is listed, editable, disclosed when sent, and erasable', async ({ page }) => {
    const { errors, external } = await open(page);
    await nav(page, /Assistant/);
    await ask(page, 'remember that I like short games on weekdays');
    const card = page.getByRole('region', { name: 'Suggested: Remember: “I like short games on weekdays”' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Remember', exact: true }).click();
    await expect(card.getByRole('status')).toContainText('Done');
    await expect(page.getByText('Remembered', { exact: true })).toBeVisible();

    // The next answer says the memory went to the cloud AI with the message.
    await page.getByRole('button', { name: 'New chat' }).click();
    await ask(page, 'hello there');
    await expect(page.getByRole('button', { name: /1 memory sent/ })).toBeVisible();
    await page.getByRole('button', { name: 'What was sent' }).click();
    await expect(page.getByText(/the one thing you asked the Assistant to remember/)).toBeVisible();

    // The manager: list, edit, delete.
    await page.getByRole('button', { name: 'What the Assistant remembers' }).click();
    const dialog = page.getByRole('dialog', { name: 'What the Assistant remembers' });
    await expect(dialog.getByText('I like short games on weekdays')).toBeVisible();
    await noSeriousViolations(page, '.dialog');
    await dialog.getByRole('button', { name: 'Edit “I like short games on weekdays”' }).click();
    await dialog.getByLabel('Edit memory').fill('Prefers short games on weekdays');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Prefers short games on weekdays')).toBeVisible();
    await dialog.getByLabel('Something for the Assistant to remember').fill('My Steam password is hunter2');
    await dialog.getByRole('button', { name: 'Remember', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('password or a key');
    await dialog.getByLabel('Something for the Assistant to remember').fill('Plays with a controller');
    await dialog.getByRole('button', { name: 'Remember', exact: true }).click();
    await expect(dialog.getByText('Plays with a controller')).toBeVisible();
    await expect(dialog.getByText('2 of 40')).toBeVisible();
    await dialog.getByRole('button', { name: 'Forget “Plays with a controller”' }).click();
    await expect(dialog.getByText('Plays with a controller')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done' }).click();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('with memory off nothing is used or sent, and Settings can forget everything', async ({ page }) => {
    await open(page, '?aiCloud&memories&reduced');
    await openSettingsAi(page);
    await expect(page.getByRole('button', { name: 'View and edit 3 memories' })).toBeVisible();
    await page.getByRole('switch', { name: 'Assistant memory' }).click();
    await nav(page, /Assistant/);
    await ask(page, 'hello there');
    await expect(page.getByRole('button', { name: 'Copy answer' })).toBeVisible();
    await expect(page.getByRole('button', { name: /memories sent/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'What was sent' }).click();
    await expect(page.getByText(/asked the Assistant to remember/)).toHaveCount(0);

    await openSettingsAi(page);
    const forget = page.getByRole('button', { name: 'Forget everything' });
    await forget.hover();
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
    await expect(page.getByText('Memories deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View memories' })).toBeVisible();
  });
});

test.describe('Track E1: push-to-talk voice input (simulated)', () => {
  test('off by default: no microphone button', async ({ page }) => {
    await open(page);
    await nav(page, /Assistant/);
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hold to talk' })).toHaveCount(0);
  });

  test('hold the button or Ctrl+Space: live words and a level meter, added to the message on release, never sent by itself', async ({ page }) => {
    const { errors } = await open(page, '?aiCloud&voice&reduced');
    await nav(page, /Assistant/);
    const mic = page.getByRole('button', { name: 'Hold to talk' });
    await expect(mic).toBeVisible();
    await mic.hover();
    await page.mouse.down();
    const listening = page.getByRole('status', { name: 'Listening' });
    await expect(listening).toBeVisible();
    await expect(listening).toContainText('On this PC · audio isn’t saved or sent');
    await expect(listening).toContainText('What should I play');
    await expect(page.locator('.asx-voice__meter span').first()).toBeAttached();
    await noSeriousViolations(page, '.asx-composer-wrap');
    await page.mouse.up();
    await expect(listening).toHaveCount(0);
    await expect(composer(page)).toHaveValue(/^What should I play/);
    await expect(page.locator('.asx-msg--user')).toHaveCount(0); // nothing was sent

    // Ctrl+Space in the message box; Escape cancels and keeps the draft as it was.
    await composer(page).fill('Hey,');
    await composer(page).focus();
    await page.keyboard.down('Control');
    await page.keyboard.down('Space');
    await expect(listening).toBeVisible();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.keyboard.up('Space');
    await page.keyboard.up('Control');
    await expect(listening).toHaveCount(0);
    await expect(composer(page)).toHaveValue('Hey,');

    await page.keyboard.down('Control');
    await page.keyboard.down('Space');
    await expect(listening).toContainText('What should');
    await page.keyboard.up('Space');
    await page.keyboard.up('Control');
    await expect(composer(page)).toHaveValue(/^Hey, What should/);
    expect(errors).toEqual([]);
  });

  test('when Windows blocks the microphone, the button explains why and how to fix it', async ({ page }) => {
    await open(page, '?aiCloud&voiceMicBlocked&reduced');
    await nav(page, /Assistant/);
    await page.getByRole('button', { name: 'Voice input isn’t available' }).click();
    const note = page.getByRole('note').filter({ hasText: 'Let desktop apps access your microphone' });
    await expect(note).toBeVisible();
    await expect(note.getByRole('button', { name: 'Open microphone settings' })).toBeVisible();
    await openSettingsAi(page);
    await expect(page.getByText(/Windows is blocking microphone access/)).toBeVisible();
  });
});

test.describe('Track E1: weekly recap', () => {
  test('the notification setting is opt-in with day and time, and the recap opens in the Assistant', async ({ page }) => {
    await open(page);
    await openSettingsAi(page);
    const day = page.getByLabel('Recap day');
    await expect(day).toBeDisabled();
    await page.getByRole('switch', { name: 'Weekly recap notification' }).click();
    await expect(day).toBeEnabled();
    await day.selectOption('monday');
    await page.getByLabel('Recap time').selectOption('9');
    await noSeriousViolations(page, '#assistant-extras');
    await page.getByRole('button', { name: 'See this week’s recap' }).click();
    const recap = page.getByRole('region', { name: /Your week in games/ });
    await expect(recap).toBeVisible();
    await expect(recap.getByText('Most played')).toBeVisible();
    await noSeriousViolations(page, '.asx-recap');
    await recap.getByRole('button', { name: 'Close the recap' }).click();
    await expect(recap).toHaveCount(0);
  });

  test('a due recap shows its summary and opens the full recap', async ({ page }) => {
    await open(page, '?aiCloud&recapNotify&reduced');
    await expect(page.getByText('Your week in games')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Open recap' }).click();
    const recap = page.getByRole('region', { name: /Your week in games/ });
    await expect(recap).toBeVisible();
    await recap.getByRole('button', { name: 'Talk about it' }).click();
    await expect(page.locator('.asx-msg--user').first()).toContainText('weekly recap');
  });
});

test.describe('Track E1: AI game summaries', () => {
  async function openGame(page: Page, title: string) {
    await nav(page, /Library/);
    await page.getByLabel('Filter library').fill(title);
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeAttached();
  }

  test('off by default: a one-off button writes a labelled summary from known facts; never an official description', async ({ page }) => {
    await open(page, '?aiCloud&summaries&reduced');
    await openGame(page, 'Quiet Harbor');
    await expect(page.getByText('No description available.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Write a 2-line summary with AI' }).click();
    const box = page.locator('.ai-summary');
    await expect(box.getByText('AI summary from Preview data, IGDB, Steam community tags')).toBeVisible();
    await expect(box.getByText(/Not an official description/)).toBeVisible();
    await expect(box.getByText(/Worded by Claude/)).toBeVisible();
    await box.getByRole('button', { name: 'What was sent' }).click();
    await expect(box.getByText(/Sent to Anthropic/)).toBeVisible();
    await box.getByRole('button', { name: 'Regenerate' }).click();
    await expect(box.getByText('AI summary from', { exact: false })).toBeVisible();
    await noSeriousViolations(page, '.ai-summary');
  });

  test('with the switch on it appears by itself; games with a description and no-AI setups are unchanged', async ({ page }) => {
    await open(page, '?summaries&reduced');
    await openGame(page, 'Paper Kingdoms');
    await expect(page.getByText('No description available.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Write a 2-line summary with AI' })).toHaveCount(0);

    await open(page, '?aiCloud&summaries&reduced');
    await nav(page, 'Settings');
    await page.getByRole('button', { name: /^AI\b/ }).first().click();
    await page.getByRole('switch', { name: 'Game summaries' }).click();
    await openGame(page, 'Paper Kingdoms');
    await expect(page.locator('.ai-summary').getByText('AI summary from', { exact: false })).toBeVisible();
    await openGame(page, 'Nebula Drift');
    await expect(page.locator('.ai-summary')).toHaveCount(0);
  });
});

test.describe('Track E1: smart duplicate cleanup', () => {
  test('review each merge with its reasons, approve or skip, undo, and approve all after a review', async ({ page }) => {
    const { errors } = await open(page, '?aiCloud&dupes&reduced');
    await nav(page, /Assistant/);
    await page.getByRole('button', { name: /possible duplicates in your library/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Clean up duplicates' });
    const items = dialog.getByRole('list', { name: 'Merge proposals' }).getByRole('listitem').filter({ has: page.locator('h3') });
    await expect(items).toHaveCount(4);
    await expect(items.first().getByText('Very likely the same')).toBeVisible();
    await expect(items.first().getByText('The titles are identical.')).toBeVisible();
    await noSeriousViolations(page, '.dialog');

    await items.first().getByRole('button', { name: 'Approve merge' }).click();
    await expect(items.first().getByText('Merged')).toBeVisible();
    await items.first().getByRole('button', { name: 'Undo' }).click();
    await expect(items.first().getByText('Kept apart')).toBeVisible();
    await expect(page.getByText('Separated again')).toBeVisible();

    await items.nth(1).getByRole('button', { name: 'Skip' }).click();
    await expect(items.nth(1).getByText('Skipped')).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve all…' }).click();
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    await dialog.getByRole('checkbox').last().uncheck();
    await dialog.getByRole('button', { name: 'Merge 1' }).click();
    await expect(page.getByText('1 duplicate merged')).toBeVisible();
    await expect(dialog.getByText('Merged')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Done' }).click();
    expect(errors).toEqual([]);
  });

  test('the Assistant proposes the cleanup from a chat', async ({ page }) => {
    await open(page, '?aiCloud&dupes&reduced');
    await nav(page, /Assistant/);
    await ask(page, 'clean up my duplicates please');
    const card = page.getByRole('region', { name: /Suggested: Review 4 possible duplicates/ });
    await card.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('dialog', { name: 'Clean up duplicates' })).toBeVisible();
  });
});

test.describe('Track E1: lag notes', () => {
  test('a rough session says why it likely lagged, labelled, on Performance and the game page', async ({ page }) => {
    const { errors } = await open(page, '?lagNote&reduced');
    await nav(page, /Performance/);
    await page.getByRole('tab', { name: /Sessions/ }).click();
    const detail = page.locator('.pf-hero');
    await expect(detail.getByText('Why it lagged:')).toBeVisible();
    await expect(detail.getByText(/Likely the processor: it averaged 91% busy/)).toBeVisible();
    await expect(detail.getByText(/From VYSTRAL’s frame-time analysis\. Nothing was changed\./)).toBeVisible();
    await expect(page.locator('.pf-item .lag-note').first()).toBeVisible();
    await noSeriousViolations(page, '.pf-layout');
    await detail.getByRole('button', { name: 'Open game' }).click();
    await page.getByRole('tab', { name: /^Sessions/ }).click();
    await expect(page.locator('.session-row .lag-note').first()).toContainText('Why it lagged:');
    expect(errors).toEqual([]);
  });
});

test.describe('Track E1: the thinking orb and learned suggestions', () => {
  test('the orb follows the answer (thinking, looking up, writing) and rests when done; reduced motion keeps it still', async ({ page }) => {
    await open(page, '?aiCloud&assistantSlow');
    await nav(page, /Assistant/);
    const orb = page.locator('.asx-page__head .asx-orb');
    await expect(orb).toHaveAttribute('data-phase', 'idle');
    await expect(orb).toHaveAccessibleName('Assistant: Ready');
    await ask(page, 'What should I play tonight? I have 1 hour');
    await expect(orb).toHaveAttribute('data-phase', /thinking|tool/);
    await expect(orb).toHaveAttribute('data-phase', 'waiting', { timeout: 15_000 }); // the approval card
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(orb).toHaveAttribute('data-phase', 'streaming', { timeout: 15_000 });
    await expect(orb).toHaveAttribute('data-phase', 'idle', { timeout: 30_000 });
    await expect(orb).not.toHaveAttribute('data-still', /.*/);

    await open(page, '?aiCloud&reduced');
    await nav(page, /Assistant/);
    await expect(page.locator('.asx-page__head .asx-orb')).toHaveAttribute('data-still', 'true');
  });

  test('High contrast draws a plain outlined orb; forced colours use system colours', async ({ page }) => {
    await open(page, '?aiCloud&reduced');
    await nav(page, 'Settings');
    await page.getByRole('button', { name: /^Appearance/ }).first().click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'contrast'));
    await nav(page, /Assistant/);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'contrast'));
    const orb = page.locator('.asx-page__head .asx-orb');
    await expect(orb.locator('.asx-orb__aura')).toBeHidden();
    expect(await orb.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(orb.locator('.asx-orb__swirl')).toBeHidden();
  });

  test('questions you ask twice become suggestions on that page, and can be forgotten', async ({ page }) => {
    await open(page);
    await nav(page, 'Journal');
    await page.keyboard.press('Control+j');
    const panel = page.getByRole('dialog', { name: 'Assistant' });
    const input = panel.getByLabel('Message the Assistant');
    for (let i = 0; i < 2; i++) {
      await input.fill('Show my longest sessions this year');
      await input.press('Enter');
      await expect(panel.getByRole('button', { name: 'Copy answer' }).nth(i)).toBeVisible();
    }
    await panel.getByRole('button', { name: 'New chat' }).click();
    const learned = panel.getByRole('button', { name: /Show my longest sessions this year \(you often ask this\)/ });
    await expect(learned).toBeVisible();
    await panel.getByRole('button', { name: 'Close the Assistant' }).click();

    await openSettingsAi(page);
    await page.getByRole('button', { name: 'Forget learned suggestions' }).click();
    await expect(page.getByText('Learned suggestions forgotten')).toBeVisible();
    await nav(page, 'Journal');
    await page.keyboard.press('Control+j');
    await expect(panel.getByRole('button', { name: 'What did I play most this month?' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /you often ask this/ })).toHaveCount(0);
  });
});
