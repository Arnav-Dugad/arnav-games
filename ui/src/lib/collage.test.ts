import { describe, expect, it } from 'vitest';
import type { Game } from '../bridge/types';
import {
  buildCollage, collageCacheSize, collageLayout, collagePalette, collectionCollage, coverGames, parsePinnedCovers, serializePinnedCovers,
} from './collage';
import { parseOklch } from './color';

const id = (n: number) => n.toString(16).padStart(32, '0');
function game(n: number, over: Partial<Game> = {}): Game {
  return {
    id: id(n), title: `Game ${n}`, sortTitle: `game ${String(n).padStart(3, '0')}`, description: null, developer: null, publisher: null, releaseDate: null,
    genres: [], favorite: false, hidden: false, userRating: null, notes: null, preferredInstallationId: null, metadataSource: null, palette: null,
    art: { cover: `./art/${n}.jpg`, hero: null, logo: null, header: null, icon: null }, installations: [], collections: [], trackedSeconds: 0,
    sessionCount: 0, lastTrackedPlay: null, added: '2026-01-01T00:00:00Z', ...over,
  } as Game;
}
const area = (rects: { w: number; h: number }[]) => rects.reduce((s, r) => s + r.w * r.h, 0);

describe('collection cover layouts', () => {
  it('picks a layout for every size and always fills the frame without overlaps', () => {
    expect(collageLayout(0)).toEqual({ kind: 'empty', rects: [] });
    const kinds = [1, 2, 3, 4, 5, 9, 400].map((n) => collageLayout(n).kind);
    expect(kinds).toEqual(['single', 'duo', 'trio', 'quad', 'mosaic', 'mosaic', 'mosaic']);
    for (const n of [1, 2, 3, 4, 5]) {
      const { rects } = collageLayout(n);
      expect(rects).toHaveLength(n);
      expect(area(rects)).toBeCloseTo(100 * 100);
      for (const r of rects) {
        expect(r.x + r.w).toBeLessThanOrEqual(100);
        expect(r.y + r.h).toBeLessThanOrEqual(100);
      }
      // No two tiles overlap.
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          expect(overlap).toBe(0);
        }
    }
    // 1+2: one large tile beside two stacked ones.
    const trio = collageLayout(3).rects;
    expect(trio[0].h).toBe(100);
    expect(trio[1].h + trio[2].h).toBe(100);
  });

  it('shows games with art first, favourites and the most played before the rest, in a stable order', () => {
    const members = [
      game(1, { art: { cover: null, hero: null, logo: null, header: null, icon: null } }),
      game(2),
      game(3, { favorite: true }),
      game(4, { trackedSeconds: 50_000 }),
      game(5),
    ];
    const { games, pinned } = coverGames(members, null);
    expect(pinned).toBe(false);
    expect(games.map((g) => g.title)).toEqual(['Game 3', 'Game 4', 'Game 2', 'Game 5', 'Game 1']);
    expect(coverGames([...members].reverse(), null).games.map((g) => g.id)).toEqual(games.map((g) => g.id));
  });

  it('a pinned game becomes the whole cover; a pin that left the collection is ignored', () => {
    const members = [game(1), game(2), game(3), game(4)];
    const c = buildCollage('Couch co-op', members, id(3));
    expect(c.kind).toBe('single');
    expect(c.pinned).toBe(true);
    expect(c.tiles.map((t) => t.gameId)).toEqual([id(3)]);
    expect(c.more).toBe(0);
    const gone = buildCollage('Couch co-op', members, id(99));
    expect(gone.kind).toBe('quad');
    expect(gone.pinned).toBe(false);
  });

  it('a mosaic shows five games over a blurred wash and counts the rest', () => {
    const members = Array.from({ length: 12 }, (_, i) => game(i + 1));
    const c = buildCollage('Everything', members, null);
    expect(c.kind).toBe('mosaic');
    expect(c.tiles).toHaveLength(5);
    expect(c.wash).toBe(c.tiles[0].art);
    expect(c.more).toBe(7);
    expect(buildCollage('Empty', [], null)).toMatchObject({ kind: 'empty', tiles: [], more: 0 });
  });

  it('takes the dominant colour from the games’ artwork palettes, else from their titles', () => {
    const warm = (n: number) => game(n, { palette: JSON.stringify({ accent: 'oklch(0.700 0.150 40.0)' }) });
    const p = collagePalette([warm(1), warm(2), game(3, { palette: JSON.stringify({ accent: 'oklch(0.700 0.020 250.0)' }) })], 200);
    expect(p.hue).toBeGreaterThan(25);
    expect(p.hue).toBeLessThan(60);
    const a = parseOklch(p.a)!;
    expect(a[0]).toBeGreaterThanOrEqual(0.5);
    expect(a[0]).toBeLessThanOrEqual(0.72);
    // Hues wrap around: 350° and 10° average to about 0°, not 180°.
    const wrap = collagePalette([game(1, { palette: JSON.stringify({ accent: 'oklch(0.6 0.1 350)' }) }), game(2, { palette: JSON.stringify({ accent: 'oklch(0.6 0.1 10)' }) })], 120);
    expect(Math.min(wrap.hue, 360 - wrap.hue)).toBeLessThan(10);
    // Damaged stored palettes fall back to the title colour; no games uses the collection's own hue.
    expect(collagePalette([game(1, { palette: '{nope' })], 0).hue).toBeGreaterThanOrEqual(0);
    expect(collagePalette([], 123).hue).toBe(123);
  });

  it('caches each collection’s cover until its members, art or pin change', () => {
    const members = [game(1), game(2), game(3)];
    const a = collectionCollage(id(500), 'Racing nights', members, null);
    expect(collectionCollage(id(500), 'Racing nights', [...members], null)).toBe(a);
    const added = collectionCollage(id(500), 'Racing nights', [...members, game(4)], null);
    expect(added).not.toBe(a);
    expect(added.kind).toBe('quad');
    const newArt = collectionCollage(id(500), 'Racing nights', [game(1, { art: { cover: './art/new.jpg', hero: null, logo: null, header: null, icon: null } }), game(2), game(3), game(4)], null);
    expect(newArt).not.toBe(added);
    expect(collectionCollage(id(500), 'Racing nights', [game(1), game(2), game(3), game(4)], id(2)).kind).toBe('single');
    for (let i = 0; i < 100; i++) collectionCollage(id(1000 + i), 'x', members, null);
    expect(collageCacheSize()).toBeLessThanOrEqual(64);
  });

  it('reads and writes pinned covers safely', () => {
    const raw = `${id(1)}:${id(2)}|${id(3)}:${id(4)}`;
    const pins = parsePinnedCovers(raw);
    expect([...pins]).toEqual([[id(1), id(2)], [id(3), id(4)]]);
    expect(parsePinnedCovers(`${id(1)}:../../x|nope|${id(5)}:${id(6)}:extra|${id(7)}:${id(8)}`).size).toBe(1);
    expect(parsePinnedCovers(null).size).toBe(0);
    expect(serializePinnedCovers(pins, { collectionId: id(1), gameId: null })).toBe(`${id(3)}:${id(4)}`);
    expect(serializePinnedCovers(pins, { collectionId: id(9), gameId: id(10) })).toBe(`${raw}|${id(9)}:${id(10)}`);
    expect(serializePinnedCovers(pins, { collectionId: id(9), gameId: 'bad' })).toBe(raw);
    expect(serializePinnedCovers(pins, undefined, new Set([id(3)]))).toBe(`${id(3)}:${id(4)}`);
  });
});
