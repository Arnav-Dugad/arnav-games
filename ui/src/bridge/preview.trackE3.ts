/**
 * Track E3 preview: performance insights. Everything here is fictional sample data for the browser preview; the app
 * reads real values (the power state with GetSystemPowerStatus, drivers and display rates recorded per session).
 * URL switches:
 *   ?perfTrends   a laptop history for Redline Rivals: 18 sessions over 15 weeks with FPS and frame-time histograms,
 *                 a GPU running about 7 °C hotter this month, a driver change (572.16 → 576.02), sessions on battery,
 *                 and a 60 fps goal
 *   ?battery      pretend this PC has a battery (on by default with ?perfTrends)
 *   ?perfNote     announce a driver note (as the app does when the session that caused it ends) shortly after start
 */
import type { Game, PerfGoal, PerfInsightContext, PerfInsightEvent, PerfSessionExtra, Session, SessionPower, Settings } from './types';
import { BridgeError } from './bridge';
import { hardwareFor } from './preview.playData';

export const TRACK_E3_DEFAULT_SETTINGS: Pick<Settings, 'notifications.perfInsights'> = { 'notifications.perfInsights': true };

const DAY = 86_400_000;
const HEX32 = /^[0-9a-f]{32}$/;
export const PERF_TRENDS_GAME = 'Redline Rivals';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

const hex = (r: () => number) => Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join('');

/** Upper edges of the stored frame-time histogram (FrameStats.HistogramEdgesMs). */
const EDGES = [4, 6, 8, 10, 12, 14, 17, 20, 25, 33, 50, 100];

/** A plausible frame-time histogram around an average frame rate: a bell around the mean plus a small slow tail. */
function histogram(fps: number, low: number, frames: number, r: () => number): number[] {
  const mean = 1000 / fps;
  const sd = mean * (0.12 + (1 - low / fps) * 0.25);
  const counts = new Array(EDGES.length + 1).fill(0);
  const n = 4000;
  for (let i = 0; i < n; i++) {
    let ft: number;
    if (r() < 0.025) ft = mean * (1.8 + r() * 2.6); // hitches
    else {
      const u = Math.max(1e-9, r());
      ft = mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    }
    ft = Math.max(1, ft);
    let b = EDGES.findIndex((e) => ft < e);
    if (b < 0) b = EDGES.length;
    counts[b]++;
  }
  return counts.map((c) => Math.round((c / n) * frames));
}

interface Planned {
  daysAgo: number;
  temp: number;
  fps: number;
  low: number;
  power: 'ac' | 'battery' | 'saver';
}

/** Days ago, GPU temperature, FPS, 1% low and power source — see the header for the story they tell. */
const PLAN: Planned[] = [
  { daysAgo: 105, temp: 67, fps: 71, low: 49, power: 'ac' },
  { daysAgo: 96, temp: 66, fps: 72, low: 51, power: 'ac' },
  { daysAgo: 88, temp: 68, fps: 70, low: 48, power: 'ac' },
  { daysAgo: 80, temp: 67, fps: 72, low: 50, power: 'ac' },
  { daysAgo: 71, temp: 66, fps: 70, low: 52, power: 'ac' },
  { daysAgo: 63, temp: 68, fps: 73, low: 51, power: 'ac' },
  { daysAgo: 55, temp: 67, fps: 71, low: 49, power: 'ac' },
  { daysAgo: 47, temp: 66, fps: 72, low: 50, power: 'ac' },
  { daysAgo: 44, temp: 61, fps: 47, low: 30, power: 'battery' },
  { daysAgo: 35, temp: 60, fps: 45, low: 28, power: 'saver' },
  { daysAgo: 27, temp: 73, fps: 72, low: 50, power: 'ac' },
  { daysAgo: 21, temp: 74, fps: 74, low: 47, power: 'ac' }, // the first session on driver 576.02
  { daysAgo: 19, temp: 62, fps: 48, low: 31, power: 'battery' },
  { daysAgo: 17, temp: 75, fps: 69, low: 45, power: 'ac' },
  { daysAgo: 12, temp: 61, fps: 46, low: 29, power: 'battery' },
  { daysAgo: 9, temp: 74, fps: 70, low: 46, power: 'ac' },
  { daysAgo: 6, temp: 75, fps: 68, low: 44, power: 'ac' },
  { daysAgo: 3, temp: 74, fps: 69, low: 45, power: 'ac' },
  { daysAgo: 1, temp: 76, fps: 67, low: 43, power: 'ac' },
];

interface E3State {
  game: Game | null;
  /** Power per preview session id (only the ?perfTrends history has any). */
  power: Map<string, SessionPower>;
  driverNoteSession: string | null;
}

const state: E3State = { game: null, power: new Map(), driverNoteSession: null };

/** With ?perfTrends, adds the Redline Rivals history to the preview library. */
export function decorateTrackE3Sessions(lib: { games: Game[]; sessions: Session[] }, params: URLSearchParams, now = Date.now()): void {
  state.game = null;
  state.power.clear();
  state.driverNoteSession = null;
  if (!params.has('perfTrends')) return;
  const idx = lib.games.findIndex((g) => g.title === PERF_TRENDS_GAME);
  if (idx < 0) return;
  const game = lib.games[idx];
  const r = rng(2026_1011);
  let tracked = 0;
  let last: string | null = null;
  for (const p of PLAN) {
    const start = now - p.daysAgo * DAY - (2 + Math.floor(r() * 4)) * 3_600_000;
    const dur = 2400 + Math.floor(r() * 3000);
    // Ids whose hardware record is "unknown" in the preview's hardware history would hide the driver; skip those.
    let id = hex(r);
    for (let tries = 0; tries < 20; tries++) {
      const probe = { id, gameId: game.id, start: new Date(start).toISOString(), durationSeconds: dur } as Session;
      if (hardwareFor(probe, now).driver) break;
      id = hex(r);
    }
    const frames = Math.round(dur * p.fps);
    const iso = new Date(start).toISOString();
    tracked += dur;
    if (!last || iso > last) last = iso;
    const onBattery = p.power !== 'ac';
    lib.sessions.push({
      id, gameId: game.id, installationId: game.installations[0]?.id ?? null, start: iso, end: new Date(start + dur * 1000).toISOString(),
      durationSeconds: dur, source: 'tracked',
      perfSummary: JSON.stringify({
        samples: Math.floor(dur / 2), cpuAvg: 38 + r() * 12, cpuMax: 70 + r() * 20, gpuAvg: onBattery ? 88 + r() * 6 : 93 + r() * 4, gpuMax: 100,
        gpuMemAvgMb: 5200 + r() * 600, gpuMemMaxMb: 6100 + r() * 400, ramAvgMb: 9800 + r() * 900, ramMaxMb: 11800 + r() * 900,
        gpuTempAvgC: p.temp, gpuTempMaxC: p.temp + 5 + Math.round(r() * 3),
        fpsStatus: 'Measured with Intel PresentMon 2.6.0. Frame time is the time between the game’s presented frames.', fpsSource: 'Intel PresentMon 2.6.0',
        fpsAvg: p.fps, fps1Low: p.low, fps01Low: Math.round(p.low * 0.72 * 10) / 10, frameTimeP50Ms: Math.round((1000 / p.fps) * 100) / 100,
        frameTimeP99Ms: Math.round((1000 / p.low) * 0.9 * 100) / 100, stutterCount: Math.round(dur / 60 * (p.low / p.fps < 0.65 ? 0.6 : 0.2)), frameCount: frames,
        frameTimeHistogram: histogram(p.fps, p.low, frames, r),
        throttledSeconds: 0, powerLimitedSeconds: onBattery ? Math.round(dur * 0.8) : Math.round(dur * 0.3), throttleReasons: ['power'], peakTempC: p.temp + 6,
        gpuClockAvgMhz: onBattery ? 1320 : 1890, thermalNote: null,
      }),
    });
    state.power.set(id, p.power === 'ac'
      ? { acSeconds: dur, batterySeconds: 0, unknownSeconds: 0, saverSeconds: 0, mode: p.daysAgo < 30 ? 'maxPerformance' : 'balanced' }
      : { acSeconds: 0, batterySeconds: dur, unknownSeconds: 0, saverSeconds: p.power === 'saver' ? dur : 0, mode: p.power === 'saver' ? 'batterySaver' : 'betterBattery' });
    if (p.daysAgo === 21) state.driverNoteSession = id;
  }
  lib.games[idx] = { ...game, sessionCount: game.sessionCount + PLAN.length, trackedSeconds: game.trackedSeconds + tracked, lastTrackedPlay: last };
  state.game = lib.games[idx];
}

export function trackE3PreviewHandlers(ctx: {
  lib: { games: Game[]; sessions: Session[] };
  emit: () => (name: string, payload: unknown) => void;
  timers: number[];
}) {
  const params = new URLSearchParams(location.search);
  const laptop = params.has('battery') || params.has('perfTrends');
  const goals = new Map<string, PerfGoal>();
  if (state.game) goals.set(state.game.id, { gameId: state.game.id, targetFps: 60, display: false });

  if (params.has('perfNote')) {
    ctx.timers.push(window.setTimeout(() => {
      const note = previewNote(ctx.lib);
      if (note) ctx.emit()('perf.insight', note);
    }, 2200));
  }

  return {
    'perfInsights.context': (): PerfInsightContext => {
      const now = Date.now();
      const sessions: PerfSessionExtra[] = ctx.lib.sessions
        .filter((s) => s.end && s.perfSummary)
        .map((s) => {
          const hw = hardwareFor(s, now);
          return { sessionId: s.id, driver: hw.driver, displayHz: hw.refreshHz, power: state.power.get(s.id) ?? null };
        });
      return { hasBattery: laptop, onBattery: false, sessions, goals: [...goals.values()] };
    },
    'perfInsights.setGoal': (p: { gameId?: string; targetFps?: number | null; display?: boolean | null }): PerfGoal | null => {
      const gameId = p?.gameId;
      if (typeof gameId !== 'string' || !HEX32.test(gameId)) throw new BridgeError('invalid', 'Invalid game id.');
      if (!ctx.lib.games.some((g) => g.id === gameId)) throw new BridgeError('notFound', 'That game isn’t in your library any more.');
      const display = p.display ?? false;
      const target = p.targetFps ?? null;
      if (display && target != null) throw new BridgeError('invalid', 'Choose a frame rate or the display’s refresh rate, not both.');
      if (target != null && (!Number.isInteger(target) || target < 20 || target > 360)) throw new BridgeError('invalid', 'Goals go from 20 to 360 fps.');
      if (!display && target == null) {
        goals.delete(gameId);
        return null;
      }
      const goal = { gameId, targetFps: display ? null : target, display };
      goals.set(gameId, goal);
      return goal;
    },
  };
}

/** The note `?perfNote` announces: the Redline Rivals driver note with ?perfTrends, else one for the newest measured session. */
function previewNote(lib: { games: Game[]; sessions: Session[] }): PerfInsightEvent | null {
  if (state.game && state.driverNoteSession) {
    return {
      kind: 'driver', sessionId: state.driverNoteSession, gameId: state.game.id,
      title: `Driver 576.02: ${state.game.title} +2 fps average, 1% lows −3 fps`,
      body: 'Your first session on the new driver, against the median of your last 5 sessions on 572.16. One session can be noise, and settings or game updates move these numbers too.',
    };
  }
  const s = lib.sessions.filter((x) => x.end && x.perfSummary?.includes('"fpsAvg"')).sort((a, b) => b.start.localeCompare(a.start))[0];
  const g = s && lib.games.find((x) => x.id === s.gameId);
  if (!s || !g) return null;
  return {
    kind: 'thermal', sessionId: s.id, gameId: g.id,
    title: `Your GPU runs 6 °C hotter in ${g.title}`,
    body: 'Typical 75 °C over the last month, up from 69 °C, at a similar load. A warm room can do this too. Cleaning the vents or raising a laptop can help.',
  };
}
