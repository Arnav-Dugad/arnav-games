/** Track E3: the in-app toast for a `perf.insight` event (a thermal trend or a driver note, announced once). */
import type { PerfInsightEvent } from '../bridge/types';

const HEX32 = /^[0-9a-f]{32}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

function clean(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(CONTROL, '').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Toast text for the event, or null when it's malformed. Thermal notes are warnings; driver notes are information. */
export function perfInsightToast(e: PerfInsightEvent | null | undefined): { tone: 'warning' | 'info'; title: string; body: string } | null {
  if (!e || (e.kind !== 'thermal' && e.kind !== 'driver') || typeof e.sessionId !== 'string' || !HEX32.test(e.sessionId)) return null;
  const title = clean(e.title, 140);
  const body = clean(e.body, 320);
  if (!title || !body) return null;
  return { tone: e.kind === 'thermal' ? 'warning' : 'info', title, body };
}
