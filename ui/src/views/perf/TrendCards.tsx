/**
 * Track E3: performance insights as cards — a GPU running hotter than it used to (thermal trend), frame-rate goals
 * measured from each session's frame-time histogram, battery against plugged in, and notes after a GPU driver change.
 * Used on the Performance page (Trends and System tabs, Overview banner, session strip) and on game pages.
 * Read-only: every suggestion is something the player does themselves; nothing here changes a setting.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, BarChart3, BatteryCharging, BatteryMedium, Cpu, Flame, Info, PlugZap, Snowflake, Table2, Target, Thermometer, TrendingDown, TrendingUp,
} from 'lucide-react';
import { errorMessage } from '../../bridge/bridge';
import type { Game, PerfGoal } from '../../bridge/types';
import { Badge, Button, SectionHead, Segmented } from '../../components/ui/primitives';
import { plural } from '../../lib/format';
import { spring } from '../../lib/motion';
import { useReducedMotion, useStore } from '../../state/store';
import { GameThumb } from './kit';
import { gameTitle, shortDate } from './text';
import { niceTicks } from './series';
import { TrendChart, type ChartPoint } from './TrendChart';
import {
  BATTERY_MIN_SIDE, COOLING_TIPS, bucketOf, GOAL_MAX, GOAL_MIN, GOAL_PRESETS, POWER_MODE_LABEL, THERMAL, batteryComparisons, driverNoteText, driverNotes,
  driverWithinNoise, formatShare, goalLabel, goalSeries, goalTrend, relChange, sessionGoal, signed, thermalTrend, thermalTrends,
  type BatteryComparison, type DriverNote, type Extras, type GoalPoint, type ThermalTrend, type TrendEntry,
} from './trends';
import { saveGoal } from './usePerfInsights';
import './trends.css';

const fmtDateTime = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
const fmtDate = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ms);
const round = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)));

/* ================================================================== thermal */

/** The Overview's one-line alert when a game runs clearly hotter than it used to. Renders nothing otherwise. */
export function ThermalAlertBanner({ entries, extras, gamesById, onShow }: { entries: TrendEntry[]; extras: Extras; gamesById: Map<string, Game>; onShow: () => void }) {
  const hot = useMemo(() => thermalTrends(entries, extras).filter((t) => t.direction === 'hotter'), [entries, extras]);
  if (!hot.length) return null;
  const t = hot[0];
  return (
    <div className="e3-banner surface" role="status">
      <span className="e3-banner__icon" aria-hidden><Flame size={16} /></span>
      <p>
        <strong>Your GPU runs {Math.round(t.deltaC)} °C hotter in {gameTitle(gamesById.get(t.gameId))}</strong> than in the months before, at a similar load
        {hot.length > 1 ? <> — and in {plural(hot.length - 1, 'other game')}</> : null}.
      </p>
      <Button size="sm" variant="ghost" icon={<ArrowRight size={14} />} onClick={onShow}>See why</Button>
    </div>
  );
}

/** Thermal trends for one game (`gameId`) or every game. `hideWhenEmpty` renders nothing without a trend (game pages). */
export function ThermalTrendCard({ entries, extras, gamesById, gameId, onOpen, hideWhenEmpty }: {
  entries: TrendEntry[];
  extras: Extras;
  gamesById: Map<string, Game>;
  gameId?: string | null;
  onOpen?: (id: string) => void;
  hideWhenEmpty?: boolean;
}) {
  const titleId = useId();
  const trends = useMemo(() => {
    if (gameId) {
      const t = thermalTrend(entries, gameId, extras);
      return t ? [t] : [];
    }
    return thermalTrends(entries, extras);
  }, [entries, extras, gameId]);
  const hasTemps = useMemo(() => entries.some((e) => (gameId ? e.gameId === gameId : true) && e.summary.gpuTempAvgC != null), [entries, gameId]);
  if (hideWhenEmpty && !trends.length) return null;
  const lead = trends[0];
  const rest = trends.slice(1);

  return (
    <section className="surface vx-card e3-card" aria-labelledby={titleId}>
      <SectionHead
        title={<span id={titleId}><Thermometer size={16} aria-hidden className="e3-title-icon" />GPU temperature over time</span>}
        meta="The same game at a similar load, this month against the months before"
      />
      {lead ? (
        <>
          <ThermalLead t={lead} game={gamesById.get(lead.gameId)} showGame={!gameId} onOpen={onOpen} />
          {rest.length > 0 && (
            <ul className="e3-rows" aria-label="Other games">
              {rest.map((t) => (
                <li key={t.gameId} className="e3-row">
                  <GameThumb game={gamesById.get(t.gameId)} size={26} />
                  <span className="e3-row__title truncate">{gameTitle(gamesById.get(t.gameId))}</span>
                  <ThermalVerdict t={t} />
                </li>
              ))}
            </ul>
          )}
          <p className="e3-foot">
            <Info size={13} aria-hidden />
            <span>
              Medians of each session’s average GPU temperature, from sessions of ten minutes or more, plugged in, within {THERMAL.loadBand} points of the game’s usual GPU load.
              Arnav Games can’t measure the room’s temperature, so a hot week shows up here too.
            </span>
          </p>
        </>
      ) : (
        <p className="e3-muted">
          {hasTemps
            ? `Not enough to compare yet. A trend needs ${THERMAL.minSessions} sessions of ten minutes or more in the same game in the last month, and ${THERMAL.minSessions} from the three months before, at a similar GPU load and plugged in.`
            : 'GPU temperature hasn’t been recorded. It needs an NVIDIA graphics card and driver; other GPUs don’t report it to Arnav Games.'}
        </p>
      )}
    </section>
  );
}

function ThermalVerdict({ t }: { t: ThermalTrend }) {
  const Icon = t.direction === 'hotter' ? Flame : t.direction === 'cooler' ? Snowflake : Thermometer;
  const word = t.direction === 'hotter' ? `${Math.round(t.deltaC)} °C hotter` : t.direction === 'cooler' ? `${Math.round(-t.deltaC)} °C cooler` : 'Steady';
  return (
    <span className="e3-verdict" data-direction={t.direction}>
      <Icon size={13} aria-hidden />
      <strong>{word}</strong>
      <span className="e3-verdict__detail num">{Math.round(t.earlierC)} → {Math.round(t.recentC)} °C</span>
    </span>
  );
}

function ThermalLead({ t, game, showGame, onOpen }: { t: ThermalTrend; game: Game | undefined; showGame: boolean; onOpen?: (id: string) => void }) {
  const [table, setTable] = useState(false);
  const reduce = useReducedMotion();
  const title = gameTitle(game);
  const temps = t.points.map((p) => p.tempC);
  const domain = niceTicks(Math.floor((Math.min(...temps) - 3) / 5) * 5, Math.ceil((Math.max(...temps) + 3) / 5) * 5, 3);
  const points: ChartPoint[] = t.points.map((p) => ({
    id: p.id, t: p.startMs, v: p.tempC, tone: p.side === 'recent' ? 'main' : 'muted',
    tip: (
      <span className="e3-tip__body">
        <span className="e3-tip__when">{fmtDateTime(p.startMs)}</span>
        <span><strong className="num">{Math.round(p.tempC)} °C</strong> average GPU temperature</span>
        <span className="e3-tip__sub">GPU load {Math.round(p.load)}% · {p.side === 'recent' ? 'last 30 days' : 'the months before'}</span>
      </span>
    ),
    readout: `${fmtDateTime(p.startMs)}: ${Math.round(p.tempC)} °C average, GPU load ${Math.round(p.load)}%, ${p.side === 'recent' ? 'last 30 days' : 'the months before'}.`,
  }));
  const first = t.points[0]?.startMs ?? t.recentFrom;
  const lastMs = t.points[t.points.length - 1]?.startMs ?? t.recentFrom;
  const headline =
    t.direction === 'hotter'
      ? <>Your GPU runs <strong>{Math.round(t.deltaC)} °C hotter</strong>{showGame ? <> in <strong>{title}</strong></> : null} than in the months before.</>
      : t.direction === 'cooler'
        ? <>Your GPU runs <strong>{Math.round(-t.deltaC)} °C cooler</strong>{showGame ? <> in <strong>{title}</strong></> : null} than in the months before.</>
        : <>GPU temperature{showGame ? <> in <strong>{title}</strong></> : null} is <strong>steady</strong>: within {THERMAL.alertC} °C of the months before.</>;
  const summary = `Average GPU temperature per session${showGame ? ` in ${title}` : ''}: typically ${Math.round(t.recentC)} °C over the last 30 days (${t.recentSessions} sessions) against ${Math.round(t.earlierC)} °C before (${t.earlierSessions} sessions).`;

  return (
    <motion.div className="e3-thermal" data-direction={t.direction} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.panel}>
      <div className="e3-thermal__head">
        {showGame && <GameThumb game={game} size={34} />}
        <p className="e3-headline">{headline}</p>
      </div>
      <div className="e3-figures">
        <Figure label="Last 30 days" value={`${Math.round(t.recentC)} °C`} sub={`Median of ${plural(t.recentSessions, 'session')}${t.recentLoad != null ? ` · GPU ${Math.round(t.recentLoad)}%` : ''}`} />
        <Figure label="The months before" value={`${Math.round(t.earlierC)} °C`} sub={`Median of ${plural(t.earlierSessions, 'session')}${t.earlierLoad != null ? ` · GPU ${Math.round(t.earlierLoad)}%` : ''}`} />
        <Figure label="Change" value={`${signed(t.deltaC)} °C`} tone={t.direction === 'hotter' ? 'warn' : undefined} />
      </div>
      <div className="e3-chart-head">
        <ul className="pf-legend e3-legend" aria-label="Sessions">
          <li><span className="e3-swatch e3-swatch--muted" aria-hidden />The months before</li>
          <li><span className="e3-swatch e3-swatch--temp" aria-hidden />Last 30 days</li>
        </ul>
        <Button size="sm" variant="ghost" icon={table ? <BarChart3 size={14} /> : <Table2 size={14} />} aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? 'Show as chart' : 'Show as table'}
        </Button>
      </div>
      {table ? (
        <div className="e3-table-wrap" tabIndex={0} role="region" aria-label="GPU temperature per session, as a table">
          <table className="e3-table">
            <thead><tr><th scope="col">Session</th><th scope="col">Average GPU temperature</th><th scope="col">GPU load</th><th scope="col">Period</th></tr></thead>
            <tbody>
              {t.points.slice().reverse().map((p) => (
                <tr key={p.id}>
                  <th scope="row">{onOpen ? <button type="button" className="e3-link" onClick={() => onOpen(p.id)}>{fmtDateTime(p.startMs)}</button> : fmtDateTime(p.startMs)}</th>
                  <td className="num">{Math.round(p.tempC)} °C</td>
                  <td className="num">{Math.round(p.load)}%</td>
                  <td>{p.side === 'recent' ? 'Last 30 days' : 'Before'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TrendChart
          kind="dots"
          series="temp"
          points={points}
          domain={domain}
          fmtTick={(v) => `${v}°`}
          fmtX={(ms) => shortDate(ms)}
          refs={[
            { from: first, to: Math.min(lastMs, t.recentFrom), v: t.earlierC, label: `${Math.round(t.earlierC)} °C`, tone: 'muted' },
            { from: Math.max(first, t.recentFrom), to: lastMs, v: t.recentC, label: `${Math.round(t.recentC)} °C`, tone: 'main' },
          ]}
          label={summary}
          onOpen={onOpen}
        />
      )}
      {t.direction === 'hotter' && (
        <div className="e3-tips">
          <span className="e3-h3">Worth trying</span>
          <ul>
            {COOLING_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
          <p className="e3-muted e3-tips__note">Arnav Games never changes fan speeds, clocks or power limits.</p>
        </div>
      )}
      {(t.leftOut.battery > 0 || t.leftOut.load > 0) && (
        <p className="e3-muted e3-leftout">
          Left out:{t.leftOut.load > 0 ? ` ${plural(t.leftOut.load, 'session')} at a different GPU load` : ''}
          {t.leftOut.load > 0 && t.leftOut.battery > 0 ? ',' : ''}
          {t.leftOut.battery > 0 ? ` ${plural(t.leftOut.battery, 'session')} on battery` : ''}.
        </p>
      )}
    </motion.div>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'ok' }) {
  return (
    <div className="e3-figure" data-tone={tone}>
      <span className="caps">{label}</span>
      <span className="e3-figure__value">{value}</span>
      {sub && <span className="e3-figure__sub">{sub}</span>}
    </div>
  );
}

/* ================================================================== goals */

type GoalChoice = 'off' | '30' | '60' | '120' | '144' | 'display' | 'custom';

function choiceOf(goal: PerfGoal | null | undefined): GoalChoice {
  if (!goal) return 'off';
  if (goal.display) return 'display';
  return (GOAL_PRESETS as readonly number[]).includes(goal.targetFps ?? -1) ? (String(goal.targetFps) as GoalChoice) : 'custom';
}

/** A game's frame-rate goal: the picker, the latest session's result, the trend and a column per session. */
export function GoalCard({ gameId, game, entries, extras, goal, onOpen, showGame }: {
  gameId: string;
  game: Game | undefined;
  entries: TrendEntry[];
  extras: Extras;
  goal: PerfGoal | null;
  onOpen?: (id: string) => void;
  showGame?: boolean;
}) {
  const titleId = useId();
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);
  const [custom, setCustom] = useState<string>(() => (goal && !goal.display && choiceOf(goal) === 'custom' ? String(goal.targetFps) : ''));
  const [pending, setPending] = useState<GoalChoice | null>(null);
  const [table, setTable] = useState(false);
  const choice = pending ?? choiceOf(goal);
  const series = useMemo(() => goalSeries(entries, gameId, goal, extras), [entries, gameId, goal, extras]);
  const shown = series.points.slice(-24);
  const trend = useMemo(() => goalTrend(series.points), [series.points]);
  const measured = useMemo(() => entries.some((e) => e.gameId === gameId && e.summary.fpsAvg != null), [entries, gameId]);
  const anyEstimate = shown.some((p) => !p.exact);
  const fixedBudget = goal && !goal.display && goal.targetFps ? 1000 / goal.targetFps : null;
  const bucket = fixedBudget ? bucketOf(fixedBudget) : null;

  const save = async (next: { targetFps: number | null; display: boolean } | null, label: string) => {
    try {
      await saveGoal(gameId, next);
      setPending(null);
      toast({ tone: 'success', title: next ? `Goal set: ${label}` : 'Goal removed', body: next ? `${gameTitle(game)} sessions are now measured against it.` : undefined });
    } catch (err) {
      setPending(null);
      toast({ tone: 'danger', title: 'Goal not saved', body: errorMessage(err) });
    }
  };
  const pick = (c: GoalChoice) => {
    if (c === 'custom') {
      setPending('custom');
      return;
    }
    setPending(c);
    if (c === 'off') void save(null, 'off');
    else if (c === 'display') void save({ targetFps: null, display: true }, 'the display’s refresh rate');
    else void save({ targetFps: Number(c), display: false }, `${c} fps`);
  };
  const customValue = Number(custom);
  const customValid = Number.isInteger(customValue) && customValue >= GOAL_MIN && customValue <= GOAL_MAX;

  const points: ChartPoint[] = shown.map((p) => ({
    id: p.id, t: p.startMs, v: p.share * 100, tone: 'main',
    tip: (
      <span className="e3-tip__body">
        <span className="e3-tip__when">{fmtDateTime(p.startMs)}</span>
        <span><strong>{formatShare(p.share, p.exact)}</strong> of frames at {p.targetFps} fps or better</span>
        <span className="e3-tip__sub">Within {(1000 / p.targetFps).toFixed(1)} ms per frame{p.exact ? '' : ' · estimated'}</span>
      </span>
    ),
    readout: `${fmtDateTime(p.startMs)}: ${formatShare(p.share, p.exact)} of frames at ${p.targetFps} fps or better.`,
  }));

  return (
    <section className="surface vx-card e3-card" aria-labelledby={titleId}>
      <SectionHead
        title={
          <span id={titleId} className="e3-goal-title">
            <Target size={16} aria-hidden className="e3-title-icon" />
            {showGame ? <><span>Frame-rate goal ·&nbsp;</span><span className="truncate">{gameTitle(game)}</span></> : <span>Frame-rate goal</span>}
          </span>
        }
        meta="How often each session kept up"
      />
      <div className="e3-goal-picker">
        <Segmented<GoalChoice>
          value={choice}
          label={`Frame-rate goal for ${gameTitle(game)}`}
          onChange={pick}
          options={[
            { value: 'off', label: 'Off' },
            ...GOAL_PRESETS.map((f) => ({ value: String(f) as GoalChoice, label: `${f}` })),
            { value: 'display', label: 'Display' },
            { value: 'custom', label: 'Other' },
          ]}
        />
        {choice === 'custom' && (
          <form
            className="e3-goal-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) void save({ targetFps: customValue, display: false }, `${customValue} fps`);
            }}
          >
            <label className="e3-goal-custom__field">
              <span className="visually-hidden">Target frame rate</span>
              <input
                className="input num"
                type="number"
                inputMode="numeric"
                min={GOAL_MIN}
                max={GOAL_MAX}
                step={1}
                value={custom}
                placeholder="90"
                aria-invalid={custom !== '' && !customValid}
                aria-describedby={`${titleId}-custom-hint`}
                onChange={(e) => setCustom(e.target.value.slice(0, 3))}
              />
              <span aria-hidden>fps</span>
            </label>
            <Button size="sm" type="submit" disabled={!customValid}>Set goal</Button>
            <span id={`${titleId}-custom-hint`} className="e3-muted">{GOAL_MIN}–{GOAL_MAX} fps</span>
          </form>
        )}
      </div>

      {!goal ? (
        <p className="e3-muted">
          Pick a target to see how often each {gameTitle(game)} session kept up with it — for example 60 fps, or your display’s refresh rate.
          It’s measured from the frame times Arnav Games records{measured ? '' : ' while frame-rate capture is on'}.
        </p>
      ) : !measured ? (
        <div className="e3-empty">
          <p className="e3-muted">No session of {gameTitle(game)} has frame-rate data yet. With frame-rate capture on, the next one is measured against your {goalLabel(goal)} goal.</p>
          <Button size="sm" onClick={() => navigate({ name: 'settings', section: 'launching' })}>Frame-rate capture settings</Button>
        </div>
      ) : !series.points.length ? (
        <p className="e3-muted">
          {series.noDisplayRate > 0 && series.noHistogram === 0
            ? 'The display’s refresh rate wasn’t recorded for these sessions, so they can’t be measured against it. Pick a fixed frame rate instead.'
            : 'These sessions were recorded before Arnav Games kept frame-time histograms, so they can’t be measured. Your next session will be.'}
        </p>
      ) : (
        <>
          <GoalHeadline trend={trend!} />
          <div className="e3-chart-head">
            <span className="e3-muted">Share of frames that met the goal, per session</span>
            <Button size="sm" variant="ghost" icon={table ? <BarChart3 size={14} /> : <Table2 size={14} />} aria-pressed={table} onClick={() => setTable((v) => !v)}>
              {table ? 'Show as chart' : 'Show as table'}
            </Button>
          </div>
          {table ? (
            <div className="e3-table-wrap" tabIndex={0} role="region" aria-label="Frame-rate goal per session, as a table">
              <table className="e3-table">
                <thead><tr><th scope="col">Session</th><th scope="col">Goal</th><th scope="col">Frames that met it</th></tr></thead>
                <tbody>
                  {shown.slice().reverse().map((p) => (
                    <tr key={p.id}>
                      <th scope="row">{onOpen ? <button type="button" className="e3-link" onClick={() => onOpen(p.id)}>{fmtDateTime(p.startMs)}</button> : fmtDateTime(p.startMs)}</th>
                      <td className="num">{p.targetFps} fps</td>
                      <td>{formatShare(p.share, p.exact)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <TrendChart
              kind="columns"
              series="goal"
              points={points}
              domain={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100] }}
              height={170}
              fmtTick={(v) => `${v}%`}
              fmtX={(ms) => shortDate(ms)}
              label={`Share of frames that met the ${goalLabel(goal)} goal in each of the last ${plural(shown.length, `${gameTitle(game)} session`)}. Latest: ${formatShare(trend!.latest.share, trend!.latest.exact)}.`}
              onOpen={onOpen}
            />
          )}
          <p className="e3-foot">
            <Info size={13} aria-hidden />
            <span>
              Counted from each session’s frame-time histogram: a frame meets {goal.display ? 'the display’s rate' : `${goal.targetFps} fps`} when it took{' '}
              {fixedBudget ? `${fixedBudget.toFixed(1)} ms` : 'one refresh'} or less.
              {anyEstimate
                ? ` ${bucket ? `That falls inside the ${bucket} bucket, so` : 'Where the limit falls inside a bucket,'} the share is estimated, assuming frames in that bucket are spread evenly.`
                : ' The limit falls on a bucket edge, so these shares are exact.'}
              {series.noHistogram > 0 ? ` ${plural(series.noHistogram, 'older session')} without a histogram ${series.noHistogram === 1 ? 'isn’t' : 'aren’t'} shown.` : ''}
              {series.noDisplayRate > 0 ? ` ${plural(series.noDisplayRate, 'session')} didn’t record the display’s refresh rate.` : ''}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

function GoalHeadline({ trend }: { trend: NonNullable<ReturnType<typeof goalTrend>> }) {
  const { latest, typical, deltaPts, direction } = trend;
  const Icon = direction === 'better' ? TrendingUp : direction === 'worse' ? TrendingDown : Target;
  return (
    <div className="e3-figures">
      <Figure label="Latest session" value={formatShare(latest.share, latest.exact)} sub={<>of frames at {latest.targetFps} fps or better · {shortDate(latest.startMs)}</>} />
      <Figure label="Typical" value={typical == null ? '—' : formatShare(typical, latest.exact)} sub={typical == null ? 'After three more sessions' : 'Median of the sessions before'} />
      <div className="e3-figure" data-direction={direction}>
        <span className="caps">Trend</span>
        <span className="e3-figure__value e3-trendword"><Icon size={16} aria-hidden />{direction === 'better' ? 'Better' : direction === 'worse' ? 'Worse' : direction === 'steady' ? 'Steady' : 'Too early'}</span>
        <span className="e3-figure__sub">
          {deltaPts == null ? 'Needs three earlier sessions' : direction === 'steady' ? 'Within 3 points of usual' : `${signed(deltaPts)} points against usual`}
        </span>
      </div>
    </div>
  );
}

/** Games with a goal (newest session first), for the Trends tab when no single game is picked. */
export function GoalsOverview({ entries, extras, goals, gamesById, onPickGame }: {
  entries: TrendEntry[];
  extras: Extras;
  goals: ReadonlyMap<string, PerfGoal>;
  gamesById: Map<string, Game>;
  onPickGame: (gameId: string) => void;
}) {
  const titleId = useId();
  const rows = useMemo(() => {
    const out: { gameId: string; goal: PerfGoal; latest: GoalPoint | null; typical: number | null; direction: string }[] = [];
    for (const [gameId, goal] of goals) {
      if (!entries.some((e) => e.gameId === gameId)) continue;
      const t = goalTrend(goalSeries(entries, gameId, goal, extras).points);
      out.push({ gameId, goal, latest: t?.latest ?? null, typical: t?.typical ?? null, direction: t?.direction ?? 'unknown' });
    }
    return out.sort((a, b) => (b.latest?.startMs ?? 0) - (a.latest?.startMs ?? 0));
  }, [entries, extras, goals]);
  const measuredGames = useMemo(() => {
    const ids = new Set(entries.filter((e) => e.summary.fpsAvg != null).map((e) => e.gameId));
    return [...ids].filter((id) => !goals.has(id)).map((id) => ({ id, title: gameTitle(gamesById.get(id)) })).sort((a, b) => a.title.localeCompare(b.title));
  }, [entries, goals, gamesById]);

  return (
    <section className="surface vx-card e3-card" aria-labelledby={titleId}>
      <SectionHead title={<span id={titleId}><Target size={16} aria-hidden className="e3-title-icon" />Frame-rate goals</span>} meta="Set one per game · measured from frame times" />
      {rows.length > 0 ? (
        <ul className="e3-rows" aria-label="Games with a goal">
          {rows.map((r) => (
            <li key={r.gameId} className="e3-row e3-row--goal">
              <GameThumb game={gamesById.get(r.gameId)} size={26} />
              <span className="e3-row__title truncate">{gameTitle(gamesById.get(r.gameId))}</span>
              <Badge>{goalLabel(r.goal)}</Badge>
              <span className="e3-row__figure">{r.latest ? `${formatShare(r.latest.share, r.latest.exact)} latest` : 'Not measured yet'}</span>
              <Button size="sm" variant="ghost" icon={<ArrowRight size={14} />} onClick={() => onPickGame(r.gameId)} aria-label={`Open the ${gameTitle(gamesById.get(r.gameId))} goal`}>Open</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="e3-muted">No goals yet. Pick a game to set one — for example 60 fps, or your display’s refresh rate — and see how often each session met it.</p>
      )}
      {measuredGames.length > 0 && (
        <label className="e3-pick">
          <span className="caps">Set a goal for</span>
          <select className="input vx-select" value="" onChange={(e) => e.target.value && onPickGame(e.target.value)}>
            <option value="">Choose a game…</option>
            {measuredGames.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

/* ================================================================== battery */

/** On battery against plugged in, per game. Only for PCs with a battery (the caller decides). */
export function BatteryCard({ entries, extras, gamesById, gameId, hideWhenEmpty }: {
  entries: TrendEntry[];
  extras: Extras;
  gamesById: Map<string, Game>;
  gameId?: string | null;
  hideWhenEmpty?: boolean;
}) {
  const titleId = useId();
  const list = useMemo(() => batteryComparisons(gameId ? entries.filter((e) => e.gameId === gameId) : entries, extras), [entries, extras, gameId]);
  const anyPower = useMemo(() => entries.some((e) => extras.get(e.id)?.power), [entries, extras]);
  if (hideWhenEmpty && !list.length) return null;
  return (
    <section className="surface vx-card e3-card" aria-labelledby={titleId}>
      <SectionHead
        title={<span id={titleId}><BatteryMedium size={16} aria-hidden className="e3-title-icon" />On battery and plugged in</span>}
        meta="Medians per game"
      />
      {list.length ? (
        <div className="e3-battery-list">
          {list.slice(0, gameId ? 1 : 4).map((c) => <BatteryView key={c.gameId} c={c} game={gamesById.get(c.gameId)} showGame={!gameId} />)}
          <p className="e3-foot">
            <Info size={13} aria-hidden />
            <span>
              Laptops limit power on battery by design, so lower frame rates are expected. A session counts when at least 90% of it was on one source; mixed sessions are left out.
              Comparisons need {BATTERY_MIN_SIDE} sessions with frame-rate data on each side.
            </span>
          </p>
        </div>
      ) : (
        <p className="e3-muted">
          {anyPower
            ? 'No game has been played on battery yet. When one is, its frame rate and temperature on battery are compared with plugged in here.'
            : 'Arnav Games records whether your PC is plugged in or on battery from your next session on (read-only, from Windows). Play a game on battery and plugged in to compare them.'}
        </p>
      )}
    </section>
  );
}

function BatteryView({ c, game, showGame }: { c: BatteryComparison; game: Game | undefined; showGame: boolean }) {
  const title = gameTitle(game);
  const rows: { label: string; unit: string; ac: number | null; battery: number | null; bar: boolean }[] = [
    { label: 'Average FPS', unit: 'fps', ac: c.ac.fpsAvg, battery: c.battery.fpsAvg, bar: true },
    { label: '1% low', unit: 'fps', ac: c.ac.fps1Low, battery: c.battery.fps1Low, bar: true },
    { label: 'GPU temperature', unit: '°C', ac: c.ac.tempC, battery: c.battery.tempC, bar: false },
  ];
  const maxFps = Math.max(1, ...rows.filter((r) => r.bar).flatMap((r) => [r.ac ?? 0, r.battery ?? 0]));
  const need = { battery: Math.max(0, BATTERY_MIN_SIDE - c.battery.fpsSessions), ac: Math.max(0, BATTERY_MIN_SIDE - c.ac.fpsSessions) };
  const fpsDrop = relChange(c.ac.fpsAvg, c.battery.fpsAvg);
  return (
    <div className="e3-battery">
      {showGame && (
        <div className="e3-battery__head">
          <GameThumb game={game} size={30} />
          <span className="e3-row__title truncate">{title}</span>
          <span className="e3-muted">{plural(c.ac.sessions, 'session')} plugged in · {c.battery.sessions} on battery</span>
        </div>
      )}
      {c.enough ? (
        <>
          <p className="e3-headline">
            On battery, {title} runs at <strong>{round(c.battery.fpsAvg)} fps</strong> against <strong>{round(c.ac.fpsAvg)} fps</strong> plugged in
            {fpsDrop != null && Math.abs(fpsDrop) >= 3 ? <> ({fpsDrop < 0 ? `${Math.round(-fpsDrop)}% slower` : `${Math.round(fpsDrop)}% faster`})</> : null}.
          </p>
          <ul className="pf-legend e3-legend" aria-label="Power source">
            <li><span className="e3-swatch e3-swatch--ac" aria-hidden />Plugged in</li>
            <li><span className="e3-swatch e3-swatch--battery" aria-hidden />On battery</li>
          </ul>
          <table className="e3-table e3-compare">
            <caption className="visually-hidden">{title}: medians on battery and plugged in</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col"><PlugZap size={13} aria-hidden /> Plugged in</th><th scope="col"><BatteryCharging size={13} aria-hidden /> On battery</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td><BarValue v={r.ac} unit={r.unit} max={r.bar ? maxFps : null} tone="ac" /></td>
                  <td><BarValue v={r.battery} unit={r.unit} max={r.bar ? maxFps : null} tone="battery" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="e3-muted">
          Not enough to compare yet: {need.battery > 0 ? `${plural(need.battery, 'more session')} on battery` : ''}{need.battery > 0 && need.ac > 0 ? ' and ' : ''}
          {need.ac > 0 ? `${plural(need.ac, 'more session')} plugged in` : ''}, with frame-rate data.
        </p>
      )}
      {(c.battery.mode || c.battery.saverSessions > 0) && (
        <p className="e3-muted e3-battery__mode">
          <Cpu size={13} aria-hidden />
          <span>
            {c.battery.mode ? <>On battery, Windows was mostly in <strong>{POWER_MODE_LABEL[c.battery.mode]}</strong> mode</> : 'On battery'}
            {c.battery.saverSessions > 0 ? <>; battery saver was on for {c.battery.saverSessions} of {plural(c.battery.sessions, 'session')}</> : null}
            {c.ac.mode ? <>. Plugged in: {POWER_MODE_LABEL[c.ac.mode]}.</> : '.'}
          </span>
        </p>
      )}
    </div>
  );
}

function BarValue({ v, unit, max, tone }: { v: number | null; unit: string; max: number | null; tone: 'ac' | 'battery' }) {
  const reduce = useReducedMotion();
  if (v == null) return <span className="e3-muted">—</span>;
  return (
    <span className="e3-barvalue">
      {max != null && (
        <span className="e3-bar" aria-hidden>
          <motion.span className="e3-bar__fill" data-tone={tone} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: Math.max(0.02, v / max) }} transition={reduce ? { duration: 0 } : spring.panel} />
        </span>
      )}
      <span className="num">{Math.round(v)} {unit}</span>
    </span>
  );
}

/* ================================================================== driver notes */

/** Notes after GPU driver changes: the first session of each game on the new driver against the sessions before. */
export function DriverNotesCard({ entries, extras, gamesById, gameId, onOpen, hideWhenEmpty }: {
  entries: TrendEntry[];
  extras: Extras;
  gamesById: Map<string, Game>;
  gameId?: string | null;
  onOpen?: (id: string) => void;
  hideWhenEmpty?: boolean;
}) {
  const titleId = useId();
  const notes = useMemo(() => driverNotes(gameId ? entries.filter((e) => e.gameId === gameId) : entries, extras), [entries, extras, gameId]);
  const anyDriver = useMemo(() => entries.some((e) => extras.get(e.id)?.driver), [entries, extras]);
  if (hideWhenEmpty && !notes.length) return null;
  return (
    <section className="surface vx-card e3-card" aria-labelledby={titleId}>
      <SectionHead title={<span id={titleId}><Info size={16} aria-hidden className="e3-title-icon" />Driver update notes</span>} meta="The first session after each change" />
      {notes.length ? (
        <ul className="e3-notes" aria-label="Driver update notes, newest first">
          {notes.slice(0, 6).map((n) => <DriverNoteItem key={n.sessionId} n={n} game={gamesById.get(n.gameId)} onOpen={onOpen} />)}
        </ul>
      ) : (
        <p className="e3-muted">
          {anyDriver
            ? 'No driver change yet with frame-rate data on both sides. After your GPU driver updates, the first session of each game you played before gets a short note here.'
            : 'Arnav Games records the graphics driver with each session. After it changes, the first session of each game gets a short note here.'}
        </p>
      )}
    </section>
  );
}

function DriverNoteItem({ n, game, onOpen }: { n: DriverNote; game: Game | undefined; onOpen?: (id: string) => void }) {
  const title = gameTitle(game);
  const noise = driverWithinNoise(n);
  return (
    <li className="e3-note">
      <GameThumb game={game} size={30} />
      <div className="e3-note__body">
        <span className="e3-note__title">
          Driver <span className="num">{n.driver}</span>: {driverNoteText(n, title)}
        </span>
        <span className="e3-muted">
          {fmtDate(n.atMs)} · first session on {n.driver}, against {n.beforeSessions === 1 ? 'the last session' : `the median of the last ${n.beforeSessions}`} on {n.previousDriver}
          {noise ? ' · within normal variation' : n.beforeSessions < 3 ? ' · small sample' : ''}
        </span>
      </div>
      {onOpen && (
        <Button size="sm" variant="ghost" icon={<ArrowRight size={14} />} onClick={() => onOpen(n.sessionId)} aria-label={`Open the ${title} session from ${fmtDateTime(n.atMs)}`}>
          Open
        </Button>
      )}
    </li>
  );
}

/* ================================================================== one session */

/** A line of chips for one session: its goal result, its driver note, and the game's thermal trend. Nothing without any. */
export function SessionInsightStrip({ entry, entries, extras, goal, onShowTrends }: {
  entry: TrendEntry;
  entries: TrendEntry[];
  extras: Extras;
  goal: PerfGoal | null;
  onShowTrends?: () => void;
}) {
  const g = useMemo(() => sessionGoal(entry, goal, extras), [entry, goal, extras]);
  const note = useMemo(() => driverNotes(entries.filter((e) => e.gameId === entry.gameId), extras).find((n) => n.sessionId === entry.id) ?? null, [entries, entry, extras]);
  const thermal = useMemo(() => thermalTrend(entries, entry.gameId, extras), [entries, entry.gameId, extras]);
  const hot = thermal?.direction === 'hotter' && thermal.points.some((p) => p.id === entry.id) ? thermal : null;
  if (!g && !note && !hot) return null;
  return (
    <div className="e3-strip" role="group" aria-label="Insights for this session">
      {g && (
        <span className="e3-chip" data-tone={g.share >= 0.9 ? 'ok' : g.share < 0.6 ? 'warn' : undefined}>
          <Target size={13} aria-hidden />
          Met {g.targetFps} fps for <strong>{formatShare(g.share, g.exact)}</strong> of frames
        </span>
      )}
      {note && (
        <span className="e3-chip">
          <Info size={13} aria-hidden />
          First session on driver <span className="num">{note.driver}</span>: {signed(note.fpsAvg - note.beforeAvg)} fps average
          {note.fps1Low != null && note.beforeLow != null ? <>, 1% lows {signed(note.fps1Low - note.beforeLow)} fps</> : null}
        </span>
      )}
      {hot && (
        <span className="e3-chip" data-tone="warn">
          <Flame size={13} aria-hidden />
          This game runs {Math.round(hot.deltaC)} °C hotter this month
          {onShowTrends && <button type="button" className="e3-link" onClick={onShowTrends}>See why</button>}
        </span>
      )}
    </div>
  );
}
