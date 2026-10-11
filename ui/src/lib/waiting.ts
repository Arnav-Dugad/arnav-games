/**
 * Track E2a: how long something has been going on, in calendar terms ("2 years 3 months"), for the wishlist's
 * "on your list for …" and the Completed 100% ceremony's "… from first play to 100%". Calendar months, not 30-day
 * blocks: 31 January to 28 February is not yet a month, 15 March to 15 April is one.
 */
import type { WishlistItem } from '../bridge/types';

export interface CalendarSpan {
  years: number;
  /** 0..11 */
  months: number;
  /** Days after the last whole month. */
  days: number;
  totalDays: number;
}

const DAY = 86_400_000;

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Whole years, months and days from `from` to `to` (local calendar). Null when `to` is before `from`. */
export function calendarSpan(from: Date, to: Date): CalendarSpan | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() < from.getTime()) return null;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // The month isn't complete until the same day of the month (or the month's last day, for the 31st in a short month).
  const anchorDay = (y: number, m: number) => Math.min(from.getDate(), daysInMonth(y, m));
  if (to.getDate() < anchorDay(to.getFullYear(), to.getMonth())) months--;
  months = Math.max(0, months);
  const anchorMonth = new Date(from.getFullYear(), from.getMonth() + months, 1);
  const anchor = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), anchorDay(anchorMonth.getFullYear(), anchorMonth.getMonth()));
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOf(to) - startOf(anchor)) / DAY));
  return { years: Math.floor(months / 12), months: months % 12, days, totalDays: Math.max(0, Math.round((startOf(to) - startOf(from)) / DAY)) };
}

const unit = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** "2 years 3 months", "1 year", "11 months", "3 weeks", "5 days", "1 day", "less than a day". */
export function spanWords(s: CalendarSpan): string {
  if (s.years > 0) return s.months > 0 ? `${unit(s.years, 'year')} ${unit(s.months, 'month')}` : unit(s.years, 'year');
  if (s.months > 0) return unit(s.months, 'month');
  if (s.days >= 14) return unit(Math.floor(s.days / 7), 'week');
  if (s.days >= 1) return unit(s.days, 'day');
  return 'less than a day';
}

/** A short form for tight places: "2 yr 3 mo", "11 mo", "3 wk", "5 d". */
export function spanShort(s: CalendarSpan): string {
  if (s.years > 0) return s.months > 0 ? `${s.years} yr ${s.months} mo` : `${s.years} yr`;
  if (s.months > 0) return `${s.months} mo`;
  if (s.days >= 14) return `${Math.floor(s.days / 7)} wk`;
  return `${Math.max(1, s.days)} d`;
}

/** A plausible "added" time: a real date, not in the future (a day of clock slack), not before Steam wishlists existed. */
function addedAt(iso: string | null | undefined, now: Date): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > now.getTime() + DAY || t < Date.UTC(2003, 0, 1)) return null;
  return new Date(Math.min(t, now.getTime()));
}

export interface Waiting {
  span: CalendarSpan;
  /** "2 years 3 months" */
  words: string;
  /** "2 yr 3 mo" */
  short: string;
  /** "On your list for 2 years 3 months" (or "Added today"). */
  sentence: string;
  since: Date;
}

/** How long a wishlisted game has been on your list; null when Steam didn't say when it was added. */
export function waitingFor(item: Pick<WishlistItem, 'added'>, now = new Date()): Waiting | null {
  const since = addedAt(item.added, now);
  if (!since) return null;
  const span = calendarSpan(since, now);
  if (!span) return null;
  const words = spanWords(span);
  return { span, words, short: spanShort(span), sentence: span.totalDays === 0 ? 'Added to your list today' : `On your list for ${words}`, since };
}

/** Longest waiting first; games without a date last, in your wishlist order. */
export function sortByWaiting<T extends Pick<WishlistItem, 'added' | 'priority' | 'name'>>(items: readonly T[]): T[] {
  const at = (i: T) => {
    const t = i.added ? Date.parse(i.added) : NaN;
    return Number.isFinite(t) ? t : Infinity;
  };
  return [...items].sort((a, b) => at(a) - at(b) || (a.priority || 1e9) - (b.priority || 1e9) || a.name.localeCompare(b.name));
}

/** The longest wait on the list, and how many games have waited a year or more. */
export function waitingSummary(items: readonly Pick<WishlistItem, 'added' | 'name'>[], now = new Date()): { longest: { name: string; waiting: Waiting } | null; overAYear: number } {
  let longest: { name: string; waiting: Waiting } | null = null;
  let overAYear = 0;
  for (const i of items) {
    const w = waitingFor(i, now);
    if (!w) continue;
    if (w.span.years >= 1) overAYear++;
    if (!longest || w.since.getTime() < longest.waiting.since.getTime()) longest = { name: i.name, waiting: w };
  }
  return { longest, overAYear };
}
