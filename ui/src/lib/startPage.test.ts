import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveStartPage, readStartPage, rememberStartPage, START_PAGE_KEY, startPagePatch, startRouteName } from './startPage';

describe('Open on start', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the last page, and the older Immersive switch wins', () => {
    expect(effectiveStartPage(null)).toBe('last');
    expect(effectiveStartPage({ 'startup.page': 'library', 'startup.immersive': false })).toBe('library');
    expect(effectiveStartPage({ 'startup.page': 'library', 'startup.immersive': true })).toBe('immersive');
    expect(effectiveStartPage({ 'startup.page': 'bogus' as never, 'startup.immersive': false })).toBe('last');
  });

  it('writes both settings so they never disagree', () => {
    const off = { 'startup.page': 'last', 'startup.immersive': false } as const;
    expect(startPagePatch('immersive', off)).toEqual({ 'startup.page': 'immersive', 'startup.immersive': true });
    expect(startPagePatch('journal', { 'startup.page': 'immersive', 'startup.immersive': true })).toEqual({ 'startup.page': 'journal', 'startup.immersive': false });
    expect(startPagePatch('last', off)).toEqual({});
  });

  it('remembers the choice for the first frame, ignoring anything unexpected', () => {
    expect(readStartPage()).toBeNull();
    rememberStartPage('wishlist');
    expect(readStartPage()).toBe('wishlist');
    localStorage.setItem(START_PAGE_KEY, 'settings');
    expect(readStartPage()).toBeNull();
    expect(startRouteName('performance')).toBe('performance');
    expect(startRouteName('last')).toBeNull();
    expect(startRouteName('immersive')).toBeNull();
    expect(startRouteName(null)).toBeNull();
  });
});
