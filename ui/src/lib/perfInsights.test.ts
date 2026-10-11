import { describe, expect, it } from 'vitest';
import { perfInsightToast } from './perfInsights';

const sid = '0123456789abcdef0123456789abcdef';

describe('perf.insight toast', () => {
  it('turns a driver note into an information toast and a thermal note into a warning', () => {
    expect(perfInsightToast({ kind: 'driver', sessionId: sid, gameId: sid, title: 'Driver 617.42: Forza Horizon 4 +2 fps average, 1% lows −3 fps', body: 'Your first session…' }))
      .toEqual({ tone: 'info', title: 'Driver 617.42: Forza Horizon 4 +2 fps average, 1% lows −3 fps', body: 'Your first session…' });
    expect(perfInsightToast({ kind: 'thermal', sessionId: sid, gameId: sid, title: 'Your GPU runs 7 °C hotter in X', body: 'b' })!.tone).toBe('warning');
  });

  it('drops malformed events and strips control and bidi characters', () => {
    expect(perfInsightToast(null)).toBeNull();
    expect(perfInsightToast({ kind: 'other' as 'driver', sessionId: sid, gameId: sid, title: 't', body: 'b' })).toBeNull();
    expect(perfInsightToast({ kind: 'driver', sessionId: 'nope', gameId: sid, title: 't', body: 'b' })).toBeNull();
    expect(perfInsightToast({ kind: 'driver', sessionId: sid, gameId: sid, title: '‮\u0007', body: 'b' })).toBeNull();
    expect(perfInsightToast({ kind: 'driver', sessionId: sid, gameId: sid, title: 'A‮B', body: 'x'.repeat(400) })).toMatchObject({ title: 'AB', body: `${'x'.repeat(319)}…` });
  });
});
