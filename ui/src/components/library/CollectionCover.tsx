import { memo, useMemo, useState, type CSSProperties } from 'react';
import { Check, Folder, ImageIcon, LayoutGrid, Sparkles } from 'lucide-react';
import type { CollectionInfo, Game } from '../../bridge/types';
import { errorMessage } from '../../bridge/bridge';
import { buildCollage, collectionCollage, parsePinnedCovers, serializePinnedCovers, type Collage, type CollageTile } from '../../lib/collage';
import { matchesSmartFilter, parseSmartFilter } from '../../lib/smartFilter';
import { useTimeToBeatMap } from '../../state/recap';
import { useSubsMap } from '../../state/subs';
import { useStore } from '../../state/store';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/primitives';
import './collection-cover.css';

/**
 * Track E2a: the games in a collection, for its cover. A smart collection's rule is evaluated live (like the Library
 * and the sidebar count); hidden games never appear on a cover.
 */
export function useCollectionMembers(collection: CollectionInfo | undefined): Game[] {
  const games = useStore((s) => s.library.games);
  const rule = collection?.rule ?? null;
  const ttb = useTimeToBeatMap();
  const subs = useSubsMap();
  return useMemo(() => {
    if (!collection) return [];
    if (rule) {
      const f = parseSmartFilter(rule);
      if (!f) return [];
      const ctx = { ttb: ttb?.games ?? null, subs: subs as Record<string, unknown[]> | null };
      return games.filter((g) => !g.hidden && matchesSmartFilter(g, f, ctx));
    }
    return games.filter((g) => !g.hidden && g.collections.includes(collection.id));
  }, [collection, rule, games, ttb, subs]);
}

/** The pinned covers (collection id → game id). */
export function usePinnedCovers(): Map<string, string> {
  const raw = useStore((s) => s.settings?.['library.collectionCovers'] ?? '');
  return useMemo(() => parsePinnedCovers(raw), [raw]);
}

export function useCollectionCollage(collection: CollectionInfo | undefined): Collage | null {
  const members = useCollectionMembers(collection);
  const pins = usePinnedCovers();
  const pinned = collection ? pins.get(collection.id) ?? null : null;
  return useMemo(() => (collection ? collectionCollage(collection.id, collection.name, members, pinned) : null), [collection, members, pinned]);
}

export type CoverSize = 'sm' | 'row' | 'md' | 'lg';

/**
 * A collection's cover: its games' art as a 2×2, 1+2 or mosaic over a blurred wash in the collection's dominant
 * colour, or the one game the user pinned. Decorative (the collection's name is always next to it). An empty
 * collection shows its folder (or the smart sparkle) on the same colour.
 */
export const CollectionCover = memo(function CollectionCover({ collection, size, className = '' }: { collection: CollectionInfo; size: CoverSize; className?: string }) {
  const collage = useCollectionCollage(collection);
  if (!collage) return null;
  return <CollageView collage={collage} size={size} smart={!!collection.rule} className={className} />;
});

/** Sidebar: the cover in place of the folder icon; an empty collection keeps its plain icon. */
export const SidebarCollectionIcon = memo(function SidebarCollectionIcon({ collection }: { collection: CollectionInfo }) {
  const collage = useCollectionCollage(collection);
  if (!collage || collage.kind === 'empty') return collection.rule ? <Sparkles size={17} /> : <Folder size={17} />;
  return <CollageView collage={collage} size="sm" smart={!!collection.rule} />;
});

/** Immersive: a collection row's cover, by the row's collection id (nothing for an empty collection). */
export function RowCollectionCover({ collectionId }: { collectionId: string }) {
  const collection = useStore((s) => s.library.collections.find((c) => c.id === collectionId));
  const collage = useCollectionCollage(collection);
  if (!collection || !collage || collage.kind === 'empty') return null;
  return <CollageView collage={collage} size="row" smart={!!collection.rule} />;
}

export function CollageView({ collage, size, smart, className = '' }: { collage: Collage; size: CoverSize; smart?: boolean; className?: string }) {
  const style = { ['--cc-a' as string]: collage.palette.a, ['--cc-b' as string]: collage.palette.b } as CSSProperties;
  const Icon = smart ? Sparkles : Folder;
  return (
    <span className={`ccover ccover--${size} ${className}`} data-kind={collage.kind} data-pinned={collage.pinned || undefined} style={style} aria-hidden>
      {collage.wash && size !== 'sm' && <img className="ccover__wash" src={collage.wash} alt="" loading="lazy" decoding="async" draggable={false} />}
      {collage.kind === 'empty' && <Icon className="ccover__empty" size={size === 'sm' ? 12 : size === 'row' ? 18 : 30} />}
      {collage.tiles.length > 0 && (
        <span className="ccover__grid">
          {collage.tiles.map((t, i) => <Tile key={t.gameId} tile={t} index={i} big={size === 'lg' || size === 'md'} />)}
        </span>
      )}
      <span className="ccover__tint" />
      {collage.more > 0 && size === 'lg' && <span className="ccover__more num">+{collage.more}</span>}
      {smart && collage.kind !== 'empty' && size !== 'lg' && <Sparkles className="ccover__smart" size={size === 'sm' ? 8 : 11} />}
      <span className="ccover__sheen" />
    </span>
  );
}

function Tile({ tile, index, big }: { tile: CollageTile; index: number; big: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const art = tile.art && tile.art !== failed ? tile.art : null;
  const style = { left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.w}%`, height: `${tile.h}%`, ['--tile-hue' as string]: tile.hue, ['--i' as string]: index } as CSSProperties;
  return (
    <span className="ccover__tile" style={style}>
      <span className="ccover__face">
        {art
          ? <img src={art} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(art)} />
          : <span className="ccover__gen">{big && <span className="ccover__initials">{initials(tile.title)}</span>}</span>}
      </span>
    </span>
  );
}

const initials = (title: string) => title.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

/**
 * Track E2a: choose a collection's cover: the automatic collage, or one game's art. Saved in the
 * `library.collectionCovers` setting (pins of deleted collections are tidied away on save).
 */
export function CollectionCoverDialog({ collection, open, onClose }: { collection: CollectionInfo; open: boolean; onClose: () => void }) {
  const members = useCollectionMembers(collection);
  const pins = usePinnedCovers();
  const collections = useStore((s) => s.library.collections);
  const pinned = pins.get(collection.id) ?? null;
  const current = pinned && members.some((g) => g.id === pinned) ? pinned : null;
  const auto = useMemo(() => buildCollage(collection.name, members, null), [collection.name, members]);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => [...members].sort((a, b) => Number(!!b.art.cover) - Number(!!a.art.cover) || a.sortTitle.localeCompare(b.sortTitle)).slice(0, 120), [members]);

  const save = async (gameId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const value = serializePinnedCovers(pins, { collectionId: collection.id, gameId }, new Set(collections.map((c) => c.id)));
      await useStore.getState().setSetting('library.collectionCovers', value);
      onClose();
    } catch (err) {
      useStore.getState().toast({ tone: 'danger', title: 'Cover not saved', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} wide title={`Cover for “${collection.name}”`} describedBy="ccpick-desc"
      actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <p id="ccpick-desc" className="ccpick__lede">Made from the games in this collection, or one game’s art. It shows in the sidebar, the Library and Immersive Mode.</p>
      <div className="ccpick" role="radiogroup" aria-label="Collection cover">
        <button type="button" className="ccpick__option ccpick__option--auto" role="radio" aria-checked={!current} disabled={busy}
          data-autofocus={!current || undefined} onClick={() => void save(null)}>
          <span className="ccpick__art"><CollageView collage={auto} size="md" smart={!!collection.rule} /></span>
          <span className="ccpick__name"><LayoutGrid size={13} aria-hidden /> Automatic</span>
          {!current && <Check className="ccpick__check" size={16} aria-hidden />}
        </button>
        {list.map((g) => (
          <button key={g.id} type="button" className="ccpick__option" role="radio" aria-checked={current === g.id} disabled={busy}
            data-autofocus={current === g.id || undefined} onClick={() => void save(g.id)}>
            <span className="ccpick__art">
              <CollageView collage={buildCollage(collection.name, [g], g.id)} size="md" />
            </span>
            <span className="ccpick__name truncate" title={g.title}>{g.title}</span>
            {current === g.id && <Check className="ccpick__check" size={16} aria-hidden />}
          </button>
        ))}
      </div>
      {members.length === 0 && <p className="ccpick__empty"><ImageIcon size={15} aria-hidden /> Add games to this collection and its cover makes itself from their art.</p>}
      {members.length > list.length && <p className="ccpick__more">Showing {list.length} of {members.length} games.</p>}
    </Dialog>
  );
}
