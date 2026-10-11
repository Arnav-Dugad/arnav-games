/**
 * Track E2a: collection covers. Each collection gets cover art made from its own games: one cover, two side by side,
 * one large beside two (1+2), a 2×2, or — for five or more — a mosaic of one large and four small over a blurred
 * wash, all tinted with the collection's dominant colour. Or the user pins one game's art as the cover.
 *
 * Pure and deterministic (same games → same cover, never a shuffle), cached per collection and rebuilt only when the
 * members, their art or the pin change. Drawn with layered CSS in components/library/CollectionCover.tsx, so artwork
 * is never re-encoded and nothing is written to disk.
 */
import type { Game } from '../bridge/types';
import { cssOklch, parseOklch, type LCh } from './color';
import { titleHue } from './palette';

export type CollageKind = 'empty' | 'single' | 'duo' | 'trio' | 'quad' | 'mosaic';

/** A tile's place in the frame, in percent of its width and height. */
export interface CollageRect { x: number; y: number; w: number; h: number }

export interface CollageTile extends CollageRect {
  gameId: string;
  title: string;
  /** Portrait cover, else the wide header or hero cropped; null draws a coloured tile with the title's initials. */
  art: string | null;
  hue: number;
}

export interface CollagePalette {
  /** Dominant colour (oklch). */
  a: string;
  /** A deeper companion for the wash. */
  b: string;
  hue: number;
}

export interface Collage {
  kind: CollageKind;
  tiles: CollageTile[];
  /** Art for the blurred wash behind a mosaic (the first tile's), or null. */
  wash: string | null;
  palette: CollagePalette;
  /** True when the user pinned a game's art as this cover. */
  pinned: boolean;
  /** Members not shown as tiles (a mosaic of 30 games shows 5). */
  more: number;
}

const MAX_TILES = 5;

/** Where each tile goes for n games (a pin always shows one). */
export function collageLayout(n: number): { kind: CollageKind; rects: CollageRect[] } {
  if (n <= 0) return { kind: 'empty', rects: [] };
  if (n === 1) return { kind: 'single', rects: [{ x: 0, y: 0, w: 100, h: 100 }] };
  if (n === 2) return { kind: 'duo', rects: [{ x: 0, y: 0, w: 50, h: 100 }, { x: 50, y: 0, w: 50, h: 100 }] };
  if (n === 3) return { kind: 'trio', rects: [{ x: 0, y: 0, w: 58, h: 100 }, { x: 58, y: 0, w: 42, h: 50 }, { x: 58, y: 50, w: 42, h: 50 }] };
  if (n === 4) return { kind: 'quad', rects: [{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 }, { x: 0, y: 50, w: 50, h: 50 }, { x: 50, y: 50, w: 50, h: 50 }] };
  return {
    kind: 'mosaic',
    rects: [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 25, h: 50 }, { x: 75, y: 0, w: 25, h: 50 },
      { x: 50, y: 50, w: 25, h: 50 }, { x: 75, y: 50, w: 25, h: 50 },
    ],
  };
}

const artOf = (g: Game) => g.art.cover ?? g.art.header ?? g.art.hero ?? null;

/**
 * The games a cover shows, in a stable order: the pinned game alone when it's still a member; else games with art
 * before games without, favourites first, then the most played, then by title.
 */
export function coverGames(members: readonly Game[], pinnedId: string | null, max = MAX_TILES): { games: Game[]; pinned: boolean } {
  const pinned = pinnedId ? members.find((g) => g.id === pinnedId) : undefined;
  if (pinned) return { games: [pinned], pinned: true };
  const ranked = [...members].sort((a, b) =>
    Number(!!artOf(b)) - Number(!!artOf(a))
    || Number(b.favorite) - Number(a.favorite)
    || (b.trackedSeconds ?? 0) - (a.trackedSeconds ?? 0)
    || a.sortTitle.localeCompare(b.sortTitle)
    || a.id.localeCompare(b.id));
  return { games: ranked.slice(0, max), pinned: false };
}

/** A game's main colour: its stored artwork palette when there is one, else the hue of its title. */
function colourOf(g: Game): LCh {
  if (g.palette && g.palette.length <= 600) {
    try {
      const p = JSON.parse(g.palette) as { accent?: unknown };
      const lch = typeof p.accent === 'string' ? parseOklch(p.accent) : null;
      if (lch) return lch;
    } catch {
      // a damaged stored palette: use the title's colour
    }
  }
  return [0.66, 0.13, titleHue(g.title)];
}

/**
 * The collection's dominant colour: a chroma-weighted circular mean of its games' colours (bigger tiles count more),
 * kept in a calm range so covers sit well on every theme.
 */
export function collagePalette(games: readonly Game[], fallbackHue: number): CollagePalette {
  let x = 0;
  let y = 0;
  let L = 0;
  let C = 0;
  let weight = 0;
  games.forEach((g, i) => {
    const [l, c, h] = colourOf(g);
    const w = (i === 0 ? 2 : 1) * Math.max(0.02, c);
    x += Math.cos((h * Math.PI) / 180) * w;
    y += Math.sin((h * Math.PI) / 180) * w;
    L += l * w;
    C += c * w;
    weight += w;
  });
  const hue = weight > 0 && Math.hypot(x, y) > 1e-6 ? (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360 : fallbackHue;
  const l = weight > 0 ? L / weight : 0.66;
  const c = weight > 0 ? C / weight : 0.13;
  const clampL = Math.min(0.72, Math.max(0.5, l));
  const clampC = Math.min(0.16, Math.max(0.05, c));
  return { a: cssOklch([clampL, clampC, hue]), b: cssOklch([0.26, Math.min(0.09, clampC * 0.7), (hue + 25) % 360]), hue: Math.round(hue * 10) / 10 };
}

/** Builds a cover (no caching; see {@link collectionCollage}). */
export function buildCollage(collectionName: string, members: readonly Game[], pinnedId: string | null): Collage {
  const { games, pinned } = coverGames(members, pinnedId);
  const { kind, rects } = collageLayout(games.length);
  const tiles = games.map((g, i): CollageTile => ({ ...rects[i], gameId: g.id, title: g.title, art: artOf(g), hue: titleHue(g.title) }));
  return {
    kind,
    tiles,
    wash: kind === 'mosaic' || kind === 'trio' ? tiles[0]?.art ?? null : null,
    palette: collagePalette(games, titleHue(collectionName)),
    pinned,
    more: pinned ? 0 : Math.max(0, members.length - games.length),
  };
}

/** What a cover depends on: change any of it and the cover is rebuilt. */
export function collageKey(collectionId: string, collectionName: string, members: readonly Game[], pinnedId: string | null): string {
  let k = `${collectionId}|${collectionName}|${pinnedId ?? ''}|${members.length}`;
  for (const g of members) k += `|${g.id}:${artOf(g) ?? ''}:${g.favorite ? 1 : 0}:${Math.floor((g.trackedSeconds ?? 0) / 3600)}:${g.palette?.length ?? 0}`;
  return k;
}

const CACHE_MAX = 64;
const cache = new Map<string, { key: string; collage: Collage }>();

/** A collection's cover, from the cache unless its members, art or pin changed. */
export function collectionCollage(collectionId: string, collectionName: string, members: readonly Game[], pinnedId: string | null): Collage {
  const key = collageKey(collectionId, collectionName, members, pinnedId);
  const hit = cache.get(collectionId);
  if (hit && hit.key === key) {
    // Most recently used last.
    cache.delete(collectionId);
    cache.set(collectionId, hit);
    return hit.collage;
  }
  const collage = buildCollage(collectionName, members, pinnedId);
  cache.set(collectionId, { key, collage });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return collage;
}

/** For tests: how many covers are cached. */
export const collageCacheSize = () => cache.size;

// ---------------------------------------------------------------- pinned covers (setting library.collectionCovers)

const ID = /^[0-9a-f]{32}$/;
/** At most this many pins are kept (the setting's length limit). */
export const MAX_PINS = 200;

/** "collectionId:gameId|…" → map. Anything malformed is ignored (stored data is never trusted). */
export function parsePinnedCovers(raw: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof raw !== 'string' || raw.length > 66 * MAX_PINS + MAX_PINS) return out;
  for (const pair of raw.split('|')) {
    const [c, g, extra] = pair.split(':');
    if (extra === undefined && ID.test(c ?? '') && ID.test(g ?? '') && out.size < MAX_PINS) out.set(c, g);
  }
  return out;
}

/**
 * Writes the map back, with one pin changed (gameId null = back to the automatic collage). Pins of collections that
 * no longer exist are dropped when `existing` is given.
 */
export function serializePinnedCovers(pins: ReadonlyMap<string, string>, change?: { collectionId: string; gameId: string | null }, existing?: ReadonlySet<string>): string {
  const next = new Map(pins);
  if (change) {
    if (change.gameId && ID.test(change.gameId) && ID.test(change.collectionId)) next.set(change.collectionId, change.gameId);
    else next.delete(change.collectionId);
  }
  const pairs: string[] = [];
  for (const [c, g] of next) if (!existing || existing.has(c)) pairs.push(`${c}:${g}`);
  return pairs.slice(-MAX_PINS).join('|');
}
