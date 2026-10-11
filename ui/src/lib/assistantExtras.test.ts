import { describe, expect, it } from 'vitest';
import {
  blendSuggestions, decayRate, endsPushToTalk, fillPrompt, isPushToTalk, learnable, levelBars, memoryProblem, mergeDictation, mondayOf, nextRate,
  orbEnergy, promptScore, templatePrompt, weekRange,
} from './assistantExtras';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const asked = (text: string, count: number, daysAgo = 0) => ({ text, count, lastAsked: new Date(NOW - daysAgo * 86_400_000).toISOString() });

describe('learned suggestions', () => {
  it('templates the game title so a question learned on one game page fits every game page', () => {
    expect(templatePrompt('Is  Starfall Tactics good with a controller?', 'Starfall Tactics')).toBe('Is {game} good with a controller?');
    expect(templatePrompt('is starfall tactics on sale?', 'Starfall Tactics')).toBe('is {game} on sale?');
    expect(templatePrompt('What should I play tonight?', null)).toBe('What should I play tonight?');
    expect(templatePrompt('Hades (2018) news', 'Hades (2018)')).toBe('{game} news');
    expect(fillPrompt('Is {game} good?', 'Hades')).toBe('Is Hades good?');
    expect(fillPrompt('Is {game} good?', null)).toBeNull();
    expect(learnable('Is {game} good?')).toBe(true);
    expect(learnable('{game} vs {game}')).toBe(false);
    expect(learnable('use {secret}')).toBe(false);
    expect(learnable('hi')).toBe(false);
  });

  it('puts frequent, recent questions first, needs two asks, and never duplicates a default', () => {
    const defaults = ['What should I play tonight? I have 1 hour', 'Give me my weekly recap', 'What needs my attention?', 'Another default'];
    const learned = [asked('Show my unfinished RPGs', 5, 1), asked('Once only', 1), asked('give me my weekly recap!', 9), asked('Old habit', 6, 120)];
    const out = blendSuggestions(defaults, learned, null, { now: NOW });
    expect(out.map((o) => o.text)).toEqual(['give me my weekly recap!', 'Show my unfinished RPGs', 'What should I play tonight? I have 1 hour', 'What needs my attention?']);
    expect(out.filter((o) => o.learned)).toHaveLength(2);
    expect(promptScore(learned[3], NOW)).toBeLessThan(promptScore(learned[0], NOW));
  });

  it('skips {game} questions off game pages and fills them on one', () => {
    const learned = [asked('Is {game} good with a controller?', 3)];
    expect(blendSuggestions(['A default'], learned, null, { now: NOW }).map((o) => o.text)).toEqual(['A default']);
    expect(blendSuggestions(['A default'], learned, 'Hades', { now: NOW })[0]).toEqual({ text: 'Is Hades good with a controller?', learned: true });
    expect(blendSuggestions(['a', 'b', 'c', 'd', 'e'], undefined).map((o) => o.text)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the thinking orb', () => {
  it('turns streamed characters into a smoothed tokens-per-second rate that decays when idle', () => {
    let r = 0;
    for (let i = 0; i < 40; i++) r = nextRate(r, 40, 100); // 10 tokens per 100 ms = 100 tokens/s
    expect(r).toBeGreaterThan(95);
    expect(r).toBeLessThanOrEqual(100.01);
    expect(nextRate(r, 10, 0)).toBe(r);
    expect(decayRate(100, 900)).toBeCloseTo(36.8, 0);
    expect(nextRate(0, 100_000, 16)).toBeLessThan(400); // a burst can't spike the orb beyond its ceiling
  });

  it('maps speed to energy on a log scale, calm at rest', () => {
    expect(orbEnergy(0)).toBe(0);
    expect(orbEnergy(Number.NaN)).toBe(0);
    expect(orbEnergy(10)).toBeGreaterThan(0.45);
    expect(orbEnergy(40)).toBeGreaterThan(orbEnergy(10));
    expect(orbEnergy(1000)).toBe(1);
  });
});

describe('push-to-talk', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}, code?: string) =>
    ({ key, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });
  it('is Ctrl+Space with nothing else held, and releasing either key ends it', () => {
    expect(isPushToTalk(k(' ', { ctrlKey: true }, 'Space'))).toBe(true);
    expect(isPushToTalk(k(' ', { ctrlKey: true, shiftKey: true }, 'Space'))).toBe(false);
    expect(isPushToTalk(k(' ', {}, 'Space'))).toBe(false);
    expect(isPushToTalk(k('j', { ctrlKey: true }))).toBe(false);
    expect(endsPushToTalk(k('Control'))).toBe(true);
    expect(endsPushToTalk(k(' ', {}, 'Space'))).toBe(true);
    expect(endsPushToTalk(k('a'))).toBe(false);
  });

  it('adds dictated words after the draft without losing it', () => {
    expect(mergeDictation('', ' what should i play ')).toBe('What should i play');
    expect(mergeDictation('Hey,  ', 'what should I play')).toBe('Hey, what should I play');
    expect(mergeDictation('Keep this', '   ')).toBe('Keep this');
  });

  it('shapes the level meter from recent levels, newest on the right', () => {
    const bars = levelBars([0, 25, 100, 400, -5, Number.NaN], 4);
    expect(bars).toHaveLength(4);
    expect(bars[0]).toBeCloseTo(1); // 100
    expect(bars[1]).toBeCloseTo(1); // clamped 400
    expect(bars[2]).toBe(0);
    expect(bars[3]).toBe(0);
    expect(levelBars([], 3)).toEqual([0, 0, 0]);
    expect(levelBars([25], 1)[0]).toBeCloseTo(0.575, 2);
  });
});

describe('memory checks (mirror of the native validation)', () => {
  it('accepts preferences and explains what it refuses', () => {
    expect(memoryProblem('I like short games on weekdays')).toBeNull();
    expect(memoryProblem('  ')).toMatch(/Write what/);
    expect(memoryProblem('hi')).toMatch(/too short/);
    expect(memoryProblem('x'.repeat(201))).toMatch(/under 200/);
    expect(memoryProblem('see https://example.com')).toMatch(/links/);
    expect(memoryProblem('My Steam password is hunter2')).toMatch(/password or a key/);
    expect(memoryProblem('key sk-ant-api03-abc')).toMatch(/password or a key/);
    expect(memoryProblem('a1b2c3d4e5f6g7h8i9j0k1l2m3n4 is my code')).toMatch(/password or a key/);
  });
});

describe('weeks', () => {
  it('finds the Monday and formats a range', () => {
    expect(mondayOf(new Date(2026, 9, 11, 20))).toBe('2026-10-05'); // a Sunday
    expect(mondayOf(new Date(2026, 9, 5, 0, 30))).toBe('2026-10-05');
    expect(weekRange('2026-10-05', '2026-10-11', 'en-GB')).toBe('5–11 Oct');
    expect(weekRange('2026-09-28', '2026-10-04', 'en-GB')).toBe('28 Sept – 4 Oct');
    expect(weekRange('bad', 'worse')).toBe('bad – worse');
  });
});
