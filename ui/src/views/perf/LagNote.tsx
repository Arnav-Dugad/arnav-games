import { useEffect, useState } from 'react';
import { Cpu, Flame, Gauge, Hourglass, Layers, MonitorCog, Timer, Waves, Zap } from 'lucide-react';
import { call, on } from '../../bridge/bridge';
import type { LagCause, LagNote as Note, PerfSummary } from '../../bridge/types';
import { sessionHealth } from './overview';
import '../../components/assistant/assistant-extras.css';
import { APP_NAME } from '../../lib/brand';

const ICON: Record<LagCause, typeof Cpu> = {
  heat: Flame, power: Zap, shaders: Layers, timer: Timer, cpu: Cpu, gpu: MonitorCog, waiting: Hourglass, background: Waves, uneven: Gauge,
};

// One note per session for the life of the page (the app caches them on disk too).
const cache = new Map<string, Note>();
const inflight = new Map<string, Promise<Note | null>>();
let subscribed = false;
const listeners = new Set<(n: Note) => void>();

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  on('perf.lagNote', (n) => {
    if (!n?.sessionId) return;
    cache.set(n.sessionId, n);
    for (const l of listeners) l(n);
  });
}

function load(sessionId: string): Promise<Note | null> {
  const hit = cache.get(sessionId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(sessionId);
  if (!p) {
    p = call<Note>('perf.lagNote', { sessionId }, 30_000)
      .then((n) => { cache.set(sessionId, n); return n; })
      .catch(() => null)
      .finally(() => inflight.delete(sessionId));
    inflight.set(sessionId, p);
  }
  return p;
}

/** Test hook. */
export function __clearLagNotes() {
  cache.clear();
}

/**
 * Track E1: "Why did this session lag?" — on a session the Performance page calls Rough, one line with the likely
 * cause, from Arnav Games' own frame-time analysis (or worded by the AI, when Settings › AI › Lag note wording is on).
 * Always labelled, and it never changes anything. Renders nothing for smooth or unmeasured sessions.
 */
export function LagNote({ sessionId, summary, durationSeconds, compact }: {
  sessionId: string;
  summary: PerfSummary | null;
  durationSeconds: number;
  compact?: boolean;
}) {
  const rough = !!summary && sessionHealth(summary, durationSeconds).level === 'rough';
  const [note, setNote] = useState<Note | null>(() => cache.get(sessionId) ?? null);

  useEffect(() => {
    subscribe();
    const l = (n: Note) => { if (n.sessionId === sessionId) setNote(n); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [sessionId]);

  useEffect(() => {
    if (!rough) { setNote(null); return; }
    let alive = true;
    setNote(cache.get(sessionId) ?? null);
    void load(sessionId).then((n) => { if (alive) setNote(n); });
    return () => { alive = false; };
  }, [sessionId, rough]);

  if (!rough || !note?.rough || !note.text) return null;
  const Icon = ICON[note.cause ?? 'uneven'] ?? Gauge;
  const by = note.source === 'ai' && note.aiLabel ? `Worded by ${note.aiLabel.split(' · ').pop()} from ${APP_NAME}’ analysis` : 'From Arnav Games’ frame-time analysis';
  // Compact notes sit inside session buttons, so they're phrasing content (spans), not a paragraph.
  const Tag = compact ? 'span' : 'p';
  return (
    <Tag className="lag-note" data-compact={compact || undefined} data-cause={note.cause ?? undefined} title={compact ? `${note.text} ${by}. Nothing was changed.` : undefined}>
      <span className="lag-note__icon" aria-hidden><Icon size={compact ? 12 : 14} /></span>
      <span className="lag-note__body">
        <span className="lag-note__label">Why it lagged:</span>{' '}
        <span className="lag-note__text">{note.text}</span>
        {!compact && <span className="lag-note__by"> {by}. Nothing was changed.</span>}
        {compact && <span className="visually-hidden"> {by}. Nothing was changed.</span>}
      </span>
    </Tag>
  );
}
