import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hourglass } from 'lucide-react';
import type { WishlistItem } from '../../bridge/types';
import { waitingFor, waitingSummary } from '../../lib/waiting';
import './waiting.css';

const longDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Track E2a: "On your list for 2 years 3 months" on a wishlist card (nothing when Steam didn't say when). */
export function WaitingLine({ item, compact = false }: { item: WishlistItem; compact?: boolean }) {
  const w = useMemo(() => waitingFor(item), [item]);
  if (!w) return null;
  return (
    <span className="wwait" data-compact={compact || undefined} data-long={w.span.years >= 2 || undefined} title={`Added ${longDate(w.since)}`}>
      <Hourglass size={compact ? 11 : 12} aria-hidden /> {w.sentence}
    </span>
  );
}

/** Track E2a: the longest wait on the list, as a stat chip that opens the list longest waiting first. */
export function WaitingStat({ items, onShow }: { items: WishlistItem[]; onShow: () => void }) {
  const s = useMemo(() => waitingSummary(items), [items]);
  if (!s.longest || s.longest.waiting.span.totalDays < 30) return null;
  const { name, waiting } = s.longest;
  return (
    <button type="button" className="wish-stat wwait-stat" data-tone="waiting" onClick={onShow}
      aria-label={`Longest wait: ${name}, on your list for ${waiting.words}${s.overAYear > 1 ? `. ${s.overAYear} games have waited a year or more` : ''}. Show the list, longest waiting first`}
      title={`${name} · added ${longDate(waiting.since)}`}>
      <Hourglass size={13} aria-hidden /> <b className="num">{waiting.short}</b> <span>longest wait</span>
    </button>
  );
}

/**
 * Track E2a: the calendar's hover/focus card for a release: name, when, price and how long it has been on your
 * list. Drawn above the cover (below when there's no room), outside the day cell so nothing clips it. Decorative
 * for pointer users; keyboard and screen reader users get the same words in the cover's own label.
 */
export function CalendarPeek({ anchor, item, when, price, id }: { anchor: HTMLElement | null; item: WishlistItem | null; when: string; price: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const waiting = useMemo(() => (item ? waitingFor(item) : null), [item]);

  useLayoutEffect(() => {
    if (!anchor || !item) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 96;
      const w = ref.current?.offsetWidth ?? 240;
      const below = r.top - h - 14 < 8;
      const left = Math.min(innerWidth - w / 2 - 8, Math.max(w / 2 + 8, r.left + r.width / 2));
      setPos({ left, top: below ? r.bottom + 12 : r.top - 12, below });
    };
    place();
    const raf = requestAnimationFrame(place); // after the card has its size
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  }, [anchor, item]);

  if (!item) return null;
  return createPortal(
    <div ref={ref} id={id} className="wpeek" aria-hidden data-below={pos?.below || undefined} data-shown={!!pos || undefined}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      <span className="wpeek__name">{item.name}</span>
      <span className="wpeek__when">{when}{price ? ` · ${price}` : ''}</span>
      {waiting && <span className="wpeek__wait"><Hourglass size={12} aria-hidden /> {waiting.sentence}</span>}
    </div>,
    document.body,
  );
}
