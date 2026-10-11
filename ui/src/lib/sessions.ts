/**
 * Track H: where a session came from. Everything Arnav Games observed itself ('tracked', 'detected',
 * 'background') counts the same in the journal, statistics and performance views; only store-imported
 * playtime is kept apart.
 */
import type { SessionSource } from '../bridge/types';

export type ObservedSource = Exclude<SessionSource, 'imported'>;

/** True for sessions Arnav Games recorded itself, however it noticed the game. */
export function isObserved(source: string | null | undefined): source is ObservedSource {
  return source === 'tracked' || source === 'detected' || source === 'background' || isCloud(source);
}

/** Track O: a cloud stream started from Arnav Games (time estimated from the app or window it saw; no performance data). */
export function isCloud(source: string | null | undefined): source is 'cloud-gfn' | 'cloud-xbox' {
  return source === 'cloud-gfn' || source === 'cloud-xbox';
}

/** A short, honest note for sessions Arnav Games didn't launch; null for launches from Arnav Games. */
export function sessionOrigin(source: string | null | undefined): { label: string; title: string } | null {
  if (source === 'background') return { label: 'Background', title: 'Tracked by the background tracker while Arnav Games was closed' };
  if (source === 'detected') return { label: 'Detected', title: 'Started outside Arnav Games and noticed while Arnav Games was open' };
  if (source === 'cloud-gfn') return { label: 'GeForce NOW', title: 'Streamed with GeForce NOW from Arnav Games; time estimated from what Arnav Games saw' };
  if (source === 'cloud-xbox') return { label: 'Xbox Cloud', title: 'Streamed with Xbox Cloud Gaming from Arnav Games; time estimated from what Arnav Games saw' };
  return null;
}
