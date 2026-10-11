/**
 * Track E2a: hooks for collection covers (components/library/CollectionCover.tsx): a collection's games, the pinned
 * covers setting, and the cached collage built from both.
 */
import { useMemo } from 'react';
import type { CollectionInfo, Game } from '../bridge/types';
import { collectionCollage, parsePinnedCovers, type Collage } from '../lib/collage';
import { matchesSmartFilter, parseSmartFilter } from '../lib/smartFilter';
import { useTimeToBeatMap } from './recap';
import { useSubsMap } from './subs';
import { useStore } from './store';

/**
 * The games in a collection, for its cover. A smart collection's rule is evaluated live (like the Library and the
 * sidebar count); hidden games never appear on a cover.
 */
export function useCollectionMembers(collection: CollectionInfo | undefined): Game[] {
  const games = useStore((s) => s.library.games);
  const rule = collection?.rule ?? null;
  const id = collection?.id ?? null;
  const ttb = useTimeToBeatMap();
  const subs = useSubsMap();
  return useMemo(() => {
    if (!id) return [];
    if (rule) {
      const f = parseSmartFilter(rule);
      if (!f) return [];
      const ctx = { ttb: ttb?.games ?? null, subs: subs as Record<string, unknown[]> | null };
      return games.filter((g) => !g.hidden && matchesSmartFilter(g, f, ctx));
    }
    return games.filter((g) => !g.hidden && g.collections.includes(id));
  }, [id, rule, games, ttb, subs]);
}

/** The pinned covers (collection id → game id), from the `library.collectionCovers` setting. */
export function usePinnedCovers(): Map<string, string> {
  const raw = useStore((s) => s.settings?.['library.collectionCovers'] ?? '');
  return useMemo(() => parsePinnedCovers(raw), [raw]);
}

/** A collection's cover (cached in lib/collage until its members, their art or the pin change). */
export function useCollectionCollage(collection: CollectionInfo | undefined): Collage | null {
  const members = useCollectionMembers(collection);
  const pins = usePinnedCovers();
  const id = collection?.id ?? null;
  const name = collection?.name ?? '';
  const pinned = id ? pins.get(id) ?? null : null;
  return useMemo(() => (id ? collectionCollage(id, name, members, pinned) : null), [id, name, members, pinned]);
}
