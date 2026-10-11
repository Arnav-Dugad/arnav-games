/**
 * Track E3: the session extras (driver, display refresh, power) and frame-rate goals, shared by the Performance page and
 * game pages. One copy for the whole app: loaded on first use, again after each session ends, and updated in place
 * when a goal changes.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { call, errorMessage, on } from '../../bridge/bridge';
import type { PerfGoal, PerfInsightContext, PerfSessionExtra } from '../../bridge/types';

interface Snapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: PerfInsightContext | null;
  error: string | null;
}

let snap: Snapshot = { status: 'idle', data: null, error: null };
const listeners = new Set<() => void>();
let seq = 0;
let unsubscribe: (() => void) | null = null;

function set(next: Snapshot) {
  snap = next;
  listeners.forEach((l) => l());
}

async function load() {
  const mine = ++seq;
  if (snap.status === 'idle' || snap.status === 'error') set({ ...snap, status: 'loading' });
  try {
    const data = await call<PerfInsightContext>('perfInsights.context');
    if (mine === seq) set({ status: 'ready', data: sanitize(data), error: null });
  } catch (err) {
    if (mine === seq) set({ status: snap.data ? 'ready' : 'error', data: snap.data, error: errorMessage(err) });
  }
}

/** Defensive: the page only trusts well-formed rows. */
function sanitize(d: PerfInsightContext | null | undefined): PerfInsightContext {
  return {
    hasBattery: d?.hasBattery === true,
    onBattery: typeof d?.onBattery === 'boolean' ? d.onBattery : null,
    sessions: Array.isArray(d?.sessions) ? d!.sessions.filter((s) => typeof s?.sessionId === 'string') : [],
    goals: Array.isArray(d?.goals) ? d!.goals.filter((g) => typeof g?.gameId === 'string') : [],
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!unsubscribe) {
    unsubscribe = on('launch.state', (e) => {
      if (e.phase === 'ended' && e.sessionId) void load();
    });
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export interface PerfInsights {
  status: Snapshot['status'];
  error: string | null;
  hasBattery: boolean;
  extras: ReadonlyMap<string, PerfSessionExtra>;
  goals: ReadonlyMap<string, PerfGoal>;
  reload: () => Promise<void>;
}

const EMPTY_EXTRAS = new Map<string, PerfSessionExtra>();
const EMPTY_GOALS = new Map<string, PerfGoal>();

export function usePerfInsights(): PerfInsights {
  const s = useSyncExternalStore(subscribe, () => snap);
  useEffect(() => {
    if (snap.status === 'idle') void load();
  }, []);
  const extras = useMemo(() => (s.data ? new Map(s.data.sessions.map((x) => [x.sessionId, x])) : EMPTY_EXTRAS), [s.data]);
  const goals = useMemo(() => (s.data ? new Map(s.data.goals.map((g) => [g.gameId, g])) : EMPTY_GOALS), [s.data]);
  // A PC that once recorded battery time counts as one with a battery, even if Windows doesn't report it right now.
  const hasBattery = !!s.data && (s.data.hasBattery || s.data.sessions.some((x) => (x.power?.batterySeconds ?? 0) > 0));
  return { status: s.status, error: s.error, hasBattery, extras, goals, reload: load };
}

/** Saves a game's goal (null clears it) and updates every view. Throws the bridge error for the caller to show. */
export async function saveGoal(gameId: string, goal: { targetFps: number | null; display: boolean } | null): Promise<PerfGoal | null> {
  const saved = await call<PerfGoal | null>('perfInsights.setGoal', { gameId, targetFps: goal?.display ? null : goal?.targetFps ?? null, display: goal?.display ?? false });
  const data = snap.data ?? { hasBattery: false, onBattery: null, sessions: [], goals: [] };
  const goals = data.goals.filter((g) => g.gameId !== gameId);
  if (saved && typeof saved.gameId === 'string') goals.push(saved);
  seq++; // a reload in flight would bring back the old goal
  set({ status: 'ready', data: { ...data, goals }, error: null });
  return saved;
}

/** For tests: forget the cached copy. */
export function resetPerfInsights() {
  seq++;
  snap = { status: 'idle', data: null, error: null };
}
