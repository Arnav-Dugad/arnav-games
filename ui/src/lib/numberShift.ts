/**
 * Track E2b: smooth number changes. When a price or a key number changes in place (a currency switch, a price
 * refresh, a sale, a counter ticking), the old value hands over to the new one instead of snapping:
 *
 * - **Digits** — same shape (same length, same symbols and separators in the same places, e.g. "$14.99" → "$12.49"):
 *   only the digits that changed roll, like an odometer, up when the number grew and down when it shrank, each a
 *   few milliseconds after the one to its left. Unchanged characters never move.
 * - **Crossfade** — anything else ("$14.99" → "≈ ₹1,299", "999" → "1,000", "12h 30m" → "1h 5m"): the old text
 *   lifts out and fades while the new one rises in, in the same direction rule.
 *
 * Pure planning lives here (unit-tested); the component is `components/ui/NumberShift.tsx`. The component never
 * animates under reduced motion, in Performance Mode or while the window is hidden, and screen readers only ever
 * get the final value.
 */

export type ShiftToken =
  | { kind: 'same'; text: string }
  | { kind: 'roll'; from: string; to: string; delayMs: number };

export type ShiftPlan =
  | { mode: 'none' }
  | { mode: 'digits'; dir: 1 | -1; tokens: ShiftToken[]; durationMs: number }
  | { mode: 'crossfade'; dir: 1 | -1; durationMs: number };

/** One digit's roll, and the gap before the next changed digit starts. */
export const SHIFT_DIGIT_MS = 420;
export const SHIFT_STAGGER_MS = 34;
export const SHIFT_CROSSFADE_MS = 380;
/** Very long strings (or many changed digits) read as noise when they roll: they crossfade instead. */
export const SHIFT_MAX_ROLLING_DIGITS = 8;

const isDigit = (c: string) => c >= '0' && c <= '9';

/** "$14.99" → "$##.##": the text's shape, with every digit masked. */
export function shapeOf(text: string): string {
  let out = '';
  for (const c of text) out += isDigit(c) ? '#' : c;
  return out;
}

/**
 * Best-effort numeric value of a formatted number, used only to pick the direction of the motion. Handles
 * "1,299.50", "1.299,50", "₹1,29,999", "12h 30m" (→ 1230, still monotonic within one format) and negatives.
 * Returns null when there are no digits.
 */
export function numericValue(text: string): number | null {
  const m = /[-−]?\d[\d.,\s  ']*/.exec(text);
  if (!m) return null;
  const negative = /^[-−]/.test(m[0]);
  let s = m[0].replace(/^[-−]/, '').replace(/[\s  ']/g, '').replace(/[.,]$/, '');
  // The last separator followed by one or two digits at the end is a decimal point; every other one groups.
  const dec = /[.,](\d{1,2})$/.exec(s);
  let frac = '';
  if (dec) {
    frac = dec[1];
    s = s.slice(0, dec.index);
  }
  const whole = s.replace(/[.,]/g, '');
  // Text like "12h 30m": the regex stops at the first letter; add the remaining digits so 12h 30m > 12h 5m.
  const rest = text.slice(m.index + m[0].length).replace(/\D/g, '');
  const n = Number(`${whole}${rest}${frac ? `.${frac}` : ''}`);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Up (+1) when the number grew, down (−1) when it shrank; up when unknown. */
export function shiftDirection(from: string, to: string): 1 | -1 {
  const a = numericValue(from);
  const b = numericValue(to);
  if (a == null || b == null) return 1;
  return b < a ? -1 : 1;
}

/** Plans how `from` hands over to `to`. */
export function planShift(from: string, to: string): ShiftPlan {
  if (from === to) return { mode: 'none' };
  const dir = shiftDirection(from, to);
  const a = [...from];
  const b = [...to];
  if (!from || !to || a.length !== b.length || shapeOf(from) !== shapeOf(to)) {
    return { mode: 'crossfade', dir, durationMs: SHIFT_CROSSFADE_MS };
  }
  const tokens: ShiftToken[] = [];
  let run = '';
  let changed = 0;
  for (let i = 0; i < b.length; i++) {
    if (a[i] === b[i]) {
      run += b[i];
      continue;
    }
    if (run) tokens.push({ kind: 'same', text: run });
    run = '';
    tokens.push({ kind: 'roll', from: a[i], to: b[i], delayMs: changed * SHIFT_STAGGER_MS });
    changed++;
  }
  if (run) tokens.push({ kind: 'same', text: run });
  if (changed > SHIFT_MAX_ROLLING_DIGITS) return { mode: 'crossfade', dir, durationMs: SHIFT_CROSSFADE_MS };
  return { mode: 'digits', dir, tokens, durationMs: SHIFT_DIGIT_MS + (changed - 1) * SHIFT_STAGGER_MS };
}

/** Whether a change should animate at all. */
export function shouldShift(c: { reduced: boolean; performance: boolean; hidden: boolean }): boolean {
  return !c.reduced && !c.performance && !c.hidden;
}
