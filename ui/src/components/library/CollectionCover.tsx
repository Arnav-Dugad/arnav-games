import { memo, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Folder, ImageIcon, LayoutGrid, Sparkles } from 'lucide-react';
import type { CollectionInfo } from '../../bridge/types';
import { errorMessage } from '../../bridge/bridge';
import { buildCollage, serializePinnedCovers, type Collage, type CollageTile } from '../../lib/collage';
import { useCollectionCollage, useCollectionMembers, usePinnedCovers } from '../../state/collectionCovers';
import { useStore } from '../../state/store';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/primitives';
import './collection-cover.css';

type CoverSize = 'sm' | 'row' | 'md' | 'lg';

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

const initials = (title: string) => title.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

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

  // One Tab stop: the chosen cover (or Automatic when the chosen game isn't listed); arrows move, Enter or Space chooses.
  const tabbable = current && list.some((g) => g.id === current) ? current : null;
  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    // Columns: how many options share the first row.
    const cols = Math.max(1, items.filter((el) => el.offsetTop === items[0].offsetTop).length);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols
      : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, to))]?.focus();
  };

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
      <div className="ccpick" role="radiogroup" aria-label="Collection cover" onKeyDown={moveFocus}>
        <button type="button" className="ccpick__option ccpick__option--auto" role="radio" aria-checked={!current} tabIndex={!tabbable ? 0 : -1} disabled={busy}
          data-autofocus={!tabbable || undefined} onClick={() => void save(null)}>
          <span className="ccpick__art"><CollageView collage={auto} size="md" smart={!!collection.rule} /></span>
          <span className="ccpick__name"><LayoutGrid size={13} aria-hidden /> Automatic</span>
          {!current && <Check className="ccpick__check" size={16} aria-hidden />}
        </button>
        {list.map((g) => (
          <button key={g.id} type="button" className="ccpick__option" role="radio" aria-checked={current === g.id} tabIndex={tabbable === g.id ? 0 : -1} disabled={busy}
            data-autofocus={tabbable === g.id || undefined} onClick={() => void save(g.id)}>
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
