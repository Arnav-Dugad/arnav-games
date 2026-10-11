import { useId } from 'react';
import './brand.css';

/** The "Ascent" mark's geometry on the 512 master grid (docs/BRAND.md › Construction). */
export const ASCENT = {
  /** The full A silhouette, painted in the lit blade's colour. */
  silhouette: 'M96 404L256 96L416 404L332 404L256 213.96L180 404Z',
  /** The left (lit) blade on its own, for animation. */
  lit: 'M96 404L256 96L256 214L180 404Z',
  /** The right (shaded) blade, laid over the silhouette so the facet seam never shows a gap. */
  shaded: 'M256 96L416 404L332 404L256 213.96Z',
  /** The four-point star that forms the bar, centred at (256, 330). */
  star: 'M256 292C258.93 321.7 264.38 327.15 288.75 330.08C264.38 333.01 258.93 338.46 256 368.16C253.07 338.46 247.62 333.01 223.25 330.08C247.62 327.15 253.07 321.7 256 292Z',
  starCenter: { x: 256, y: 330.08 },
  viewBox: '96 96 320 308',
} as const;

/**
 * The bare Ascent symbol, inline so it follows the theme: the colour mark on dark themes, the
 * `-light` colours on Light, and one ink (currentColor) in High contrast and forced colours.
 * Decorative by default; pass `label` when it stands alone as the product name.
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    // A box element around the drawing, so layout code (offsetWidth, offsetLeft) can measure it like any other.
    <span
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={ASCENT.viewBox} focusable="false">
        <defs>
          <linearGradient id={`${id}l`} gradientUnits="userSpaceOnUse" x1="256" y1="96" x2="138" y2="404">
            <stop offset="0" className="brand-mark__l0" />
            <stop offset="0.48" className="brand-mark__l1" />
            <stop offset="1" className="brand-mark__l2" />
          </linearGradient>
          <linearGradient id={`${id}s`} gradientUnits="userSpaceOnUse" x1="256" y1="96" x2="374" y2="404">
            <stop offset="0" className="brand-mark__s0" />
            <stop offset="0.48" className="brand-mark__s1" />
            <stop offset="1" className="brand-mark__s2" />
          </linearGradient>
        </defs>
        <path d={ASCENT.silhouette} fill={`url(#${id}l)`} className="brand-mark__lit" />
        <path d={ASCENT.shaded} fill={`url(#${id}s)`} className="brand-mark__shaded" />
        <path d={ASCENT.star} className="brand-mark__star" />
      </svg>
    </span>
  );
}

/**
 * Where the star sits inside a rendered mark, in the same coordinates as `box` (the mark's element box;
 * the drawing is fitted and centred in it). Used by the mode switch to land its flare exactly on the bar.
 */
export function starInMark(box: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(box.w / 320, box.h / 308);
  const left = box.x + (box.w - 320 * s) / 2;
  const top = box.y + (box.h - 308 * s) / 2;
  return { x: left + (ASCENT.starCenter.x - 96) * s, y: top + (ASCENT.starCenter.y - 96) * s, height: 76.16 * s };
}
