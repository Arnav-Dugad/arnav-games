import { describe, expect, it } from 'vitest';
import { approach, approachPalette, canvasProfile, daylight, effectiveCanvasQuality, frameInterval, labPaletteToRgb, moodFlavor, paletteGap, SAVER_FPS, toLabPalette, UNFOCUSED_FPS, type CanvasInputs } from './canvasLife';
import { bedLoudness, NOTE_GAIN_CAP } from './ambient';
import type { RGB } from './color';

const base: CanvasInputs = { livingCanvas: true, quality: 'balanced', cores: 16, safeMode: false, reduced: false, gameRunning: false, dataSaver: false, parallax: true, audioReact: false };

describe('canvas profile', () => {
  it('respects quality levels', () => {
    expect(canvasProfile({ ...base, quality: 'high' })).toMatchObject({ enabled: true, quality: 'high', scale: 0.55, layers: 3, fps: 30 });
    expect(canvasProfile(base)).toMatchObject({ enabled: true, quality: 'balanced', scale: 0.4, layers: 2, fps: 30 });
    expect(canvasProfile({ ...base, quality: 'low' }).enabled).toBe(false);
  });

  it('resolves "auto" like the rest of the app: Low on 4-core PCs', () => {
    expect(effectiveCanvasQuality('auto', 4)).toBe('low');
    expect(effectiveCanvasQuality('auto', 8)).toBe('balanced');
    expect(effectiveCanvasQuality(undefined, undefined)).toBe('balanced');
    expect(canvasProfile({ ...base, quality: 'auto', cores: 4 }).enabled).toBe(false);
  });

  it('is off when turned off and in safe mode', () => {
    expect(canvasProfile({ ...base, livingCanvas: false }).enabled).toBe(false);
    expect(canvasProfile({ ...base, safeMode: true }).enabled).toBe(false);
  });

  it('draws still frames under reduced motion and in Performance Mode, with no parallax or audio', () => {
    for (const p of [canvasProfile({ ...base, reduced: true, audioReact: true }), canvasProfile({ ...base, gameRunning: true, audioReact: true })]) {
      expect(p).toMatchObject({ enabled: true, animate: false, parallax: false, audio: false });
    }
  });

  it('keeps to its lightest form with Data saver', () => {
    const p = canvasProfile({ ...base, quality: 'high', dataSaver: true, audioReact: true });
    expect(p).toMatchObject({ fps: SAVER_FPS, layers: 2, parallax: false, audio: false, animate: true });
  });

  it('only reacts to sound when asked', () => {
    expect(canvasProfile(base).audio).toBe(false);
    expect(canvasProfile({ ...base, audioReact: true }).audio).toBe(true);
    expect(canvasProfile({ ...base, parallax: false }).parallax).toBe(false);
  });

  it('slows down when the window is not focused', () => {
    const p = canvasProfile(base);
    expect(frameInterval(p, true)).toBeCloseTo(1000 / 30 - 1);
    expect(frameInterval(p, false)).toBeCloseTo(1000 / UNFOCUSED_FPS - 1);
    expect(frameInterval(canvasProfile({ ...base, livingCanvas: false }), true)).toBe(Infinity);
  });
});

describe('daylight', () => {
  it('is warm in the evening, cool and dim late at night, neutral at midday', () => {
    expect(daylight(19.5).warm).toBeGreaterThan(0.7);
    expect(daylight(2).warm).toBeLessThan(0);
    expect(daylight(2).dim).toBeLessThan(0.9);
    expect(daylight(13)).toEqual({ warm: 0, dim: 1 });
  });

  it('never steps: neighbouring minutes differ by a tiny amount', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = daylight(m / 60), b = daylight((m + 1) / 60);
      expect(Math.abs(a.warm - b.warm)).toBeLessThan(0.02);
      expect(Math.abs(a.dim - b.dim)).toBeLessThan(0.005);
    }
  });

  it('stays subtle', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const d = daylight(h);
      expect(Math.abs(d.warm)).toBeLessThanOrEqual(0.8);
      expect(d.dim).toBeGreaterThanOrEqual(0.86);
    }
  });
});

describe('mood flavour', () => {
  const g = (genres: string[], title = 'X') => ({ genres, title });
  it('refines particles per genre within a mood', () => {
    expect(moodFlavor('ember', g(['RPG', 'Fantasy']))).toBe(0);
    expect(moodFlavor('ember', g(['Action RPG', 'Souls-like']))).toBe(1);
    expect(moodFlavor('cosmos', g(['Cyberpunk', 'RPG']))).toBe(1);
    expect(moodFlavor('velocity', g(['Racing']))).toBe(0);
    expect(moodFlavor('velocity', g(['Sports', 'Football']))).toBe(1);
    expect(moodFlavor('tide', g(['Simulation', 'Farming']))).toBe(1);
    expect(moodFlavor('dread', g(['Survival Horror']))).toBe(1);
    expect(moodFlavor('drift', g(['Survival', 'Souls']))).toBe(0);
    expect(moodFlavor('ember', null)).toBe(0);
  });
});

describe('smoothing', () => {
  it('approaches independently of frame rate', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 30; i++) a = approach(a, 1, 1000 / 30, 0.5);
    for (let i = 0; i < 60; i++) b = approach(b, 1, 1000 / 60, 0.5);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(1 - Math.exp(-2), 6);
    expect(approach(0.3, 1, 0, 0.5)).toBe(0.3);
  });

  it('blends palettes in OKLab and settles on the target', () => {
    const from: RGB[] = [[0.1, 0.05, 0.2], [0.2, 0.1, 0.3], [0.3, 0.1, 0.1], [0.4, 0.3, 0.1]];
    const to: RGB[] = [[0.05, 0.2, 0.1], [0.1, 0.3, 0.2], [0.1, 0.1, 0.3], [0.2, 0.2, 0.4]];
    let p = toLabPalette(from);
    const target = toLabPalette(to);
    for (let i = 0; i < 90; i++) p = approachPalette(p, target, 1000 / 30, 0.5); // 3 s
    expect(paletteGap(p, target)).toBeLessThan(0.01);
    labPaletteToRgb(p).forEach((c, i) => c.forEach((v, j) => expect(v).toBeCloseTo(to[i][j], 1)));
  });
});

describe('ambient loudness (for the optional canvas reaction)', () => {
  const note = { at: 10, dur: 4, gain: NOTE_GAIN_CAP, attack: 0.9 };
  it('follows each note’s envelope', () => {
    expect(bedLoudness([note], 9)).toBe(0);
    expect(bedLoudness([note], 10.45)).toBeCloseTo(0.25, 2); // half-way up the attack, one full-gain note = 0.5
    expect(bedLoudness([note], 10.9)).toBeCloseTo(0.5, 2);
    expect(bedLoudness([note], 13.5)).toBeLessThan(0.01);
    expect(bedLoudness([note], 14.5)).toBe(0);
  });

  it('sums overlapping notes and caps at 1', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...note, at: 10 + i * 0.01 }));
    expect(bedLoudness(many, 11)).toBe(1);
    expect(bedLoudness([], 11)).toBe(0);
  });
});
