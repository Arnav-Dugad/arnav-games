import { describe, expect, it } from 'vitest';
import { numericValue, planShift, shapeOf, shiftDirection, shouldShift, SHIFT_CROSSFADE_MS, SHIFT_DIGIT_MS, SHIFT_STAGGER_MS } from './numberShift';

describe('number shift planning', () => {
  it('does nothing when the text is unchanged', () => {
    expect(planShift('$14.99', '$14.99')).toEqual({ mode: 'none' });
  });

  it('rolls only the digits that changed when the shape is the same', () => {
    const plan = planShift('$14.99', '$12.49');
    expect(plan.mode).toBe('digits');
    if (plan.mode !== 'digits') return;
    expect(plan.dir).toBe(-1);
    expect(plan.tokens).toEqual([
      { kind: 'same', text: '$1' },
      { kind: 'roll', from: '4', to: '2', delayMs: 0 },
      { kind: 'same', text: '.' },
      { kind: 'roll', from: '9', to: '4', delayMs: SHIFT_STAGGER_MS },
      { kind: 'same', text: '9' },
    ]);
    expect(plan.durationMs).toBe(SHIFT_DIGIT_MS + SHIFT_STAGGER_MS);
  });

  it('rolls up when the number grows', () => {
    const plan = planShift('1,284', '1,291');
    expect(plan.mode === 'digits' && plan.dir).toBe(1);
  });

  it('crossfades when the currency or the length changes', () => {
    expect(planShift('$14.99', '≈ ₹1,299')).toEqual({ mode: 'crossfade', dir: 1, durationMs: SHIFT_CROSSFADE_MS });
    expect(planShift('999', '1,000').mode).toBe('crossfade');
    expect(planShift('1,000', '999')).toMatchObject({ mode: 'crossfade', dir: -1 });
    expect(planShift('', '12').mode).toBe('crossfade');
  });

  it('crossfades instead of rolling a very long run of changed digits', () => {
    expect(planShift('1,111,111,111', '2,222,222,222').mode).toBe('crossfade');
  });

  it('keeps grapheme-safe characters (₹, €, narrow spaces) as single tokens', () => {
    const plan = planShift('₹1,299', '₹1,399');
    expect(plan.mode).toBe('digits');
    if (plan.mode === 'digits') expect(plan.tokens[0]).toEqual({ kind: 'same', text: '₹1,' });
  });
});

describe('numeric value (direction only)', () => {
  it.each([
    ['$14.99', 14.99],
    ['1,299', 1299],
    ['1.299,50 €', 1299.5],
    ['₹1,29,999', 129999],
    ['−5', -5],
    ['-12.5%', -12.5],
    ['CHF 1’234', 1234],
    ['nothing', null],
  ])('%s → %s', (text, value) => {
    expect(numericValue(text)).toBe(value);
  });

  it('orders durations within one format', () => {
    expect(shiftDirection('12h 30m', '12h 5m')).toBe(-1);
    expect(shiftDirection('2h 5m', '12h 0m')).toBe(1);
    expect(shiftDirection('Free', '$5')).toBe(1);
  });
});

describe('shape and gating', () => {
  it('masks digits only', () => {
    expect(shapeOf('≈ ₹1,299')).toBe('≈ ₹#,###');
  });

  it('never animates under reduced motion, in Performance Mode or while hidden', () => {
    expect(shouldShift({ reduced: false, performance: false, hidden: false })).toBe(true);
    expect(shouldShift({ reduced: true, performance: false, hidden: false })).toBe(false);
    expect(shouldShift({ reduced: false, performance: true, hidden: false })).toBe(false);
    expect(shouldShift({ reduced: false, performance: false, hidden: true })).toBe(false);
  });
});
