/**
 * Track E3: the Performance page's Trends tab (thermal trends, frame-rate goals, battery against plugged in) and the
 * same insights on a game's page. The figures come from the sessions the page already has plus `perfInsights.context`
 * (driver, display refresh rate and power per session, and the goals).
 */
import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Game, Session } from '../../bridge/types';
import { Button, Skeleton } from '../../components/ui/primitives';
import { useStore } from '../../state/store';
import { parsePerfSummary } from './series';
import type { TrendEntry } from './trends';
import { BatteryCard, GoalCard, GoalsOverview, ThermalTrendCard } from './TrendCards';
import { usePerfInsights } from './usePerfInsights';

export function TrendsPanel({ entries, gamesById, gameId, onOpen, onPickGame }: {
  entries: TrendEntry[];
  gamesById: Map<string, Game>;
  /** The page's game filter (null = all games). */
  gameId: string | null;
  onOpen: (sessionId: string) => void;
  onPickGame: (gameId: string) => void;
}) {
  const pi = usePerfInsights();
  if (pi.status === 'loading' || pi.status === 'idle') {
    return (
      <div className="e3-trends" role="status" aria-label="Loading trends">
        <Skeleton height={320} radius={22} />
        <Skeleton height={220} radius={22} />
      </div>
    );
  }
  return (
    <div className="e3-trends">
      {pi.status === 'error' && (
        <div className="pf-notice surface" role="status">
          <p>Goals, drivers and power data couldn’t be loaded: {pi.error}</p>
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => void pi.reload()}>Try again</Button>
        </div>
      )}
      <ThermalTrendCard entries={entries} extras={pi.extras} gamesById={gamesById} gameId={gameId} onOpen={onOpen} />
      <div className="e3-trends__pair">
        {gameId ? (
          <GoalCard key={gameId} gameId={gameId} game={gamesById.get(gameId)} entries={entries} extras={pi.extras} goal={pi.goals.get(gameId) ?? null} onOpen={onOpen} showGame />
        ) : (
          <GoalsOverview entries={entries} extras={pi.extras} goals={pi.goals} gamesById={gamesById} onPickGame={onPickGame} />
        )}
        {pi.hasBattery && <BatteryCard entries={entries} extras={pi.extras} gamesById={gamesById} gameId={gameId} />}
      </div>
    </div>
  );
}

/** A game page's insights (on its Sessions tab): the goal, and a thermal trend or battery comparison when there is one. */
export function GamePerfInsights({ game, sessions }: { game: Game; sessions: Session[] }) {
  const pi = usePerfInsights();
  const navigate = useStore((s) => s.navigate);
  const gamesById = useStore((s) => s.gamesById);
  const entries = useMemo<TrendEntry[]>(() => {
    const out: TrendEntry[] = [];
    for (const s of sessions) {
      const summary = parsePerfSummary(s.perfSummary);
      const startMs = Date.parse(s.start);
      if (summary && s.end && Number.isFinite(startMs)) out.push({ id: s.id, gameId: s.gameId, startMs, summary, session: s });
    }
    return out;
  }, [sessions]);
  if (pi.status !== 'ready' || !entries.length) return null;
  const goal = pi.goals.get(game.id) ?? null;
  const measured = entries.some((e) => e.summary.fpsAvg != null);
  const open = (sessionId: string) => navigate({ name: 'performance', sessionId });
  return (
    <div className="e3-game-insights">
      {(measured || goal) && <GoalCard gameId={game.id} game={game} entries={entries} extras={pi.extras} goal={goal} onOpen={open} />}
      <ThermalTrendCard entries={entries} extras={pi.extras} gamesById={gamesById} gameId={game.id} onOpen={open} hideWhenEmpty />
      {pi.hasBattery && <BatteryCard entries={entries} extras={pi.extras} gamesById={gamesById} gameId={game.id} hideWhenEmpty />}
    </div>
  );
}
