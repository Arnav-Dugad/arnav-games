import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarDays, MessageSquareText, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { call, errorMessage } from '../../bridge/bridge';
import type { WeeklyRecapCard as Recap } from '../../bridge/types';
import { weekRange } from '../../lib/assistantExtras';
import { formatDuration } from '../../lib/format';
import { pick, spring } from '../../lib/motion';
import { useReducedMotion, useStore } from '../../state/store';
import { Button, IconButton, Skeleton } from '../ui/primitives';
import './assistant-extras.css';

/**
 * Track E1: the full weekly recap, opened from the Sunday notification (or its in-app toast). Computed on this PC from
 * tracked sessions; nothing here needs an AI. "Talk about it" hands the week to the Assistant.
 */
export function WeeklyRecapCard({ week, onAsk, onClose }: { week: string; onAsk: (prompt: string) => void; onClose: () => void }) {
  const reduce = useReducedMotion();
  const navigate = useStore((s) => s.navigate);
  const [data, setData] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    call<Recap>('assistant.recap.get', { week }).then((r) => alive && setData(r)).catch((err) => alive && setError(errorMessage(err)));
    return () => { alive = false; };
  }, [week]);

  const range = data ? weekRange(data.from, data.to) : '';
  const top = data?.topGames[0]?.seconds ?? 1;
  const diff = data ? data.totalSeconds - data.previousWeekSeconds : 0;
  return (
    <motion.section
      className="asx-recap surface"
      aria-labelledby="asx-recap-title"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pick(reduce, spring.panel)}
    >
      <header className="asx-recap__head">
        <span className="asx-recap__icon" aria-hidden><CalendarDays size={18} /></span>
        <div>
          <span className="caps">Weekly recap{data && !data.finished ? ' · so far' : ''}</span>
          <h2 id="asx-recap-title" className="asx-recap__title">{data ? `Your week in games · ${range}` : 'Your week in games'}</h2>
        </div>
        <IconButton size="sm" label="Close the recap" onClick={onClose}><X size={16} /></IconButton>
      </header>
      {error && <p className="asx-recap__error" role="alert">{error}</p>}
      {!data && !error && <div aria-busy="true"><Skeleton height={20} width="60%" /><Skeleton height={110} radius={14} /></div>}
      {data && data.totalSeconds <= 0 && (
        <p className="asx-recap__empty">No tracked play that week. When you play, VYSTRAL sums up your week here, from this PC only.</p>
      )}
      {data && data.totalSeconds > 0 && (
        <>
          <dl className="asx-recap__stats">
            <div><dt>Played</dt><dd className="num">{formatDuration(data.totalSeconds)}</dd></div>
            <div><dt>Days</dt><dd className="num">{data.daysPlayed} of 7</dd></div>
            <div><dt>Sessions</dt><dd className="num">{data.sessions}</dd></div>
            <div>
              <dt>Vs last week</dt>
              <dd className="num" data-trend={data.previousWeekSeconds === 0 ? undefined : diff >= 0 ? 'up' : 'down'}>
                {data.previousWeekSeconds === 0 ? 'No play then' : <>{diff >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />} {diff >= 0 ? '+' : '−'}{formatDuration(Math.abs(diff))}</>}
              </dd>
            </div>
          </dl>
          <h3 className="asx-recap__sub">Most played</h3>
          <ol className="asx-recap__games">
            {data.topGames.map((g, i) => (
              <li key={g.gameId}>
                <button type="button" className="asx-recap__game" onClick={() => navigate({ name: 'game', id: g.gameId })}>
                  <span className="asx-recap__name truncate">{g.title}</span>
                  <span className="asx-recap__bar" aria-hidden>
                    <motion.span style={{ originX: 0 }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: Math.max(0.04, g.seconds / top) }}
                      transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.1 + i * 0.07, ease: [0.16, 1, 0.3, 1] }} />
                  </span>
                  <span className="num asx-recap__time">{formatDuration(g.seconds)}</span>
                </button>
              </li>
            ))}
          </ol>
          <ul className="asx-recap__notes">
            {data.longest && <li>Longest session: <strong>{data.longest.title}</strong>, {formatDuration(data.longest.seconds)} on {new Date(`${data.longest.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}.</li>}
            {data.firstTime.length > 0 && <li><Sparkles size={13} aria-hidden /> New this week: {data.firstTime.join(', ')}.</li>}
          </ul>
        </>
      )}
      <footer className="asx-recap__foot">
        <span>From your tracked sessions on this PC.</span>
        {data && data.totalSeconds > 0 && (
          <Button size="sm" variant="secondary" icon={<MessageSquareText size={14} aria-hidden />} onClick={() => onAsk(`Give me my weekly recap for the week of ${range}`)}>
            Talk about it
          </Button>
        )}
      </footer>
    </motion.section>
  );
}
