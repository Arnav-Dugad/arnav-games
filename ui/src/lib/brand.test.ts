import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_NAME, BRAND_ICON, REPOSITORY_URL, WORDMARK, drawWordmark } from './brand';
import { PREVIEW_KEY } from './firstPaint';

const ui = resolve(__dirname, '../..');

describe('brand', () => {
  it('is Arnav Games', () => {
    expect(APP_NAME).toBe('Arnav Games');
    expect(REPOSITORY_URL).toBe('https://github.com/Arnav-Dugad/arnav-games');
    expect(`${WORDMARK.bold} ${WORDMARK.light}`).toBe(APP_NAME.toUpperCase());
  });

  it('ships the icon, the favicon and the page title', () => {
    const html = readFileSync(resolve(ui, 'index.html'), 'utf8');
    expect(html).toContain('<title>Arnav Games</title>');
    const favicon = /rel="icon"[^>]*href="\.\/([^"]+)"/.exec(html)?.[1];
    expect(favicon).toBe('arnav-games-favicon.svg');
    for (const file of [favicon!, BRAND_ICON.replace('./', '')]) expect(readFileSync(resolve(ui, 'public', file), 'utf8')).toContain('<svg');
  });

  it('keeps the pre-rename storage keys, so nothing saved in the interface is lost', () => {
    // The page origin (app.vystral.example) and every vystral.* key stay as they were before 1.0.0.
    expect(PREVIEW_KEY).toBe('vystral.preview.firstPaint');
    const intro = readFileSync(resolve(ui, 'src/components/shell/Intro.tsx'), 'utf8');
    expect(intro).toContain("'vystral.introPref'");
    expect(intro).toContain("'vystral.introPlayed'");
  });

  it('draws the wordmark right-aligned with the brand spacing', () => {
    const calls: { text: string; x: number; font: string }[] = [];
    let font = '';
    let spacing = '0px';
    const ctx = {
      save() {},
      restore() {},
      set font(f: string) { font = f; },
      get font() { return font; },
      set letterSpacing(v: string) { spacing = v; },
      set textAlign(_v: string) {},
      // 0.6em per letter plus the tracking after every letter, like a canvas does.
      measureText: (t: string) => ({ width: t.length * (20 * 0.6 + parseFloat(spacing)) }),
      fillText: (text: string, x: number) => calls.push({ text, x, font }),
    } as unknown as CanvasRenderingContext2D;

    drawWordmark(ctx, 1000, 50, 20, 'Geist');
    const [games, arnav] = calls;
    expect(games.text).toBe('GAMES');
    expect(games.font).toBe('360 20px Geist');
    expect(arnav.text).toBe('ARNAV');
    expect(arnav.font).toBe('600 20px Geist');
    const letter = 20 * 0.6;
    // GAMES ends exactly at the right edge (no tracking after its last letter)...
    expect(games.x + 5 * letter + 4 * 20 * 0.26).toBeCloseTo(1000);
    // ...and the gap between the words is the tracking plus 0.30em.
    const arnavEnd = arnav.x + 5 * letter + 4 * 20 * 0.26;
    expect(games.x - arnavEnd).toBeCloseTo(20 * 0.56);
  });
});
