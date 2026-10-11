/**
 * The product's public identity in the interface. Use `APP_NAME` wherever text is built in code
 * (template strings, toasts, aria labels); plain static copy may contain the literal.
 *
 * The app was called VYSTRAL before 1.0.0. Internal identifiers keep that name on purpose so existing
 * installs keep their data: localStorage / sessionStorage keys (`vystral.*`), the `vystral:` protocol,
 * the WebView2 virtual hosts (`app.vystral.example`, whose origin owns that storage) and the
 * `window.__vystral*` preview hooks. See docs/ARCHITECTURE.md › Legacy identifiers.
 */

/** The product name shown to people. Singular: "Arnav Games is…", "Arnav Games' cache". */
export const APP_NAME = 'Arnav Games';

/** The project's GitHub repository (Settings › About). */
export const REPOSITORY_URL = 'https://github.com/Arnav-Dugad/arnav-games';

/** The app icon (the mark on its tile) in `public/`; the bare mark is drawn inline by components/brand/BrandMark. */
export const BRAND_ICON = './arnav-games-icon.svg';

/** The wordmark as caps, for places that draw it as text (share cards). */
export const WORDMARK = { bold: 'ARNAV', light: 'GAMES' } as const;

/**
 * Draws the wordmark right-aligned at (right, y) on a canvas, the way the brand sets it: ARNAV heavier,
 * GAMES lighter, tracked +0.26em with a further 0.30em between the words (docs/BRAND.md › Wordmark). Uses the current
 * fill style and alpha and restores everything else.
 */
export function drawWordmark(ctx: CanvasRenderingContext2D, right: number, y: number, size: number, family: string, weights: [number, number] = [600, 360]) {
  ctx.save();
  ctx.textAlign = 'left';
  const track = size * 0.26;
  ctx.letterSpacing = `${track.toFixed(1)}px`;
  ctx.font = `${weights[1]} ${size}px ${family}`;
  // measureText includes the tracking after the last letter: drop it so the mark ends exactly at `right`.
  const lightW = ctx.measureText(WORDMARK.light).width - track;
  ctx.fillText(WORDMARK.light, right - lightW, y);
  ctx.font = `${weights[0]} ${size}px ${family}`;
  const boldW = ctx.measureText(WORDMARK.bold).width - track;
  ctx.fillText(WORDMARK.bold, right - lightW - size * (0.3 + 0.26) - boldW, y);
  ctx.restore();
}
