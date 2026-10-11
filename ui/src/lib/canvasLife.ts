/**
 * Track E2b: the Living Canvas's behaviour, as pure functions (unit-tested); the renderer is
 * `components/shell/LivingCanvas.tsx`.
 *
 * - **Profile** — what the canvas may do right now: off, a still frame, or animating; at which resolution, frame
 *   cap and number of depth layers; whether it follows the pointer and the ambient sound. Quality levels, reduced
 *   motion, Performance Mode (a game running), Data saver, safe mode and a hidden or unfocused window all feed in.
 * - **Daylight** — a gentle warmth by local time of day: warmer in the evening, dimmer and cooler late at night.
 * - **Flavour** — per-genre refinement inside a mood (ember: golden motes for fantasy, grey ash for dark/souls...).
 * - **Smoothing** — frame-rate-independent exponential approach, used for palettes (in OKLab), the pointer and the
 *   audio level, so nothing ever snaps.
 */
import type { Game } from '../bridge/types';
import { oklabToRgb, rgbToOklab, type Lab, type RGB } from './color';
import type { Mood } from './mood';

export type CanvasQuality = 'high' | 'balanced';
export type CanvasState = 'off' | 'still' | 'running' | 'paused';

export interface CanvasInputs {
  livingCanvas: boolean;
  /** The Visual quality setting. */
  quality: 'auto' | 'high' | 'balanced' | 'low' | undefined;
  cores: number | undefined;
  safeMode: boolean;
  reduced: boolean;
  /** Performance Mode: a game is running. */
  gameRunning: boolean;
  dataSaver: boolean;
  parallax: boolean;
  audioReact: boolean;
}

export interface CanvasProfile {
  enabled: boolean;
  quality: CanvasQuality | null;
  /** Internal resolution as a share of the window. */
  scale: number;
  /** Frame cap while focused (fps). */
  fps: number;
  /** Depth layers drawn: 2 (far light pools + base) or 3 (+ a near particle layer with its own parallax). */
  layers: 2 | 3;
  /** Animating (else one still frame per change). */
  animate: boolean;
  parallax: boolean;
  audio: boolean;
}

/** Frame cap while the window is visible but not focused (another app is in front). */
export const UNFOCUSED_FPS = 15;
/** Frame cap with Data saver on. */
export const SAVER_FPS = 20;

/** Same rule as App.tsx's `data-quality`: "auto" is Low on ≤ 4-core PCs, else Balanced. */
export function effectiveCanvasQuality(setting: CanvasInputs['quality'], cores: number | undefined): 'high' | 'balanced' | 'low' {
  if (setting === 'high' || setting === 'balanced' || setting === 'low') return setting;
  return (cores ?? 8) <= 4 ? 'low' : 'balanced';
}

export function canvasProfile(i: CanvasInputs): CanvasProfile {
  const q = effectiveCanvasQuality(i.quality, i.cores);
  const enabled = i.livingCanvas && q !== 'low' && !i.safeMode;
  if (!enabled) return { enabled: false, quality: null, scale: 0, fps: 0, layers: 2, animate: false, parallax: false, audio: false };
  const quality: CanvasQuality = q === 'high' ? 'high' : 'balanced';
  const animate = !i.reduced && !i.gameRunning;
  const lively = animate && !i.dataSaver;
  return {
    enabled,
    quality,
    scale: quality === 'high' ? 0.55 : 0.4,
    fps: i.dataSaver ? SAVER_FPS : 30,
    layers: quality === 'high' && !i.dataSaver ? 3 : 2,
    animate,
    parallax: lively && i.parallax,
    audio: lively && i.audioReact,
  };
}

/** Frame interval (ms) for a profile and window focus. */
export function frameInterval(p: CanvasProfile, focused: boolean): number {
  const fps = focused ? p.fps : Math.min(p.fps, UNFOCUSED_FPS);
  return fps > 0 ? 1000 / fps - 1 : Infinity; // 1 ms of slack so a 60 Hz rAF never skips an intended frame
}

/* ------------------------------------------------------------------ daylight */

export interface Daylight {
  /** −1 (cool) … 1 (warm); applied as a very small colour shift. */
  warm: number;
  /** Overall brightness multiplier (≤ 1). */
  dim: number;
}

/** Smooth bump: 1 at `centre`, 0 beyond `width` hours away (wrapping around midnight). */
function bump(hour: number, centre: number, width: number): number {
  const d = Math.abs(((hour - centre + 36) % 24) - 12);
  return d >= width ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / width);
}

/**
 * Local time of day → warmth. Morning is a touch cool and bright, the evening golden, late night cooler and
 * dimmer; midday neutral. Continuous in time (no visible steps), and small: at most ±7 % per channel.
 */
export function daylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  const evening = bump(h, 19.5, 3.5);
  const night = bump(h, 2, 4.5);
  const morning = bump(h, 7.5, 2.5);
  return {
    warm: +(evening * 0.8 - night * 0.3 - morning * 0.25).toFixed(4),
    dim: +(1 - night * 0.14).toFixed(4),
  };
}

/* ------------------------------------------------------------------ flavour */

/**
 * Per-genre refinement inside a mood (0 = the mood's default look, 1 = its variant). Ember: golden motes (0) or
 * grey ash for souls-likes and dark fantasy (1). Cosmos: white stars (0) or cool cyan for cyberpunk (1). Velocity:
 * diagonal streaks for racing (0) or level stadium flares for sports (1). Tide: cool water (0) or warm pastel for
 * cosy life sims (1). Dread: thin fog (0) or thick survival fog (1). Drift: always 0.
 */
export function moodFlavor(mood: Mood, game: Pick<Game, 'genres' | 'title'> | null | undefined): number {
  if (!game) return 0;
  const text = `${game.genres.join(' ')} ${game.title}`;
  switch (mood) {
    case 'ember': return /souls|dark fantasy|grimdark|hack and slash/i.test(text) ? 1 : 0;
    case 'cosmos': return /cyberpunk|cyber|neon/i.test(text) ? 1 : 0;
    case 'velocity': return /sports|football|soccer|basketball|tennis|golf|hockey/i.test(text) && !/racing|driving/i.test(text) ? 1 : 0;
    case 'tide': return /cozy|cosy|farming|life sim|wholesome/i.test(text) ? 1 : 0;
    case 'dread': return /survival/i.test(text) ? 1 : 0;
    default: return 0;
  }
}

/* ------------------------------------------------------------------ smoothing */

/** Exponential approach with time constant `tau` (s), independent of frame rate. */
export function approach(current: number, target: number, dtMs: number, tau: number): number {
  if (dtMs <= 0) return current;
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dtMs / 1000 / tau);
}

/** A palette (four sRGB colours) held in OKLab, so blends stay perceptual (no muddy midpoints between hues). */
export type LabPalette = Lab[];

export const toLabPalette = (rgb: readonly RGB[]): LabPalette => rgb.map((c) => rgbToOklab(c));

export function approachPalette(current: LabPalette, target: LabPalette, dtMs: number, tau: number): LabPalette {
  return current.map((c, i) => c.map((v, j) => approach(v, target[i][j], dtMs, tau)) as Lab);
}

export const labPaletteToRgb = (p: LabPalette): RGB[] => p.map((c) => oklabToRgb(c).map((v) => Math.min(1, Math.max(0, v))) as RGB);

/** Largest per-channel gap between two palettes (to know when a transition has settled). */
export function paletteGap(a: LabPalette, b: LabPalette): number {
  let gap = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < 3; j++) gap = Math.max(gap, Math.abs(a[i][j] - b[i][j]));
  return gap;
}

/** Palette time constant: ~1.5 s to settle, like the accent's 900 ms glide plus the canvas's slower body. */
export const PALETTE_TAU = 0.5;
/** Pointer parallax: slow and heavy, so the background never chases the cursor. */
export const POINTER_TAU = 0.7;
/** Audio level: quick enough to breathe with notes, slow enough to never flicker. */
export const AUDIO_TAU = 0.35;
