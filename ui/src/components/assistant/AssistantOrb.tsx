import { useEffect, useRef } from 'react';
import { ORB_LABEL } from '../../lib/assistantExtras';
import { useGameRunning, useReducedMotion } from '../../state/store';
import { orbLevel, orbPulse, useOrbPhase } from './orbSignal';
import './assistant-extras.css';

/**
 * Track E1: the Assistant's "thinking" orb. A glassy accent sphere with a slow aura while idle; while an answer streams,
 * its swirl turns faster and its glow grows with the tokens arriving per second; each look-up or prepared change sends a
 * ring pulse out from it. Per-frame values are written as CSS custom properties (no React renders, transform/opacity and
 * filter only), and the loop runs only while something is happening.
 * Reduced motion and Performance Mode: a still sphere whose brightness steps with the phase. High contrast: an outlined
 * circle with a phase glyph (dot, ring, filled, dashed, cross); forced colours use system colours.
 */
export function AssistantOrb({ size = 'sm', label = true, className }: { size?: 'xs' | 'sm' | 'md' | 'lg'; label?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const phase = useOrbPhase();
  const reduce = useReducedMotion();
  const performance = useGameRunning(); // Performance Mode: the renderer is suspended anyway; never animate then
  const still = reduce || performance;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (still) {
      const e = phase === 'streaming' ? 0.7 : phase === 'thinking' || phase === 'tool' ? 0.45 : phase === 'waiting' ? 0.3 : 0;
      el.style.setProperty('--e', String(e));
      el.style.setProperty('--p', '0');
      el.style.setProperty('--spin', '35deg');
      return;
    }
    let raf = 0;
    let spin = Number.parseFloat(el.style.getPropertyValue('--spin')) || 0;
    let last = window.performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const level = orbLevel(now);
      const p = orbPulse(now);
      // Thinking without text yet keeps a gentle shimmer; streaming follows the speed.
      const base = phase === 'thinking' || phase === 'tool' ? 0.28 + Math.sin(now / 420) * 0.06 : phase === 'waiting' ? 0.18 : 0;
      const e = Math.max(level, base);
      spin = (spin + dt * (0.012 + e * 0.32)) % 360;
      el.style.setProperty('--e', e.toFixed(3));
      el.style.setProperty('--p', p.toFixed(3));
      el.style.setProperty('--spin', `${spin.toFixed(1)}deg`);
      if (phase !== 'idle' || e > 0.01 || p > 0.01) raf = requestAnimationFrame(tick);
      else {
        el.style.setProperty('--e', '0');
        el.style.setProperty('--p', '0');
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, still]);

  return (
    <span
      ref={ref}
      className={`asx-orb asx-orb--${size}${className ? ` ${className}` : ''}`}
      data-phase={phase}
      data-still={still || undefined}
      role={label ? 'img' : undefined}
      aria-label={label ? `Assistant: ${ORB_LABEL[phase]}` : undefined}
      aria-hidden={label ? undefined : true}
    >
      <span className="asx-orb__aura" />
      <span className="asx-orb__ring" />
      <span className="asx-orb__body">
        <span className="asx-orb__swirl" />
        <span className="asx-orb__core" />
        <span className="asx-orb__gloss" />
      </span>
    </span>
  );
}
