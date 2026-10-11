/**
 * Track E2a: the "Completed 100%" ceremony — a short cinematic moment when you mark a game Completed 100%. This file
 * is the pure part: what the moment says (hours, the time from your first session to now, achievements when known)
 * and the "once per game" memory. Only real numbers: anything Arnav Games doesn't know is left out, never guessed.
 */
import type { AchievementProgress, Game, Session } from '../bridge/types';
import { formatDuration, playSeconds } from './format';
import { calendarSpan, spanWords } from './waiting';

export interface CeremonyFacts {
  /** "112h", from tracked time or the store's playtime (whichever is larger); null when there is none. */
  hours: string | null;
  seconds: number;
  /** Where the first-to-now span starts: your first session Arnav Games saw, else when Arnav Games first saw the game. */
  since: { at: Date; kind: 'firstSession' | 'added' } | null;
  /** "2 years 3 months" from `since` to now. */
  span: string | null;
  /** Steam achievements when known (total > 0). */
  achievements: { unlocked: number; total: number; ratio: number } | null;
}

const valid = (iso: string | null | undefined, now: number): Date | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now + 86_400_000 && t > Date.UTC(1990, 0, 1) ? new Date(Math.min(t, now)) : null;
};

export function ceremonyFacts(game: Game, sessions: readonly Pick<Session, 'gameId' | 'start'>[], achievements: AchievementProgress | null, now = Date.now()): CeremonyFacts {
  const seconds = playSeconds(game);
  let first: Date | null = null;
  for (const s of sessions) {
    if (s.gameId !== game.id) continue;
    const d = valid(s.start, now);
    if (d && (!first || d < first)) first = d;
  }
  const added = valid(game.added, now);
  const since = first ? { at: first, kind: 'firstSession' as const } : added ? { at: added, kind: 'added' as const } : null;
  const span = since ? calendarSpan(since.at, new Date(now)) : null;
  const total = achievements && Number.isFinite(achievements.total) ? Math.max(0, Math.floor(achievements.total)) : 0;
  const unlocked = achievements && Number.isFinite(achievements.unlocked) ? Math.min(total, Math.max(0, Math.floor(achievements.unlocked))) : 0;
  return {
    hours: seconds >= 60 ? formatDuration(seconds, { short: true }) : null,
    seconds,
    since,
    span: span && span.totalDays >= 1 ? spanWords(span) : null,
    achievements: total > 0 ? { unlocked, total, ratio: unlocked / total } : null,
  };
}

/** One line for screen readers and the saved image's caption. */
export function ceremonySummary(title: string, f: CeremonyFacts): string {
  const parts = [`${title}: completed 100%`];
  if (f.hours) parts.push(`${f.hours} played`);
  if (f.span && f.since) parts.push(f.since.kind === 'firstSession' ? `${f.span} since your first session` : `${f.span} in your library`);
  if (f.achievements) parts.push(`${f.achievements.unlocked} of ${f.achievements.total} achievements`);
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------- once per game

export const CELEBRATED_KEY = 'vystral.celebrated100';
const MAX_REMEMBERED = 4000;
/** When storage isn't available the moment still plays only once in this session. */
const memory = new Set<string>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(CELEBRATED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.length <= 64) : [];
  } catch {
    return [];
  }
}

export function hasCelebrated(gameId: string): boolean {
  return memory.has(gameId) || read().includes(gameId);
}

/** Remembers the game; returns false when it was already celebrated (the moment never plays twice). */
export function markCelebrated(gameId: string): boolean {
  if (hasCelebrated(gameId)) return false;
  memory.add(gameId);
  try {
    const list = read();
    list.push(gameId);
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify(list.slice(-MAX_REMEMBERED)));
  } catch {
    // kept in memory for this session
  }
  return true;
}
