import { describe, expect, it } from 'vitest';
import { calendarSpan, sortByWaiting, spanShort, spanWords, waitingFor, waitingSummary } from './waiting';

const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);
const words = (a: Date, b: Date) => spanWords(calendarSpan(a, b)!);

describe('years waiting', () => {
  it('counts calendar years, months and days', () => {
    expect(calendarSpan(d(2024, 7, 11), d(2026, 10, 11))).toMatchObject({ years: 2, months: 3, days: 0 });
    expect(calendarSpan(d(2024, 7, 12), d(2026, 10, 11))).toMatchObject({ years: 2, months: 2, days: 29 });
    expect(calendarSpan(d(2026, 10, 11), d(2026, 10, 11))).toMatchObject({ years: 0, months: 0, days: 0, totalDays: 0 });
    expect(calendarSpan(d(2026, 10, 12), d(2026, 10, 11))).toBeNull();
  });

  it('handles month ends and leap days', () => {
    // 31 January → 28 February is a whole month (February has no 31st).
    expect(calendarSpan(d(2026, 1, 31), d(2026, 2, 28))).toMatchObject({ months: 1, days: 0 });
    expect(calendarSpan(d(2026, 1, 31), d(2026, 2, 27))).toMatchObject({ months: 0, days: 27 });
    // 29 February 2024 → 28 February 2025 is a year.
    expect(calendarSpan(d(2024, 2, 29), d(2025, 2, 28))).toMatchObject({ years: 1, months: 0, days: 0 });
    // Across a daylight-saving change the day count stays whole.
    expect(calendarSpan(d(2026, 3, 1, 0), d(2026, 3, 31, 23))!.days).toBe(30);
  });

  it('says it in plain words', () => {
    expect(words(d(2024, 7, 11), d(2026, 10, 11))).toBe('2 years 3 months');
    expect(words(d(2025, 10, 11), d(2026, 10, 11))).toBe('1 year');
    expect(words(d(2024, 9, 11), d(2026, 10, 11))).toBe('2 years 1 month');
    expect(words(d(2025, 11, 20), d(2026, 10, 11))).toBe('10 months');
    expect(words(d(2026, 9, 15), d(2026, 10, 11))).toBe('3 weeks');
    expect(words(d(2026, 10, 6), d(2026, 10, 11))).toBe('5 days');
    expect(words(d(2026, 10, 10), d(2026, 10, 11))).toBe('1 day');
    expect(words(d(2026, 10, 11, 1), d(2026, 10, 11, 20))).toBe('less than a day');
    expect(spanShort(calendarSpan(d(2024, 7, 11), d(2026, 10, 11))!)).toBe('2 yr 3 mo');
    expect(spanShort(calendarSpan(d(2026, 10, 6), d(2026, 10, 11))!)).toBe('5 d');
  });

  it('describes a wishlist entry, and ignores missing or impossible dates', () => {
    const now = d(2026, 10, 11);
    expect(waitingFor({ added: d(2024, 7, 11, 9).toISOString() }, now)?.sentence).toBe('On your list for 2 years 3 months');
    expect(waitingFor({ added: d(2026, 10, 11, 8).toISOString() }, now)?.sentence).toBe('Added to your list today');
    expect(waitingFor({ added: null }, now)).toBeNull();
    expect(waitingFor({ added: 'not a date' }, now)).toBeNull();
    expect(waitingFor({ added: d(2027, 1, 1).toISOString() }, now)).toBeNull();
    expect(waitingFor({ added: '1999-01-01T00:00:00Z' }, now)).toBeNull();
    // A few hours ahead (clock skew) counts as today rather than vanishing.
    expect(waitingFor({ added: new Date(now.getTime() + 3_600_000).toISOString() }, now)?.span.totalDays).toBe(0);
  });

  it('sorts longest waiting first and sums up the list', () => {
    const now = d(2026, 10, 11);
    const items = [
      { name: 'New', added: d(2026, 9, 1).toISOString(), priority: 1 },
      { name: 'Undated', added: null, priority: 2 },
      { name: 'Oldest', added: d(2021, 3, 5).toISOString(), priority: 3 },
      { name: 'Middle', added: d(2025, 1, 5).toISOString(), priority: 4 },
    ];
    expect(sortByWaiting(items).map((i) => i.name)).toEqual(['Oldest', 'Middle', 'New', 'Undated']);
    const s = waitingSummary(items, now);
    expect(s.longest?.name).toBe('Oldest');
    expect(s.longest?.waiting.words).toBe('5 years 7 months');
    expect(s.overAYear).toBe(2);
    expect(waitingSummary([], now)).toEqual({ longest: null, overAYear: 0 });
  });
});
