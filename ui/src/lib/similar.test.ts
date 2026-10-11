import { describe, expect, it } from 'vitest';
import type { Game, Installation, LibraryTags } from '../bridge/types';
import { awaySpan, explainShared, libraryIdf, normTitle, seriesKey, similarInLibrary, tagKind } from './similar';
import { FORZA_LIBRARY, forzaFixture, RACERS } from './similar.fixture';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function inst(over: Partial<Installation> = {}): Installation {
  return {
    id: Math.random().toString(16).slice(2), platform: 'steam', platformGameId: '1', title: 't', state: 'installed', installPath: null,
    drive: null, sizeBytes: null, clientRequired: true, launchKind: 'Uri', importedLastPlayed: null, importedPlaytimeMinutes: 0,
    userLaunchArgs: null, manualLink: false, lastSeen: daysAgo(0), ...over,
  };
}
function game(id: string, over: Partial<Game> = {}): Game {
  return {
    id, title: id, sortTitle: id.toLowerCase(), description: null, developer: null, publisher: null, releaseDate: null, genres: [],
    favorite: false, hidden: false, userRating: null, notes: null, preferredInstallationId: null, metadataSource: null, palette: null,
    art: { cover: null, hero: null, logo: null, header: null, icon: null }, installations: [inst()], collections: [], trackedSeconds: 3600,
    sessionCount: 1, lastTrackedPlay: daysAgo(3), added: daysAgo(400), ...over,
  } as Game;
}
const TAGS = { 1: 'Open World', 2: 'Racing', 3: 'Driving', 4: 'Multiplayer', 5: 'Horror', 6: 'Atmospheric' } as const;
function tags(games: Record<string, number[]>): LibraryTags {
  return { status: 'ok', message: null, tags: Object.entries(TAGS).map(([id, name]) => ({ id: Number(id), name, count: 1 })), games, covered: 0, steamGames: 0, refreshing: false, fetchedAt: null };
}

describe('similar in your library', () => {
  it('ranks by shared community tags and explains the pick with the strongest ones', () => {
    const me = game('Forza Horizon 5', { genres: ['Racing'] });
    const a = game('Dirt Rally', { genres: ['Racing'], lastTrackedPlay: daysAgo(5) });
    const b = game('Silent Halls', { genres: ['Horror'] });
    const picks = similarInLibrary(me, [me, a, b], { tags: tags({ [me.id]: [1, 2, 3, 4], [a.id]: [3, 2, 6], [b.id]: [5, 6] }), now: NOW });
    expect(picks.map((p) => p.game.id)).toEqual(['Dirt Rally']);
    // Strongest shared first: Driving leads Dirt Rally's list, Racing is second in both.
    expect(picks[0].why).toBe('Shares Driving · Racing');
  });

  it('lifts forgotten games (never played, or not for months) and says so', () => {
    const me = game('Me', { genres: ['Racing', 'Open World'] });
    const recent = game('Recent', { genres: ['Racing', 'Open World'], lastTrackedPlay: daysAgo(2) });
    const old = game('Old', { genres: ['Racing', 'Open World'], lastTrackedPlay: daysAgo(245) });
    const never = game('Never', { genres: ['Racing', 'Open World'], trackedSeconds: 0, sessionCount: 0, lastTrackedPlay: null });
    const picks = similarInLibrary(me, [recent, old, never], { now: NOW });
    expect(picks.map((p) => p.game.id)).toEqual(['Never', 'Old', 'Recent']);
    expect(picks[0].why).toBe('Shares Racing · Open World · never played');
    expect(picks[1].why).toBe('Shares Racing · Open World · not played in 8 months');
    expect(picks[1].forgotten).toBe('long');
    expect(picks[2].forgotten).toBeNull();
  });

  it('finds the same series from titles and IGDB facts', () => {
    expect(seriesKey('Forza Horizon 4: Ultimate Edition')).toBe('forza horizon');
    expect(seriesKey('Forza Horizon 5')).toBe('forza horizon');
    expect(seriesKey('Mass Effect II - Remastered')).toBe('mass effect');
    expect(seriesKey('Ys')).toBeNull();
    const me = game('Forza Horizon 5');
    const sibling = game('Forza Horizon 4: Ultimate Edition');
    const viaIgdb = game('The Witcher 3: Wild Hunt');
    const listed = game('Gran Turismo Sport');
    const picks = similarInLibrary(me, [sibling, viaIgdb, listed], { facts: { series: ['The Witcher series'], similar: ['Gran Turismo Sport'] }, now: NOW });
    expect(picks.map((p) => p.game.id)).toEqual([sibling.id, viaIgdb.id, listed.id]);
    expect(picks[0].why).toBe('Same series');
    expect(picks[2].why).toBe('IGDB calls it similar');
  });

  it('leaves out the game itself, other editions with the same title, hidden and refunded games, and weak matches', () => {
    const me = game('Nebula Drift', { genres: ['Racing', 'Sci-fi'] });
    const picks = similarInLibrary(me, [
      me,
      game('nebula drift', { id: 'other-edition', genres: ['Racing', 'Sci-fi'] }),
      game('Hidden', { genres: ['Racing', 'Sci-fi'], hidden: true }),
      game('Refunded', { genres: ['Racing', 'Sci-fi'], notOwned: true }),
      game('One loose genre', { genres: ['Sci-fi'] }),
      game('Generic only', { genres: ['Action', 'Indie'] }),
    ], { now: NOW });
    expect(picks).toEqual([]);
  });

  it('without tags, one shared genre from the game’s own family is enough (a non-Steam racer for a racer)', () => {
    const me = game('Nebula Drift', { genres: ['Racing', 'Sci-fi'] });
    const picks = similarInLibrary(me, [game('Circuit Apex', { genres: ['Racing', 'Sports'] }), game('Last Signal', { genres: ['Horror', 'Sci-fi'] })], { now: NOW });
    expect(picks.map((p) => p.game.id)).toEqual(['Circuit Apex']);
    expect(picks[0].why).toBe('Shares Racing');
  });

  it('is fast on a big library', () => {
    const lib = Array.from({ length: 10_000 }, (_, i) => game(`G${i}`, { genres: [['Racing', 'RPG', 'Puzzle'][i % 3], 'Sci-fi'] }));
    const t0 = performance.now();
    const picks = similarInLibrary(game('Me', { genres: ['Racing', 'Sci-fi'] }), lib, { now: NOW, limit: 12 });
    expect(performance.now() - t0).toBeLessThan(250);
    expect(picks).toHaveLength(12);
  });

  it('is fast with tags on a big library too', () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    const games: Record<string, number[]> = {};
    const lib = Array.from({ length: 10_000 }, (_, i) => {
      const g = game(`T${i}`);
      games[g.id] = Array.from({ length: 15 }, (_, k) => ids[(i * 7 + k * 13) % ids.length]);
      return g;
    });
    const t: LibraryTags = { status: 'ok', message: null, tags: ids.map((id) => ({ id, name: `Tag ${id}`, count: 1 })), games, covered: 0, steamGames: 0, refreshing: false, fetchedAt: null };
    const t0 = performance.now();
    similarInLibrary(lib[0], lib, { tags: t, now: NOW, limit: 12 });
    expect(performance.now() - t0).toBeLessThan(400);
  });

  it('leaves generic genres out of the reason and doesn’t pick on them alone', () => {
    const me = game('Me', { genres: ['Action', 'Adventure', 'Indie'] });
    expect(similarInLibrary(me, [game('Also generic', { genres: ['Action', 'Adventure', 'Indie'] })], { now: NOW })).toEqual([]);
    expect(explainShared(['Singleplayer', 'Racing', 'Open World'], ['Action', 'Racing'])).toEqual(['Racing', 'Open World']);
    expect(explainShared(['Singleplayer', 'Action'], [])).toEqual(['Singleplayer', 'Action']);
  });

  it('weights a tag by how rare it is in this library', () => {
    expect(libraryIdf(100, 100)).toBeCloseTo(Math.log(2));
    expect(libraryIdf(10, 100)).toBeCloseTo(Math.log(11));
    expect(libraryIdf(10, 100)).toBeGreaterThan(libraryIdf(80, 100) * 2.5);
    // A tiny library leans toward neutral.
    expect(libraryIdf(1, 2)).toBeLessThan(Math.log(3));
    expect(tagKind('Singleplayer')).toBe('generic');
    expect(tagKind('Open World')).toBe('soft');
    expect(tagKind('Driving')).toBe('specific');
    expect(tagKind('Automobile Sim')).toBe('specific');
  });

  describe('a realistic library (Steam tags in Steam’s order)', () => {
    const racer = new Set(RACERS);
    const { games, tags: libTags } = forzaFixture((title, i) => {
      const isRacer = racer.has(title) || title === 'Forza Horizon 4';
      // Racers were played recently (a small penalty); everything else was never played (a boost). Tags must still win.
      return game(title, {
        id: `g${String(i).padStart(2, '0')}`,
        sortTitle: title.toLowerCase(),
        ...(isRacer ? { lastTrackedPlay: daysAgo(3) } : { trackedSeconds: 0, sessionCount: 0, lastTrackedPlay: null }),
      });
    });
    const fh4 = games.find((g) => g.title === 'Forza Horizon 4')!;
    const picks = similarInLibrary(fh4, games, { tags: libTags, now: NOW, limit: 12 });
    const titles = picks.map((p) => p.game.title);

    it('ranks every racing and driving game above every generic adventure', () => {
      expect(Object.keys(FORZA_LIBRARY)).toHaveLength(34);
      expect(titles[0]).toBe('Forza Horizon 5');
      for (const r of RACERS) expect(titles).toContain(r);
      // Every pick is a racing or driving game (Rocket League and GTA V carry those tags too) …
      const drives = (t: string) => FORZA_LIBRARY[t].some((x) => x === 'Racing' || x === 'Driving');
      for (const t of titles) expect(drives(t)).toBe(true);
      // … and the dedicated racers come before the ones where driving is a side dish (GTA V lists Racing 11th).
      expect(titles.indexOf('Grand Theft Auto V')).toBeGreaterThan(Math.max(...RACERS.map((r) => titles.indexOf(r))));
    });

    it('leaves out games that only share generic tags', () => {
      for (const t of ['Blair Witch', 'Outlast', 'Firewatch', 'Life is Strange', 'Hollow Knight', 'Portal 2', 'Celeste', 'Tomb Raider', 'Uncharted: Legacy of Thieves Collection',
        'The Witcher 3: Wild Hunt', 'Red Dead Redemption 2', 'Subnautica', "Assassin's Creed Odyssey"])
        expect(titles).not.toContain(t);
    });

    it('names the specific tags it shares, never Singleplayer or Adventure', () => {
      const dirt = picks.find((p) => p.game.title === 'DiRT Rally 2.0')!;
      expect(dirt.why).toMatch(/^Shares Racing · (Driving · Automobile Sim|Automobile Sim · Driving)$/);
      for (const p of picks) expect(p.why).not.toMatch(/Singleplayer|Adventure|Action|Multiplayer/);
      expect(picks[0].why).toMatch(/^Same series · Shares Racing/);
    });

    it('still finds Blair Witch’s own kind for Blair Witch', () => {
      const bw = games.find((g) => g.title === 'Blair Witch')!;
      const mine = similarInLibrary(bw, games, { tags: libTags, now: NOW }).map((p) => p.game.title);
      expect(mine[0]).toBe('Outlast');
      expect(mine).not.toContain('Forza Horizon 5');
      expect(mine).not.toContain('DiRT Rally 2.0');
    });
  });

  it('says how long in plain words', () => {
    expect(normTitle('Café: Déjà-vu!')).toBe('cafe deja vu');
    expect(awaySpan(61)).toBe('2 months');
    expect(awaySpan(400)).toBe('a year');
    expect(awaySpan(800)).toBe('2 years');
  });
});
