import { useEffect, useState, type CSSProperties } from 'react';
import { planShift, shouldShift, type ShiftPlan } from '../../lib/numberShift';
import { useGameRunning, useReducedMotion } from '../../state/store';
import './number-shift.css';

interface Shift {
  from: string;
  to: string;
  plan: Exclude<ShiftPlan, { mode: 'none' }>;
  /** Restarts the CSS animations when a new change lands mid-flight. */
  n: number;
}

/**
 * Track E2b: a number or price that changes in place animates from its old value to the new one: changed digits
 * roll (same shape), otherwise the old text lifts out while the new one rises in (lib/numberShift.ts). The first
 * render never animates. Screen readers get only the final text (`speak`; turn it off when the parent already
 * supplies a spoken label). Once the change lands, the plain text replaces the animated copy.
 */
export function NumberShift({ text, className, speak = true }: { text: string; className?: string; speak?: boolean }) {
  const reduce = useReducedMotion();
  const performance = useGameRunning();
  const [prev, setPrev] = useState(text);
  const [shift, setShift] = useState<Shift | null>(null);

  // A change starts a shift from what is on screen now (mid-shift: the previous target).
  if (prev !== text) {
    const from = prev;
    setPrev(text);
    const ok = shouldShift({ reduced: reduce, performance, hidden: typeof document !== 'undefined' && document.hidden });
    const plan = ok ? planShift(from, text) : ({ mode: 'none' } as const);
    if (plan.mode === 'none') {
      if (shift) setShift(null);
    } else setShift({ from, to: text, plan, n: (shift?.n ?? 0) + 1 });
  }
  const live = shift && shift.to === text ? shift : null;
  if ((reduce || performance) && shift) setShift(null);

  useEffect(() => {
    if (!live) return;
    const t = window.setTimeout(() => setShift(null), live.plan.durationMs + 60);
    return () => window.clearTimeout(t);
  }, [live]);

  if (!live) return className ? <span className={className}>{text}</span> : <>{text}</>;

  const { plan } = live;
  const style = { ['--shift-dir' as string]: plan.dir } as CSSProperties;
  return (
    <span className={`nshift${className ? ` ${className}` : ''}`} data-shift={plan.mode} style={style}>
      {speak && <span className="visually-hidden">{text}</span>}
      <span className="nshift__anim" aria-hidden key={live.n}>
        {plan.mode === 'crossfade' ? (
          <span className="nshift__x">
            <span className="nshift__in">{live.to}</span>
            <span className="nshift__out">{live.from}</span>
          </span>
        ) : (
          plan.tokens.map((t, i) =>
            t.kind === 'same' ? (
              <span key={i}>{t.text}</span>
            ) : (
              <span key={i} className="nshift__cell" style={{ ['--shift-delay' as string]: `${t.delayMs}ms` } as CSSProperties}>
                <span className="nshift__in">{t.to}</span>
                <span className="nshift__out">{t.from}</span>
              </span>
            ),
          )
        )}
      </span>
    </span>
  );
}
