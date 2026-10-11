import { beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../bridge/types';
import { CELEBRATED_KEY, ceremonyFacts, ceremonySummary, hasCelebrated, markCelebrated } from './ceremony';

const NOW = new Date(2026, 9, 11, 20).getTime();
function game(over: Partial<Game> = {}): Game {
  return {
    id: 'g1', title: 'Ashen Crown', sortTitle: 'ashen crown', genres: [], favorite: false, hidden: false, art: {}, installations: [],
    collections: [], trackedSeconds: 0, sessionCount: 0, lastTrackedPlay: null, added: new Date(2025, 0, 5).toISOString(), ...over,
  } as unknown as Game;
}

describe('Completed 100% ceremony', () => {
  beforeEach(() => localStorage.clear());

  it('says hours, the span since the first session, and achievements', () => {
    const g = game({ trackedSeconds: 112 * 3600 + 20 * 60 });
    const sessions = [
      { gameId: 'g1', start: new Date(2024, 6, 20).toISOString() },
      { gameId: 'g1', start: new Date(2024, 6, 11).toISOString() },
      { gameId: 'other', start: new Date(2019, 0, 1).toISOString() },
      { gameId: 'g1', start: 'garbage' },
    ];
    const f = ceremonyFacts(g, sessions, { unlocked: 48, total: 50, fetchedAt: null, rarestName: null, rarestPercent: null }, NOW);
    expect(f.hours).toBe('112h');
    expect(f.since).toEqual({ at: new Date(2024, 6, 11), kind: 'firstSession' });
    expect(f.span).toBe('2 years 3 months');
    expect(f.achievements).toEqual({ unlocked: 48, total: 50, ratio: 0.96 });
    expect(ceremonySummary(g.title, f)).toBe('Ashen Crown: completed 100%, 112h played, 2 years 3 months since your first session, 48 of 50 achievements.');
  });

  it('falls back honestly: store playtime, the date VYSTRAL first saw it, no achievements', () => {
    const g = game({ installations: [{ importedPlaytimeMinutes: 90 } as Game['installations'][number]] });
    const f = ceremonyFacts(g, [], null, NOW);
    expect(f.hours).toBe('1h 30m');
    expect(f.since?.kind).toBe('added');
    expect(f.span).toBe('1 year 9 months');
    expect(f.achievements).toBeNull();
    expect(ceremonySummary(g.title, f)).toBe('Ashen Crown: completed 100%, 1h 30m played, 1 year 9 months in your library.');
    // Nothing known at all.
    const bare = ceremonyFacts(game({ added: 'nope' }), [], { unlocked: 3, total: 0, fetchedAt: null, rarestName: null, rarestPercent: null }, NOW);
    expect(bare).toMatchObject({ hours: null, since: null, span: null, achievements: null });
    // Impossible achievement counts are clamped.
    expect(ceremonyFacts(game(), [], { unlocked: 80, total: 50, fetchedAt: null, rarestName: null, rarestPercent: null }, NOW).achievements?.ratio).toBe(1);
  });

  it('plays once per game, remembered across starts', () => {
    expect(hasCelebrated('a')).toBe(false);
    expect(markCelebrated('a')).toBe(true);
    expect(markCelebrated('a')).toBe(false);
    expect(JSON.parse(localStorage.getItem(CELEBRATED_KEY)!)).toEqual(['a']);
    localStorage.setItem(CELEBRATED_KEY, '{broken');
    expect(hasCelebrated('a')).toBe(true); // still remembered in this session
    expect(markCelebrated('b')).toBe(true);
  });
});
