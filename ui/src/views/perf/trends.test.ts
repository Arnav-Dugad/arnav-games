import { describe, expect, it } from 'vitest';
import type { PerfSessionExtra, PerfSummary, SessionPower } from '../../bridge/types';
import {
  batteryComparisons, driverNoteText, driverNotes, driverWithinNoise, formatShare, goalFps, goalSeries, goalTrend, median, powerClass,
  sessionGoal, shareWithinBudget, signed, thermalTrend, thermalTrends, type TrendEntry,
} from './trends';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 20);
const G = 'a'.repeat(32);
const H = 'b'.repeat(32);

const summary = (o: Partial<PerfSummary>): PerfSummary => ({
  samples: 100, cpuAvg: 40, cpuMax: 70, gpuAvg: 95, gpuMax: 100, gpuMemAvgMb: null, gpuMemMaxMb: null, ramAvgMb: null, ramMaxMb: null,
  gpuTempAvgC: null, gpuTempMaxC: null, fpsStatus: 'Measured.', ...o,
});

let n = 0;
function entry(daysAgo: number, o: Partial<PerfSummary> = {}, seconds = 3600, game = G): TrendEntry {
  n++;
  return { id: `${game.slice(0, 4)}${String(n).padStart(28, '0')}`, gameId: game, startMs: NOW - daysAgo * DAY, summary: summary(o), session: { durationSeconds: seconds } };
}

const ac: SessionPower = { acSeconds: 3600, batterySeconds: 0, unknownSeconds: 0, saverSeconds: 0, mode: 'balanced' };
const bat: SessionPower = { acSeconds: 0, batterySeconds: 3600, unknownSeconds: 0, saverSeconds: 0, mode: 'betterBattery' };

function extras(list: [TrendEntry, Partial<PerfSessionExtra>][]): Map<string, PerfSessionExtra> {
  return new Map(list.map(([e, x]) => [e.id, { sessionId: e.id, driver: null, displayHz: null, power: null, ...x }]));
}

describe('thermal trend', () => {
  it('compares medians of like-for-like sessions, recent month against the months before', () => {
    const list = [
      entry(70, { gpuTempAvgC: 66 }), entry(60, { gpuTempAvgC: 68 }), entry(50, { gpuTempAvgC: 67 }),
      entry(45, { gpuTempAvgC: 90, gpuAvg: 40 }), // a very different load: left out
      entry(20, { gpuTempAvgC: 74 }), entry(10, { gpuTempAvgC: 73 }), entry(2, { gpuTempAvgC: 75 }),
      entry(1, { gpuTempAvgC: 60 }, 300), // five minutes never warms up: left out
    ];
    const t = thermalTrend(list, G, new Map())!;
    expect([t.recentC, t.earlierC, t.deltaC, t.direction]).toEqual([74, 67, 7, 'hotter']);
    expect([t.recentSessions, t.earlierSessions]).toEqual([3, 3]);
    expect(t.leftOut).toEqual({ load: 1, battery: 0, short: 1 });
    expect(t.points.map((p) => p.side)).toEqual(['earlier', 'earlier', 'earlier', 'recent', 'recent', 'recent']);
  });

  it('needs three sessions on each side and never mixes in battery sessions', () => {
    expect(thermalTrend([entry(60, { gpuTempAvgC: 66 }), entry(50, { gpuTempAvgC: 67 }), entry(20, { gpuTempAvgC: 74 }), entry(10, { gpuTempAvgC: 75 }), entry(2, { gpuTempAvgC: 76 })], G, new Map())).toBeNull();
    const b = [entry(60, { gpuTempAvgC: 60 }), entry(55, { gpuTempAvgC: 60 }), entry(50, { gpuTempAvgC: 61 })];
    const list = [...b, entry(20, { gpuTempAvgC: 74 }), entry(10, { gpuTempAvgC: 75 }), entry(2, { gpuTempAvgC: 76 })];
    expect(thermalTrend(list, G, extras(b.map((e) => [e, { power: bat }])))).toBeNull();
    expect(thermalTrend(list, G, new Map())!.direction).toBe('hotter');
  });

  it('calls a small change steady and a drop cooler, and sorts games by the biggest rise', () => {
    const steady = [70, 71, 69].map((t, i) => entry(60 - i * 10, { gpuTempAvgC: t }, 3600, H)).concat([72, 73, 72].map((t, i) => entry(20 - i * 8, { gpuTempAvgC: t }, 3600, H)));
    const hot = [66, 68, 67].map((t, i) => entry(70 - i * 10, { gpuTempAvgC: t })).concat([74, 73, 75].map((t, i) => entry(20 - i * 8, { gpuTempAvgC: t })));
    const all = thermalTrends([...steady, ...hot], new Map());
    expect(all.map((t) => [t.gameId, t.direction])).toEqual([[G, 'hotter'], [H, 'steady']]);
    const cool = [76, 77, 78].map((t, i) => entry(60 - i * 10, { gpuTempAvgC: t })).concat([70, 69, 71].map((t, i) => entry(20 - i * 8, { gpuTempAvgC: t })));
    expect(thermalTrend(cool, G, new Map())!.direction).toBe('cooler');
  });

  it('has no trend without temperatures (GPUs that don’t report them)', () => {
    expect(thermalTrend([60, 50, 40, 20, 10, 2].map((d) => entry(d)), G, new Map())).toBeNull();
  });
});

describe('driver notes', () => {
  it('compares the first session on a new driver with the median of the sessions before', () => {
    const a = entry(30, { fpsAvg: 70, fps1Low: 50 });
    const b = entry(20, { fpsAvg: 72, fps1Low: 48 });
    const c = entry(10, { fpsAvg: 74, fps1Low: 52 });
    const d = entry(5, { fpsAvg: 74, fps1Low: 47 });
    const e = entry(3, { fpsAvg: 80, fps1Low: 49 });
    const short = entry(4, { fpsAvg: 30, fps1Low: 10 }, 60);
    const battery = entry(6, { fpsAvg: 41, fps1Low: 22 });
    const x = extras([
      [a, { driver: '572.16' }], [b, { driver: '572.16' }], [c, { driver: '572.16' }], [d, { driver: '617.42' }], [e, { driver: '617.42' }],
      [short, { driver: '617.42' }], [battery, { driver: '617.42', power: bat }],
    ]);
    const notes = driverNotes([a, b, c, d, e, short, battery], x);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ sessionId: d.id, driver: '617.42', previousDriver: '572.16', beforeAvg: 72, beforeLow: 50, beforeSessions: 3 });
    expect(`Driver ${notes[0].driver}: ${driverNoteText(notes[0], 'Forza Horizon 4')}`).toBe('Driver 617.42: Forza Horizon 4 +2 fps average, 1% lows −3 fps');
    expect(driverWithinNoise(notes[0])).toBe(true); // +2 of 72 is under 3%
  });

  it('needs a frame rate and a driver on both sides; going back to an older driver is a change too', () => {
    const a = entry(30, { fpsAvg: 60 });
    const b = entry(20, {});
    const c = entry(10, { fpsAvg: 66 });
    const d = entry(5, { fpsAvg: 61 });
    const x = extras([[a, { driver: '566.36' }], [b, { driver: '572.16' }], [c, { driver: '572.16' }], [d, { driver: '566.36' }]]);
    const notes = driverNotes([a, b, c, d], x);
    expect(notes.map((n) => [n.previousDriver, n.driver, n.beforeSessions])).toEqual([['572.16', '566.36', 1], ['566.36', '572.16', 1]]);
    expect(driverNoteText(notes[1], 'Nebula Drift')).toBe('Nebula Drift +6 fps average');
  });

  it('formats signed differences like the native side', () => {
    expect([signed(2.4), signed(-2.6), signed(0.4), signed(-0.5), signed(0.5)]).toEqual(['+2', '−3', '±0', '−1', '+1']);
  });
});

describe('frame-rate goals from the frame-time histogram', () => {
  // Buckets: <4, 4–6, 6–8, 8–10, 10–12, 12–14, 14–17, 17–20, 20–25, 25–33, 33–50, 50–100, 100+
  const hist = [0, 0, 0, 100, 200, 300, 300, 50, 30, 10, 6, 3, 1]; // 1,000 frames

  it('is exact when the budget falls on a bucket edge', () => {
    expect(shareWithinBudget(hist, 20)).toEqual({ share: 0.95, exact: true, frames: 1000 }); // 50 fps
    expect(shareWithinBudget(hist, 10)).toEqual({ share: 0.1, exact: true, frames: 1000 }); // 100 fps
    expect(shareWithinBudget(hist, 100)!.share).toBeCloseTo(0.999);
  });

  it('interpolates inside the bucket the budget falls in, and says so', () => {
    const s60 = shareWithinBudget(hist, 1000 / 60)!; // 16.67 ms: 600 below 14 ms + 300 × (2.67 / 3)
    expect(s60.exact).toBe(false);
    expect(s60.share).toBeCloseTo((600 + 300 * (1000 / 60 - 14) / 3) / 1000, 6);
    const s30 = shareWithinBudget(hist, 1000 / 30)!; // 33.33 ms: 990 below 33 ms + 6 × (0.33 / 17)
    expect(s30.share).toBeCloseTo((990 + 6 * (1000 / 30 - 33) / 17) / 1000, 6);
    const s144 = shareWithinBudget(hist, 1000 / 144)!; // 6.94 ms, inside an empty bucket
    expect(s144).toEqual({ share: 0, exact: false, frames: 1000 });
  });

  it('refuses what it can’t answer', () => {
    expect(shareWithinBudget(null, 16)).toBeNull();
    expect(shareWithinBudget([1, 2, 3], 16)).toBeNull(); // wrong bucket count
    expect(shareWithinBudget(new Array(13).fill(0), 16)).toBeNull();
    expect(shareWithinBudget(hist, 150)).toBeNull(); // inside the open-ended last bucket
    expect(shareWithinBudget([...hist.slice(0, 12), -5], 16)).toBeNull();
  });

  it('measures each session against a fixed target or its own display refresh rate', () => {
    expect(goalFps({ gameId: G, targetFps: 60, display: false }, 165)).toBe(60);
    expect(goalFps({ gameId: G, targetFps: null, display: true }, 165)).toBe(165);
    expect(goalFps({ gameId: G, targetFps: null, display: true }, null)).toBeNull();
    expect(goalFps(null, 60)).toBeNull();

    const a = entry(9, { fpsAvg: 70, frameTimeHistogram: hist });
    const b = entry(8, { fpsAvg: 70, frameTimeHistogram: null });
    const c = entry(7, { fpsAvg: 70, frameTimeHistogram: hist });
    const goal = { gameId: G, targetFps: null, display: true };
    const s = goalSeries([c, b, a], G, goal, extras([[a, { displayHz: 50 }], [b, { displayHz: 60 }]]));
    expect(s.points.map((p) => [p.id, p.targetFps, p.share])).toEqual([[a.id, 50, 0.95]]);
    expect([s.noHistogram, s.noDisplayRate]).toEqual([1, 1]);
    expect(sessionGoal(a, { gameId: G, targetFps: 50, display: false }, new Map())).toMatchObject({ share: 0.95, exact: true });
  });

  it('reads a trend against the median of earlier sessions', () => {
    const p = (share: number, i: number) => ({ id: String(i), startMs: i, targetFps: 60, share, exact: false });
    expect(goalTrend([])).toBeNull();
    expect(goalTrend([p(0.9, 1), p(0.8, 2)])!.direction).toBe('unknown');
    const worse = goalTrend([0.95, 0.93, 0.96, 0.94, 0.81].map(p))!;
    expect(worse.typical).toBeCloseTo(0.945);
    expect(worse.direction).toBe('worse');
    expect(goalTrend([0.95, 0.93, 0.96, 0.96].map(p))!.direction).toBe('steady');
  });

  it('formats shares honestly', () => {
    expect([formatShare(0.92), formatShare(0.92, false), formatShare(0.9996), formatShare(0.004), formatShare(1), formatShare(0)]).toEqual(['92%', 'about 92%', 'over 99%', 'under 1%', '100%', '0%']);
  });
});

describe('battery against plugged in', () => {
  it('classifies sessions by the source they spent 90% of their time on', () => {
    expect(powerClass(ac)).toBe('ac');
    expect(powerClass(bat)).toBe('battery');
    expect(powerClass({ ...ac, acSeconds: 3000, batterySeconds: 600 })).toBe('mixed');
    expect(powerClass({ ...ac, acSeconds: 0, unknownSeconds: 3600 })).toBeNull();
    expect(powerClass(null)).toBeNull();
  });

  it('compares medians per game and needs three measured sessions on each side', () => {
    const plugged = [80, 82, 78].map((f, i) => entry(30 - i, { fpsAvg: f, fps1Low: f * 0.7, gpuTempAvgC: 74 }));
    const onBattery = [50, 47, 52].map((f, i) => entry(20 - i, { fpsAvg: f, fps1Low: f * 0.6, gpuTempAvgC: 63 }));
    const mixed = entry(5, { fpsAvg: 65 });
    const x = extras([
      ...plugged.map((e) => [e, { power: ac }] as [TrendEntry, Partial<PerfSessionExtra>]),
      ...onBattery.map((e, i) => [e, { power: i === 0 ? { ...bat, saverSeconds: 3600, mode: 'batterySaver' as const } : bat }] as [TrendEntry, Partial<PerfSessionExtra>]),
      [mixed, { power: { ...ac, acSeconds: 1800, batterySeconds: 1800 } }],
    ]);
    const [c] = batteryComparisons([...plugged, ...onBattery, mixed], x);
    expect(c.enough).toBe(true);
    expect([c.ac.fpsAvg, c.battery.fpsAvg, c.ac.tempC, c.battery.tempC]).toEqual([80, 50, 74, 63]);
    expect([c.battery.saverSessions, c.battery.mode, c.mixed]).toEqual([1, 'betterBattery', 1]);

    const few = batteryComparisons([...plugged, onBattery[0]], x)[0];
    expect(few.enough).toBe(false);
    expect(batteryComparisons(plugged, x)).toEqual([]); // never on battery: nothing to compare
  });

  it('median ignores missing values', () => {
    expect(median([3, NaN, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});
