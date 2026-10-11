/**
 * Track E3: one small session chart for the performance insights — columns (a share per session, sessions evenly
 * spaced) or dots (a value per session, placed in time) — with optional reference lines (medians) that carry a direct
 * label. Same interaction as the Overview's frame-rate chart: hover or arrow keys move a crosshair and tooltip, Enter
 * or a click opens the session, and the parent offers a table view.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { MousePointerClick } from 'lucide-react';
import { useReducedMotion } from '../../state/store';
import { useElementWidth } from './hooks';

export interface ChartPoint {
  id: string;
  /** Start time (ms); used for the x position of dots and the first/last axis labels. */
  t: number;
  v: number;
  /** 'main' draws in the series colour; 'muted' in the de-emphasis grey (e.g. earlier sessions). */
  tone: 'main' | 'muted';
  tip: ReactNode;
  /** What a screen reader hears when this point is active. */
  readout: string;
}

export interface RefLine {
  from: number;
  to: number;
  v: number;
  label: string;
  tone: 'main' | 'muted';
}

const M = { l: 40, r: 56, t: 14, b: 26 };

export function TrendChart({
  points, kind, domain, height = 190, fmtTick, fmtX, refs = [], label, onOpen, series, selectedId,
}: {
  points: ChartPoint[];
  kind: 'columns' | 'dots';
  domain: { min: number; max: number; ticks: number[] };
  height?: number;
  fmtTick: (v: number) => string;
  fmtX: (t: number) => string;
  refs?: RefLine[];
  /** The chart in one sentence (also the group's name). */
  label: string;
  onOpen?: (id: string) => void;
  /** CSS class suffix choosing the series colour (`e3-chart--goal`, `e3-chart--temp`). */
  series: 'goal' | 'temp';
  selectedId?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 640);
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const last = points.length - 1;
  const pw = Math.max(40, width - M.l - M.r);
  const ph = height - M.t - M.b;
  const base = M.t + ph;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[last]?.t ?? 1;
  const span = Math.max(1, t1 - t0);
  const band = pw / Math.max(1, points.length);
  const x = (i: number) =>
    kind === 'columns' ? M.l + band * (i + 0.5) : M.l + (points.length === 1 ? pw / 2 : ((points[i].t - t0) / span) * pw);
  const xt = (t: number) => (kind === 'columns' ? x(0) : M.l + ((t - t0) / span) * pw);
  const y = (v: number) => M.t + (1 - (v - domain.min) / Math.max(1e-9, domain.max - domain.min)) * ph;
  // Columns: at most 24 px, a 2 px surface gap between neighbours, 4 px rounded data end, square at the baseline.
  const colW = Math.max(3, Math.min(24, band - 2));

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = active ?? last;
    let next: number | null | undefined;
    if (e.key === 'ArrowRight') next = Math.min(last, cur + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape' && active != null) next = null;
    else if ((e.key === 'Enter' || e.key === ' ') && active != null && onOpen) {
      e.preventDefault();
      onOpen(points[active].id);
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
  };

  const column = (i: number, v: number) => {
    const cx = x(i);
    const top = Math.min(base - 1, y(v));
    const h = base - top;
    const r = Math.min(4, h, colW / 2);
    const l = cx - colW / 2;
    return `M${l},${base}V${top + r}Q${l},${top} ${l + r},${top}H${l + colW - r}Q${l + colW},${top} ${l + colW},${top + r}V${base}Z`;
  };

  const p = active != null ? points[active] : null;
  const cx = active != null ? x(active) : 0;
  const flip = cx > width - 240;
  const actionHint = onOpen ? ' Use the left and right arrow keys to move between sessions and Enter to open one.' : ' Use the left and right arrow keys to move between sessions.';

  return (
    <div
      ref={ref}
      className={`vx-chart e3-chart e3-chart--${series}`}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label}${actionHint}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true);
        if (active == null) setActive(last);
      }}
      onBlur={() => {
        setFocused(false);
        setActive(null);
      }}
    >
      <svg width={width} height={height} role="img" aria-label={label}>
        {domain.ticks.map((v) => (
          <g key={v}>
            <line className={v === domain.min ? 'vx-chart__baseline' : 'vx-chart__grid'} x1={M.l} x2={M.l + pw} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} />
            <text className="vx-chart__tick" x={M.l - 8} y={y(v)} dy="0.35em" textAnchor="end">{fmtTick(v)}</text>
          </g>
        ))}
        {points.length > 0 && (
          <>
            <text className="vx-chart__tick" x={M.l} y={height - 6} textAnchor="start">{fmtX(points[0].t)}</text>
            {last > 0 && <text className="vx-chart__tick" x={M.l + pw} y={height - 6} textAnchor="end">{fmtX(points[last].t)}</text>}
          </>
        )}
        {active != null && <line className="vx-chart__cross" x1={Math.round(cx) + 0.5} x2={Math.round(cx) + 0.5} y1={M.t} y2={base} aria-hidden />}
        {refs.map((r) => {
          const x1 = Math.max(M.l, xt(r.from));
          const x2 = Math.min(M.l + pw, xt(r.to));
          return (
            <g key={`${r.from}-${r.v}`} className="e3-ref" data-tone={r.tone} aria-hidden>
              <line x1={x1} x2={Math.max(x1 + 6, x2)} y1={y(r.v)} y2={y(r.v)} />
              <text x={Math.max(x1 + 6, x2) + 6} y={y(r.v)} dy="0.35em">{r.label}</text>
            </g>
          );
        })}
        {points.map((q, i) =>
          kind === 'columns' ? (
            <motion.path
              key={q.id}
              className="e3-col"
              data-tone={q.tone}
              data-active={active === i || undefined}
              data-selected={selectedId === q.id || undefined}
              d={column(i, q.v)}
              initial={reduce ? false : { opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              style={{ originY: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.5, delay: Math.min(0.4, i * 0.02), ease: [0.16, 1, 0.3, 1] }}
            />
          ) : (
            <motion.circle
              key={q.id}
              className="e3-dot"
              data-tone={q.tone}
              data-selected={selectedId === q.id || undefined}
              cx={x(i)}
              cy={y(q.v)}
              r={active === i ? 5.5 : 4}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, delay: Math.min(0.4, i * 0.02) }}
            />
          ),
        )}
        <rect
          className="vx-chart__hit"
          data-open={onOpen ? true : undefined}
          x={M.l - 12}
          y={M.t}
          width={pw + 24}
          height={ph}
          onPointerMove={(e) => nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
          onPointerDown={(e) => nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
          onPointerLeave={() => !focused && setActive(null)}
          onClick={() => active != null && onOpen?.(points[active].id)}
        />
      </svg>
      {p && (
        <div className="vx-tip e3-tip" style={flip ? { left: Math.max(0, cx - 14), transform: 'translateX(-100%)' } : { left: cx + 14 }} aria-hidden>
          {p.tip}
          {onOpen && <span className="e3-tip__hint"><MousePointerClick size={11} aria-hidden /> Click to open</span>}
        </div>
      )}
      {focused && p && <span className="visually-hidden" aria-live="polite">{p.readout}</span>}
    </div>
  );
}
