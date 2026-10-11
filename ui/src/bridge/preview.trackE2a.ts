/**
 * Track E2a preview: the start page, collection covers and the Completed 100% card image, with fictional data.
 * URL switches:
 *   ?startPage=library   start with "Open on start" set to that page (home, library, discover, wishlist, journal,
 *                        performance, immersive or last)
 *   ?covers              start with four collections of different sizes (1+2, 2×2, a mosaic, and an empty one), and
 *                        a smart one
 *   ?coverPinned         …and the 2×2 one's cover pinned to one game
 *   ?covers100           give three preview games portrait art, so covers show real images (not generated tiles)
 */
import type { CollectionInfo, Game, Settings } from './types';
import { BridgeError } from './bridge';
import { placeholderArt } from './preview.dataSources';
import { isStartPage } from '../lib/startPage';
import { APP_NAME } from '../lib/brand';

type Emit = (name: string, payload: unknown) => void;

export const TRACK_E2A_DEFAULT_SETTINGS: Pick<Settings, 'startup.page' | 'library.collectionCovers'> = {
  'startup.page': 'last',
  'library.collectionCovers': '',
};

/** ?startPage=… sets "Open on start" (Immersive also turns on the older switch, as the Settings page does). */
export function previewE2aSettings(params: URLSearchParams): Partial<Settings> {
  const page = params.get('startPage');
  if (!isStartPage(page)) return {};
  return { 'startup.page': page, 'startup.immersive': page === 'immersive' };
}

export const COVER_IDS = {
  racing: 'e2a0c0de000000000000000000000001',
  space: 'e2a0c0de000000000000000000000002',
  everything: 'e2a0c0de000000000000000000000003',
  empty: 'e2a0c0de000000000000000000000004',
  smart: 'e2a0c0de000000000000000000000005',
} as const;

/** Seeds the ?covers collections (members by title, so the preview library's order doesn't matter). */
export function seedPreviewCovers(params: URLSearchParams, games: Game[], collections: CollectionInfo[], settings: () => Settings, setSettings: (s: Settings) => void) {
  if (!params.has('covers') || collections.some((c) => c.id === COVER_IDS.racing)) return;
  const add = (id: string, name: string, titles: string[] | null, rule: string | null = null) => {
    collections.push({ id, name, icon: null, sortOrder: collections.length, rule, count: 0 });
    for (const g of games) if (titles?.includes(g.title)) g.collections = [...new Set([...g.collections, id])];
  };
  add(COVER_IDS.space, 'Among the stars', ['Starfall Tactics', 'Deep Field', 'Velvet Orbit']);
  add(COVER_IDS.racing, 'Racing nights', ['Nebula Drift', 'Circuit Apex', 'Redline Rivals', 'Night Courier']);
  add(COVER_IDS.everything, 'Weekend list', ['Ashen Crown', 'Hollow Lantern', 'Tidebreaker', 'Last Signal', 'Glasswing', 'Northbound', 'Echoes of Vael', 'Wyrmspire']);
  add(COVER_IDS.empty, 'Someday', []);
  add(COVER_IDS.smart, 'Favourites, smartly', null, JSON.stringify({ v: 1, favorite: true }));
  if (params.has('covers100')) {
    for (const t of ['Nebula Drift', 'Circuit Apex', 'Ashen Crown']) {
      const g = games.find((x) => x.title === t);
      if (g) g.art = { ...g.art, cover: placeholderArt('cover', t, 0, 'alternate') };
    }
  }
  if (params.has('coverPinned')) {
    const g = games.find((x) => x.title === 'Circuit Apex');
    if (g) setSettings({ ...settings(), 'library.collectionCovers': `${COVER_IDS.racing}:${g.id}` });
  }
}

/** The Completed 100% card: an upload of the rendered PNG (checked like the replay card), saved or copied. */
export function trackE2aPreviewHandlers(ctx: { lib: { games: Game[] }; emit: () => Emit }) {
  let seq = 0;
  const uploads = new Map<string, { gameId: string; total: number; chunks: string[] }>();
  const images: { gameId: string; bytes: number; kind: 'save' | 'copy' }[] = [];
  const take = (token: string, kind: 'save' | 'copy') => {
    const u = uploads.get(token);
    if (!u) throw new BridgeError('notFound', 'That image upload expired. Try again.');
    uploads.delete(token);
    const bytes = u.chunks.reduce((n, c) => n + Math.floor((c.length * 3) / 4), 0);
    if (Math.abs(bytes - u.total) > 3) throw new BridgeError('invalid', 'The image didn’t arrive complete. Try again.');
    images.push({ gameId: u.gameId, bytes: u.total, kind });
    return u;
  };
  return {
    'completion.imageBegin': (p: { gameId: string; bytes: number }) => {
      if (!ctx.lib.games.some((g) => g.id === p.gameId)) throw new BridgeError('notFound', 'That game is no longer in your library.');
      if (!(p.bytes >= 64 && p.bytes <= 20 * 1024 * 1024)) throw new BridgeError('invalid', 'That image is too large to save.');
      const token = (++seq).toString(16).padStart(32, 'e');
      uploads.set(token, { gameId: p.gameId, total: p.bytes, chunks: [] });
      return { token, maxChunk: 196_608 };
    },
    'completion.imageChunk': (p: { token: string; index: number; data: string }) => {
      const u = uploads.get(p.token);
      if (!u) throw new BridgeError('notFound', 'That image upload expired. Try again.');
      if (p.index !== u.chunks.length || p.data.length > 196_608) throw new BridgeError('invalid', 'Invalid image chunk.');
      u.chunks.push(p.data);
      return { received: u.chunks.length };
    },
    'completion.imageSave': (p: { token: string }) => {
      const u = take(p.token, 'save');
      const title = ctx.lib.games.find((g) => g.id === u.gameId)?.title ?? 'Game';
      return { path: `C:\\Users\\you\\Pictures\\${APP_NAME} 100% - ${title}.png` };
    },
    'completion.imageCopy': (p: { token: string }) => {
      take(p.token, 'copy');
      return true;
    },
    /** For tests: what was saved or copied. */
    'preview.completionImages': () => [...images],
  };
}
