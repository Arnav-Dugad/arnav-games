/**
 * Track E3: pure helpers for performance insights — thermal trends, notes after a GPU driver change, frame-rate goals
 * measured from the frame-time histogram, and battery against plugged in. The thermal and driver rules mirror
 * PerfTrendRules in Core/Insights/PerfTrends.cs (same constants), which announces the same notes once as they happen.
 * Nothing is guessed: a figure that wasn't measured stays out, and every estimate says it is one.
 */
import type { PerfGoal, PerfSessionExtra, PerfSummary, SessionPower } from '../../bridge/types';
import { FRAME_TIME_EDGES_MS } from './insight';

/** The parts of a session the rules need (PerfEntry fits). */
export interface TrendEntry {
  id: string;
  gameId: string;
  startMs: number;
  summary: PerfSummary;
  session: { durationSeconds: number };
}

export type Extras = ReadonlyMap<string, PerfSessionExtra>;

const DAY = 86_400_000;
const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function median(values: readonly number[]): number | null {
  const v = values.filter(fin).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** "+2", "−3" (a real minus sign), "±0" — rounded half away from zero, like the native side. */
export function signed(v: number): string {
  const r = Math.sign(v) * Math.round(Math.abs(v));
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '±0';
}

/* ---------------------------------------------------------------- power */

export type PowerClass = 'battery' | 'ac' | 'mixed';

/** Mirrors SessionPower.Classify: 90% of the known time on one source, else mixed; null when unknown. */
export function powerClass(p: SessionPower | null | undefined): PowerClass | null {
  if (!p) return null;
  const known = p.acSeconds + p.batterySeconds;
  if (known <= 0) return null;
  if (p.batterySeconds >= 0.9 * known) return 'battery';
  if (p.acSeconds >= 0.9 * known) return 'ac';
  return 'mixed';
}

export const POWER_MODE_LABEL: Record<NonNullable<SessionPower['mode']>, string> = {
  batterySaver: 'Battery saver',
  betterBattery: 'Best power efficiency',
  balanced: 'Balanced',
  highPerformance: 'Best performance',
  maxPerformance: 'Best performance (max)',
  gameMode: 'Game mode',
  mixedReality: 'Mixed reality',
};

/* ---------------------------------------------------------------- thermal trend */

export const THERMAL = {
  /** Sessions shorter than this rarely reach a steady temperature. */
  minSeconds: 600,
  recentDays: 30,
  earlierDays: 90,
  minSessions: 3,
  /** A difference of medians at or above this (°C) is worth telling. */
  alertC: 5,
  /** Like with like: GPU load within this many points of the game's median load. */
  loadBand: 12,
} as const;

export interface ThermalPoint {
  id: string;
  startMs: number;
  tempC: number;
  load: number;
  side: 'recent' | 'earlier';
}

export interface ThermalTrend {
  gameId: string;
  recentC: number;
  earlierC: number;
  deltaC: number;
  recentSessions: number;
  earlierSessions: number;
  recentLoad: number | null;
  earlierLoad: number | null;
  direction: 'hotter' | 'cooler' | 'steady';
  /** The sessions compared, oldest first. */
  points: ThermalPoint[];
  /** Sessions left out because they ran at a different load, on battery, or too briefly. */
  leftOut: { load: number; battery: number; short: number };
  /** Start of the "recent" window (ms). */
  recentFrom: number;
}

/** Mirrors PerfTrendRules.Thermal. Null when there aren't three like-for-like sessions on each side. */
export function thermalTrend(entries: readonly TrendEntry[], gameId: string, extras: Extras): ThermalTrend | null {
  const game = entries.filter((e) => e.gameId === gameId && fin(e.summary.gpuTempAvgC) && e.summary.gpuTempAvgC > 0 && e.summary.gpuTempAvgC < 130 && fin(e.summary.gpuAvg) && e.summary.gpuAvg >= 0);
  const short = game.filter((e) => e.session.durationSeconds < THERMAL.minSeconds).length;
  const long = game.filter((e) => e.session.durationSeconds >= THERMAL.minSeconds);
  const battery = long.filter((e) => {
    const c = powerClass(extras.get(e.id)?.power);
    return c === 'battery' || c === 'mixed';
  }).length;
  const usable = long.filter((e) => {
    const c = powerClass(extras.get(e.id)?.power);
    return c !== 'battery' && c !== 'mixed';
  }).sort((a, b) => a.startMs - b.startMs);
  if (usable.length < THERMAL.minSessions * 2) return null;
  const anchor = usable[usable.length - 1].startMs;
  const recentFrom = anchor - THERMAL.recentDays * DAY;
  const earlierFrom = recentFrom - THERMAL.earlierDays * DAY;
  const window = usable.filter((e) => e.startMs > earlierFrom);
  const load = median(window.map((e) => e.summary.gpuAvg!));
  if (load == null) return null;
  const like = window.filter((e) => Math.abs(e.summary.gpuAvg! - load) <= THERMAL.loadBand);
  const recent = like.filter((e) => e.startMs > recentFrom);
  const earlier = like.filter((e) => e.startMs <= recentFrom);
  if (recent.length < THERMAL.minSessions || earlier.length < THERMAL.minSessions) return null;
  const r = median(recent.map((e) => e.summary.gpuTempAvgC!))!;
  const e = median(earlier.map((x) => x.summary.gpuTempAvgC!))!;
  const deltaC = Math.round((r - e) * 10) / 10;
  return {
    gameId, recentC: r, earlierC: e, deltaC,
    recentSessions: recent.length, earlierSessions: earlier.length,
    recentLoad: median(recent.map((x) => x.summary.gpuAvg!)), earlierLoad: median(earlier.map((x) => x.summary.gpuAvg!)),
    direction: deltaC >= THERMAL.alertC ? 'hotter' : deltaC <= -THERMAL.alertC ? 'cooler' : 'steady',
    points: like.map((x) => ({ id: x.id, startMs: x.startMs, tempC: x.summary.gpuTempAvgC!, load: x.summary.gpuAvg!, side: x.startMs > recentFrom ? 'recent' : 'earlier' })),
    leftOut: { load: window.length - like.length, battery, short },
    recentFrom,
  };
}

/** Every game with a thermal trend, the biggest rise first. */
export function thermalTrends(entries: readonly TrendEntry[], extras: Extras): ThermalTrend[] {
  const games = [...new Set(entries.map((e) => e.gameId))];
  return games
    .map((g) => thermalTrend(entries, g, extras))
    .filter((t): t is ThermalTrend => t != null)
    .sort((a, b) => b.deltaC - a.deltaC);
}

/** Safe things to try — never a setting VYSTRAL changes, and nothing that touches clocks, fans or power limits. */
export const COOLING_TIPS: readonly string[] = [
  'Clean the vents and fans — dust builds up over months and is the most common cause.',
  'Give it room to breathe: a laptop stand, or a hard, flat surface instead of a bed or sofa.',
  'Check the fan profile in your PC or laptop maker’s own app (for example Armoury Crate, Legion Space or MSI Center).',
];

/* ---------------------------------------------------------------- driver notes */

export const DRIVER_NOTE = { minSeconds: 120, beforeMax: 5, noisePct: 3 } as const;

export interface DriverNote {
  gameId: string;
  sessionId: string;
  driver: string;
  previousDriver: string;
  atMs: number;
  fpsAvg: number;
  fps1Low: number | null;
  beforeAvg: number;
  beforeLow: number | null;
  beforeSessions: number;
}

const sameDriver = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Mirrors PerfTrendRules.DriverNotes: the first measured session of a game on each new driver against the sessions before it. Newest first. */
export function driverNotes(entries: readonly TrendEntry[], extras: Extras): DriverNote[] {
  const measured = entries.filter((e) => {
    const x = extras.get(e.id);
    const c = powerClass(x?.power);
    return !!x?.driver?.trim() && fin(e.summary.fpsAvg) && e.summary.fpsAvg > 0 && e.session.durationSeconds >= DRIVER_NOTE.minSeconds && c !== 'battery' && c !== 'mixed';
  });
  const byGame = new Map<string, TrendEntry[]>();
  for (const e of measured) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);
  const notes: DriverNote[] = [];
  for (const list of byGame.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const driver = extras.get(cur.id)!.driver!;
      const prevDriver = extras.get(list[i - 1].id)!.driver!;
      if (sameDriver(driver, prevDriver)) continue;
      const before: TrendEntry[] = [];
      for (let j = i - 1; j >= 0 && before.length < DRIVER_NOTE.beforeMax; j--) {
        if (!sameDriver(extras.get(list[j].id)?.driver, prevDriver)) break;
        before.push(list[j]);
      }
      notes.push({
        gameId: cur.gameId, sessionId: cur.id, driver, previousDriver: prevDriver, atMs: cur.startMs,
        fpsAvg: cur.summary.fpsAvg!, fps1Low: fin(cur.summary.fps1Low) ? cur.summary.fps1Low : null,
        beforeAvg: median(before.map((b) => b.summary.fpsAvg!))!,
        beforeLow: median(before.map((b) => b.summary.fps1Low).filter(fin)),
        beforeSessions: before.length,
      });
    }
  }
  return notes.sort((a, b) => b.atMs - a.atMs);
}

/** "Forza Horizon 4 +2 fps average, 1% lows −3 fps" (the part after "Driver 617.42: "). */
export function driverNoteText(n: DriverNote, title: string): string {
  let s = `${title} ${signed(n.fpsAvg - n.beforeAvg)} fps average`;
  if (n.fps1Low != null && n.beforeLow != null) s += `, 1% lows ${signed(n.fps1Low - n.beforeLow)} fps`;
  return s;
}

/** Whether the average moved by less than ordinary run-to-run variation (3%). */
export function driverWithinNoise(n: DriverNote): boolean {
  return n.beforeAvg > 0 && Math.abs((n.fpsAvg - n.beforeAvg) / n.beforeAvg) * 100 < DRIVER_NOTE.noisePct;
}

/* ---------------------------------------------------------------- frame-rate goals */

export const GOAL_PRESETS = [30, 60, 120, 144] as const;
export const GOAL_MIN = 20;
export const GOAL_MAX = 360;

/** The fps a session is measured against: the fixed target, or that session's display refresh rate (null if unknown). */
export function goalFps(goal: PerfGoal | null | undefined, displayHz: number | null | undefined): number | null {
  if (!goal) return null;
  if (goal.display) return fin(displayHz) && displayHz >= GOAL_MIN && displayHz <= 1000 ? displayHz : null;
  return fin(goal.targetFps) ? goal.targetFps : null;
}

export function goalLabel(goal: PerfGoal | null | undefined): string {
  if (!goal) return 'No goal';
  return goal.display ? 'Display refresh rate' : `${goal.targetFps} fps`;
}

export interface BudgetShare {
  /** Share of frames that took no longer than the budget, 0–1. */
  share: number;
  /** True when the budget falls on a histogram edge, so nothing was interpolated. */
  exact: boolean;
  frames: number;
}

/**
 * The share of frames within a frame-time budget (ms), from the stored histogram (bucket edges FRAME_TIME_EDGES_MS,
 * each bucket [lower, upper)). Buckets below the budget count whole; the bucket the budget falls inside counts in
 * proportion to where it falls (assuming its frames are spread evenly) and the answer is marked as an estimate.
 * Null without a histogram, or for a budget inside the open-ended last bucket (over 100 ms).
 */
export function shareWithinBudget(hist: readonly number[] | null | undefined, budgetMs: number): BudgetShare | null {
  const edges = FRAME_TIME_EDGES_MS;
  if (!hist || hist.length !== edges.length + 1 || !(budgetMs > 0)) return null;
  if (!hist.every((c) => fin(c) && c >= 0)) return null;
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  if (budgetMs > edges[edges.length - 1]) return null;
  let within = 0;
  let exact = true;
  for (let i = 0; i < edges.length; i++) {
    const lo = i === 0 ? 0 : edges[i - 1];
    const hi = edges[i];
    if (hi <= budgetMs + 1e-9) {
      within += hist[i];
      continue;
    }
    if (lo < budgetMs - 1e-9) {
      within += hist[i] * ((budgetMs - lo) / (hi - lo));
      exact = false;
    }
    break;
  }
  return { share: Math.min(1, within / total), exact, frames: total };
}

export interface GoalPoint {
  id: string;
  startMs: number;
  targetFps: number;
  share: number;
  exact: boolean;
}

export interface GoalSeries {
  points: GoalPoint[];
  /** Measured sessions left out: no frame-time histogram (older or FPS off), or the display rate wasn't recorded. */
  noHistogram: number;
  noDisplayRate: number;
}

/** One point per measured session of a game, oldest first. */
export function goalSeries(entries: readonly TrendEntry[], gameId: string, goal: PerfGoal | null | undefined, extras: Extras): GoalSeries {
  const out: GoalSeries = { points: [], noHistogram: 0, noDisplayRate: 0 };
  if (!goal) return out;
  for (const e of entries.filter((x) => x.gameId === gameId && fin(x.summary.fpsAvg)).sort((a, b) => a.startMs - b.startMs)) {
    const fps = goalFps(goal, extras.get(e.id)?.displayHz);
    if (fps == null) {
      out.noDisplayRate++;
      continue;
    }
    const s = shareWithinBudget(e.summary.frameTimeHistogram, 1000 / fps);
    if (!s) {
      out.noHistogram++;
      continue;
    }
    out.points.push({ id: e.id, startMs: e.startMs, targetFps: fps, share: s.share, exact: s.exact });
  }
  return out;
}

/** The goal result for one session, or null when it can't be measured. */
export function sessionGoal(entry: TrendEntry, goal: PerfGoal | null | undefined, extras: Extras): GoalPoint | null {
  const fps = goalFps(goal, extras.get(entry.id)?.displayHz);
  if (fps == null) return null;
  const s = shareWithinBudget(entry.summary.frameTimeHistogram, 1000 / fps);
  return s ? { id: entry.id, startMs: entry.startMs, targetFps: fps, share: s.share, exact: s.exact } : null;
}

export interface GoalTrend {
  latest: GoalPoint;
  /** Median share of the sessions before the latest (needs three). */
  typical: number | null;
  /** Latest minus typical, in percentage points. */
  deltaPts: number | null;
  direction: 'better' | 'worse' | 'steady' | 'unknown';
}

/** Differences under this many percentage points are ordinary variation. */
export const GOAL_NOISE_PTS = 3;

export function goalTrend(points: readonly GoalPoint[]): GoalTrend | null {
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const before = points.slice(-11, -1);
  const typical = before.length >= 3 ? median(before.map((p) => p.share)) : null;
  if (typical == null) return { latest, typical: null, deltaPts: null, direction: 'unknown' };
  const deltaPts = (latest.share - typical) * 100;
  return { latest, typical, deltaPts, direction: Math.abs(deltaPts) < GOAL_NOISE_PTS ? 'steady' : deltaPts > 0 ? 'better' : 'worse' };
}

/** "92%", "about 92%" for an estimate, "over 99%" / "under 1%" at the ends (never a rounded 100% that wasn't). */
export function formatShare(share: number, exact = true): string {
  const pct = share * 100;
  const text = pct > 99 && pct < 100 ? 'over 99%' : pct < 1 && pct > 0 ? 'under 1%' : `${Math.round(pct)}%`;
  return exact ? text : `about ${text}`;
}

/* ---------------------------------------------------------------- battery against plugged in */

/** Each side needs at least this many sessions before medians are compared. */
export const BATTERY_MIN_SIDE = 3;

export interface PowerSide {
  sessions: number;
  fpsSessions: number;
  fpsAvg: number | null;
  fps1Low: number | null;
  tempC: number | null;
  /** Sessions that spent most of their battery time with battery saver on. */
  saverSessions: number;
  /** The most common power mode, when recorded. */
  mode: SessionPower['mode'];
}

export interface BatteryComparison {
  gameId: string;
  battery: PowerSide;
  ac: PowerSide;
  /** Both sides have enough sessions to compare. */
  enough: boolean;
  /** Sessions with a mixed power source, left out. */
  mixed: number;
}

function side(list: readonly TrendEntry[], extras: Extras): PowerSide {
  const fps = list.filter((e) => fin(e.summary.fpsAvg) && e.summary.fpsAvg > 0);
  const modes = new Map<string, number>();
  let saver = 0;
  for (const e of list) {
    const p = extras.get(e.id)?.power;
    if (p?.mode) modes.set(p.mode, (modes.get(p.mode) ?? 0) + 1);
    if (p && p.saverSeconds > 0 && p.saverSeconds >= 0.5 * Math.max(1, p.batterySeconds)) saver++;
  }
  const mode = [...modes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as SessionPower['mode'] | undefined;
  return {
    sessions: list.length,
    fpsSessions: fps.length,
    fpsAvg: median(fps.map((e) => e.summary.fpsAvg!)),
    fps1Low: median(fps.map((e) => e.summary.fps1Low).filter(fin)),
    tempC: median(list.map((e) => e.summary.gpuTempAvgC).filter(fin)),
    saverSessions: saver,
    mode: mode ?? null,
  };
}

/** Per game with at least one session on battery: battery against plugged-in medians. Most battery sessions first. */
export function batteryComparisons(entries: readonly TrendEntry[], extras: Extras): BatteryComparison[] {
  const byGame = new Map<string, { battery: TrendEntry[]; ac: TrendEntry[]; mixed: number }>();
  for (const e of entries) {
    if (e.session.durationSeconds < DRIVER_NOTE.minSeconds) continue;
    const c = powerClass(extras.get(e.id)?.power);
    if (!c) continue;
    const g = byGame.get(e.gameId) ?? { battery: [], ac: [], mixed: 0 };
    if (c === 'mixed') g.mixed++;
    else g[c].push(e);
    byGame.set(e.gameId, g);
  }
  const out: BatteryComparison[] = [];
  for (const [gameId, g] of byGame) {
    if (!g.battery.length) continue;
    const battery = side(g.battery, extras);
    const ac = side(g.ac, extras);
    out.push({ gameId, battery, ac, mixed: g.mixed, enough: battery.fpsSessions >= BATTERY_MIN_SIDE && ac.fpsSessions >= BATTERY_MIN_SIDE });
  }
  return out.sort((a, b) => Number(b.enough) - Number(a.enough) || b.battery.sessions - a.battery.sessions);
}

/** Relative change from plugged in to battery, in percent; null when either is missing. */
export function relChange(ac: number | null, battery: number | null): number | null {
  if (ac == null || battery == null || ac <= 0) return null;
  return ((battery - ac) / ac) * 100;
}
