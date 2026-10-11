import { describe, expect, it } from 'vitest';
import { AA_NON_TEXT, AA_TEXT, accentSetFromCss, accentSetVars, BODY_TEXT, buildAccentSet, over, passesAA, SURFACES, WEAK_ALPHA, type AccentTokens } from './accentSet';
import { contrastRatio, extractPalette, gamutMap, lchToRgb, parseOklch, type LCh } from './color';

const rgbOf = (css: string) => lchToRgb(gamutMap(parseOklch(css)!));
const alphaOf = (css: string) => Number(/\/\s*([\d.]+)\)/.exec(css)?.[1] ?? 1);

/** Re-checks a theme's tokens from the CSS strings themselves (what the browser will paint), not the reported numbers. */
function recheck(t: AccentTokens, theme: 'dark' | 'light') {
  const surfaces = SURFACES[theme];
  const ink = rgbOf(t.onAccent);
  const min = (f: (s: (typeof surfaces)[number]) => number) => Math.min(...surfaces.map(f));
  return {
    inkOnAccent: contrastRatio(ink, rgbOf(t.accent)),
    inkOnStrong: contrastRatio(ink, rgbOf(t.strong)),
    text: min((s) => contrastRatio(rgbOf(t.text), s)),
    ring: min((s) => contrastRatio(rgbOf(t.ring), s)),
    weak: min((s) => contrastRatio(BODY_TEXT[theme], over(rgbOf(t.weak), alphaOf(t.weak), s))),
    accentOnPanels: min((s) => contrastRatio(rgbOf(t.accent), s)),
  };
}

// A sweep over the whole hue circle and the lightness/chroma corners real covers produce (near-black, near-white,
// greys, neon), so no cover can produce an unreadable set.
const SEEDS: LCh[] = [];
for (let h = 0; h < 360; h += 15) for (const L of [0.12, 0.35, 0.55, 0.72, 0.9, 0.98]) for (const C of [0, 0.05, 0.12, 0.3]) SEEDS.push([L, C, h]);

describe('accent set from a seed colour', () => {
  it.each(['dark', 'light'] as const)('meets WCAG AA for every pairing in the %s themes, for any seed', (theme) => {
    for (const seed of SEEDS) {
      const set = buildAccentSet(seed, [seed[0], seed[1], (seed[2] + 40) % 360]);
      const c = recheck(set[theme], theme);
      const label = `seed ${seed.join(' ')}`;
      expect(c.inkOnAccent, label).toBeGreaterThanOrEqual(AA_TEXT);
      expect(c.inkOnStrong, label).toBeGreaterThanOrEqual(AA_TEXT);
      expect(c.text, label).toBeGreaterThanOrEqual(AA_TEXT);
      expect(c.ring, label).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(c.weak, label).toBeGreaterThanOrEqual(AA_TEXT);
      if (theme === 'dark') expect(c.accentOnPanels, label).toBeGreaterThanOrEqual(AA_TEXT);
      expect(passesAA(set.checks[theme]), label).toBe(true);
    }
  });

  it('light theme hover fills (0.08 darker than the accent) still carry the ink', () => {
    for (const seed of SEEDS) {
      const t = buildAccentSet(seed).light;
      const accent = parseOklch(t.accent)!;
      const darker = lchToRgb(gamutMap([accent[0] - 0.08, accent[1], accent[2]]));
      expect(contrastRatio(rgbOf(t.onAccent), darker)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('keeps the seed’s hue', () => {
    for (const h of [10, 95, 150, 210, 300]) {
      const set = buildAccentSet([0.7, 0.15, h]);
      for (const css of [set.dark.accent, set.dark.text, set.light.accent, set.light.text, set.light.ring]) {
        const d = Math.abs(((parseOklch(css)![2] - h + 540) % 360) - 180);
        expect(d).toBeLessThan(2);
      }
    }
  });

  it('caps chroma so a neon cover never shouts', () => {
    const set = buildAccentSet([0.7, 0.4, 140]);
    expect(parseOklch(set.dark.accent)![1]).toBeLessThanOrEqual(0.19);
  });

  it('weak washes are translucent', () => {
    expect(alphaOf(buildAccentSet([0.7, 0.15, 30]).dark.weak)).toBe(WEAK_ALPHA);
  });

  it('reads palette accents written as CSS, and refuses anything else', () => {
    expect(accentSetFromCss('oklch(0.72 0.14 30)', 'oklch(0.7 0.12 80)')).not.toBeNull();
    expect(accentSetFromCss('red')).toBeNull();
    expect(accentSetFromCss(undefined)).toBeNull();
  });

  it('works end to end from a cover’s extracted palette', () => {
    // A warm orange-and-teal "cover".
    const w = 16, h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const teal = i % w < 6;
      data.set(teal ? [20, 140, 150, 255] : [235, 120, 30, 255], i * 4);
    }
    const p = extractPalette(data, w, h);
    expect(p.vivid).toBeTruthy();
    const set = accentSetFromCss(p.vivid, p.vivid2)!;
    const hue = parseOklch(set.dark.accent)![2];
    expect(hue > 20 && hue < 90).toBe(true); // orange, not the brand violet
    expect(passesAA(set.checks.dark) && passesAA(set.checks.light)).toBe(true);
  });

  it('exposes one CSS variable per token and theme', () => {
    const vars = accentSetVars(buildAccentSet([0.7, 0.15, 30]));
    expect(Object.keys(vars)).toHaveLength(14);
    expect(vars['--as-accent']).toMatch(/^oklch\(/);
    expect(vars['--asl-ring']).toMatch(/^oklch\(/);
  });
});
