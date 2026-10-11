/**
 * Track E2b: a full, contrast-checked accent set from one or two seed colours (a game's cover, or the Windows
 * accent). Every token the interface paints with the accent is computed here for both the dark themes (Obsidian
 * and OLED) and Light, and each pairing is checked against WCAG 2.2 AA:
 *
 * | Token | Dark | Light | Check |
 * |---|---|---|---|
 * | `accent` | fills, icons, bars | fills (buttons) | text-on-accent ≥ 4.5:1 on it; on dark, ≥ 4.5:1 against every panel |
 * | `strong` | hover and pressed fills | hover and pressed fills | text-on-accent ≥ 4.5:1 on it |
 * | `weak` | tinted washes (14 %) | tinted washes | body text ≥ 4.5:1 on the wash over every panel |
 * | `text` | accent-coloured text | accent-coloured text | ≥ 4.5:1 against every panel |
 * | `ring` | focus outline | focus outline | ≥ 3:1 against the window and panels (non-text, 1.4.11) |
 * | `onAccent` | text on accent fills | text on accent fills | (see accent, strong) |
 * | `accent2` | second gradient stop | second gradient stop | ≥ 3:1 against the window (decorative, kept legible) |
 *
 * High contrast never uses any of this: its tokens always win (tokens.css).
 */
import { contrastRatio, cssOklch, gamutMap, lchToRgb, parseOklch, type LCh, type RGB } from './color';

export type ThemeKind = 'dark' | 'light';

export interface AccentTokens {
  accent: string;
  accent2: string;
  strong: string;
  weak: string;
  text: string;
  ring: string;
  onAccent: string;
}

export interface AccentChecks {
  /** text-on-accent on the accent fill and on the strong fill (the lower of the two). */
  onAccent: number;
  /** Accent-coloured text against the worst panel. */
  text: number;
  /** Focus ring against the worst surface. */
  ring: number;
  /** Body text on the weak wash, over the worst panel. */
  weak: number;
  /** Accent (as an icon/bar colour) against the worst panel; only dark themes use the fill as text. */
  accent: number;
}

export interface AccentSet {
  dark: AccentTokens;
  light: AccentTokens;
  checks: Record<ThemeKind, AccentChecks>;
}

/** WCAG 2.2 AA thresholds the set is built to. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;
/** A small margin so rounding in the CSS strings can never drop a pair below the threshold. */
const MARGIN = 0.06;
export const WEAK_ALPHA = 0.14;

/** Surfaces every token is checked against: the tokens.css values (OLED's black panels are covered by the darkest). */
export const SURFACES: Record<ThemeKind, RGB[]> = {
  dark: ([[0, 0, 0], [0.13, 0.012, 282], [0.165, 0.014, 282], [0.2, 0.016, 282], [0.245, 0.018, 282]] as LCh[]).map(lchToRgb),
  light: ([[0.93, 0.008, 282], [0.965, 0.006, 282], [0.99, 0.003, 282], [1, 0, 0]] as LCh[]).map(lchToRgb),
};
/** Body text in each theme (--text-1). */
export const BODY_TEXT: Record<ThemeKind, RGB> = { dark: lchToRgb([0.97, 0.004, 282]), light: lchToRgb([0.2, 0.018, 282]) };
/** The two inks a fill can carry: the near-black --text-on-accent, or white. */
export const INK_DARK: LCh = [0.16, 0.02, 282];
export const INK_LIGHT: LCh = [1, 0, 0];

const rgb = (lch: LCh) => lchToRgb(gamutMap(lch));
const worst = (c: RGB, surfaces: RGB[]) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
/** Alpha-composites `fg` over `bg` in sRGB, as the browser does for `oklch(… / a)` washes. */
export const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB;

/**
 * Moves lightness (keeping hue, chroma gamut-mapped) in `step` direction until `ok` holds, at most to `limit`.
 * Returns the last colour tried, so callers re-check.
 */
function walk(lch: LCh, step: number, limit: number, ok: (c: LCh) => boolean): LCh {
  let c = gamutMap(lch);
  for (let i = 0; i < 100 && !ok(c); i++) {
    const L = step > 0 ? Math.min(limit, c[0] + step) : Math.max(limit, c[0] + step);
    c = gamutMap([L, lch[1], lch[2]]);
    if (L === limit) break;
  }
  return c;
}

/** Keeps a seed in the band the design is built for: chroma capped so it never shouts; achromatic seeds get a hint of hue. */
export function tameSeed([L, C, h]: LCh): LCh {
  return [Math.min(0.95, Math.max(0.05, L)), Math.min(0.19, Math.max(0.02, C)), Number.isFinite(h) ? h : 292];
}

function buildTheme(seed: LCh, seed2: LCh, theme: ThemeKind): { tokens: AccentTokens; checks: AccentChecks } {
  const surfaces = SURFACES[theme];
  const ink = rgb(INK_DARK);
  const inkOk = (c: LCh, minus = 0) =>
    contrastRatio(ink, rgb(c)) >= AA_TEXT + MARGIN && contrastRatio(ink, rgb([c[0] + minus, c[1], c[2]])) >= AA_TEXT + MARGIN;

  let accent: LCh;
  let strong: LCh;
  let text: LCh;
  let ring: LCh;
  if (theme === 'dark') {
    // Fill and icon colour: light enough for dark ink on it and to read against every dark panel.
    accent = walk([Math.min(0.88, Math.max(0.7, seed[0])), seed[1], seed[2]], 0.01, 0.95, (c) => inkOk(c) && worst(rgb(c), surfaces) >= AA_TEXT + MARGIN);
    strong = walk([Math.min(0.95, accent[0] + 0.08), accent[1], accent[2]], 0.01, 0.97, (c) => inkOk(c));
    text = walk([Math.max(accent[0], 0.78), Math.min(accent[1], 0.14), accent[2]], 0.01, 0.97, (c) => worst(rgb(c), surfaces) >= AA_TEXT + MARGIN);
    ring = walk(strong, 0.01, 0.97, (c) => worst(rgb(c), surfaces) >= AA_NON_TEXT + MARGIN);
  } else {
    // Light: the fill stays light (dark ink on it, like every primary button), and the hover fill is 0.08 darker;
    // text and the focus ring are deep versions of the same hue so they read on white.
    accent = walk([Math.min(0.86, Math.max(0.72, seed[0])), seed[1], seed[2]], 0.01, 0.95, (c) => inkOk(c, -0.08));
    strong = gamutMap([accent[0] - 0.08, accent[1], accent[2]]);
    text = walk([Math.min(0.48, seed[0]), Math.min(0.16, seed[1]), seed[2]], -0.01, 0.1, (c) => worst(rgb(c), surfaces) >= AA_TEXT + MARGIN);
    ring = walk([Math.min(0.55, seed[0]), seed[1], seed[2]], -0.01, 0.1, (c) => worst(rgb(c), surfaces) >= AA_NON_TEXT + MARGIN);
  }

  // Second gradient stop: the second seed in the same lightness band, kept legible against the window.
  const accent2 =
    theme === 'dark'
      ? walk([Math.min(0.86, Math.max(0.62, seed2[0])), Math.min(0.17, seed2[1]), seed2[2]], 0.01, 0.95, (c) => worst(rgb(c), surfaces) >= AA_NON_TEXT + MARGIN)
      : walk([Math.min(0.86, Math.max(0.66, seed2[0])), Math.min(0.17, seed2[1]), seed2[2]], 0.01, 0.95, (c) => contrastRatio(ink, rgb(c)) >= AA_TEXT + MARGIN);

  // Ink: dark wherever it reads (it nearly always does after the walks above), otherwise white.
  const darkInk = Math.min(contrastRatio(ink, rgb(accent)), contrastRatio(ink, rgb(strong)));
  const whiteInk = Math.min(contrastRatio(rgb(INK_LIGHT), rgb(accent)), contrastRatio(rgb(INK_LIGHT), rgb(strong)));
  const onAccent = darkInk >= whiteInk ? INK_DARK : INK_LIGHT;

  const weakRgb = rgb(accent);
  const weakCheck = Math.min(...surfaces.map((s) => contrastRatio(BODY_TEXT[theme], over(weakRgb, WEAK_ALPHA, s))));

  return {
    tokens: {
      accent: cssOklch(accent),
      accent2: cssOklch(accent2),
      strong: cssOklch(strong),
      weak: cssOklch(accent, WEAK_ALPHA),
      text: cssOklch(text),
      ring: cssOklch(ring),
      onAccent: cssOklch(onAccent),
    },
    checks: {
      onAccent: Math.max(darkInk, whiteInk),
      text: worst(rgb(text), surfaces),
      ring: worst(rgb(ring), surfaces),
      weak: weakCheck,
      accent: worst(rgb(accent), surfaces),
    },
  };
}

/** Builds the full accent set for both themes from a main seed and an optional second one. */
export function buildAccentSet(seed: LCh, second?: LCh | null): AccentSet {
  const s1 = tameSeed(seed);
  const s2 = tameSeed(second ?? [s1[0], s1[1] * 0.85, (s1[2] + 330) % 360]);
  const dark = buildTheme(s1, s2, 'dark');
  const light = buildTheme(s1, s2, 'light');
  return { dark: dark.tokens, light: light.tokens, checks: { dark: dark.checks, light: light.checks } };
}

/** Same, from CSS strings written by `cssOklch` (palette accents). Null when the main seed isn't readable. */
export function accentSetFromCss(accent: string | null | undefined, accent2?: string | null): AccentSet | null {
  const a = parseOklch(accent);
  if (!a) return null;
  return buildAccentSet(a, parseOklch(accent2));
}

/** Whether every pairing in a theme meets AA (used by tests and shown in Settings). */
export function passesAA(c: AccentChecks): boolean {
  return c.onAccent >= AA_TEXT && c.text >= AA_TEXT && c.weak >= AA_TEXT && c.ring >= AA_NON_TEXT;
}

/** The CSS custom properties an accent set is applied with (read by tokens.css under `data-accent-set`). */
export function accentSetVars(set: AccentSet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const theme of ['dark', 'light'] as const) {
    const p = theme === 'dark' ? '--as' : '--asl';
    const t = set[theme];
    out[`${p}-accent`] = t.accent;
    out[`${p}-accent-2`] = t.accent2;
    out[`${p}-strong`] = t.strong;
    out[`${p}-weak`] = t.weak;
    out[`${p}-text`] = t.text;
    out[`${p}-ring`] = t.ring;
    out[`${p}-on`] = t.onAccent;
  }
  return out;
}
