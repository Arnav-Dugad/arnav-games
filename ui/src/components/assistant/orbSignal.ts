import { useSyncExternalStore } from 'react';
import type { AssistantEvent } from '../../bridge/types';
import { decayRate, nextRate, orbEnergy, type OrbPhase } from '../../lib/assistantExtras';

/**
 * Track E1: what the thinking orb reacts to. Fed by every `assistant.event` of the active answer: streaming speed
 * (tokens a second, smoothed), a pulse on each look-up or prepared change, and the phase. Read every frame by the orb
 * without re-rendering React; only phase changes notify subscribers.
 */
const s = { phase: 'idle' as OrbPhase, rate: 0, at: 0, pulse: 0, pulseAt: 0 };
const listeners = new Set<() => void>();
let errorTimer: number | undefined;

function setPhase(p: OrbPhase) {
  if (s.phase === p) return;
  s.phase = p;
  for (const l of listeners) l();
}

function pulse(strength: number) {
  s.pulse = Math.min(1, orbPulse() + strength);
  s.pulseAt = performance.now();
}

export function orbFeed(e: AssistantEvent) {
  const now = performance.now();
  window.clearTimeout(errorTimer);
  switch (e.type) {
    case 'start':
      s.rate = 0;
      s.at = now;
      setPhase('thinking');
      break;
    case 'delta':
      s.rate = nextRate(s.rate, e.text.length, Math.max(16, now - s.at));
      s.at = now;
      setPhase('streaming');
      break;
    case 'tool':
      if (e.call.status === 'running') { pulse(0.9); setPhase('tool'); }
      else if (e.call.status === 'proposed') { pulse(0.6); setPhase('waiting'); }
      else { pulse(0.35); if (s.phase === 'tool') setPhase('thinking'); }
      break;
    case 'approval':
    case 'action':
      pulse(0.5);
      setPhase('waiting');
      break;
    case 'done':
      setPhase('idle');
      break;
    case 'error':
      setPhase('error');
      errorTimer = window.setTimeout(() => setPhase('idle'), 2600);
      break;
  }
}

/** Called when the request ends without a final event (stopped, or the page dropped it). */
export function orbIdle() {
  setPhase('idle');
}

/** The pulse decays over about 700 ms. */
export function orbPulse(now = performance.now()): number {
  return s.pulse * Math.exp(-(now - s.pulseAt) / 700);
}

/** Energy 0..1 from the current streaming speed (decaying when nothing arrives). */
export function orbLevel(now = performance.now()): number {
  return orbEnergy(decayRate(s.rate, now - s.at));
}

export function orbPhase(): OrbPhase {
  return s.phase;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useOrbPhase(): OrbPhase {
  return useSyncExternalStore(subscribe, orbPhase, orbPhase);
}

/** Test and preview hook: drive the orb directly. */
export function __orbForTests(phase: OrbPhase, rate = 0) {
  s.rate = rate;
  s.at = performance.now();
  setPhase(phase);
}
