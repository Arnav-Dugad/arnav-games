/**
 * Track E2a: "Open on start" — which page Arnav Games opens on: a fixed page, Immersive Mode, or the last page you were
 * on (the behaviour before this setting existed, and still the default).
 *
 * The first frame must already be the right page (Track AA paints before settings arrive), so the choice is mirrored
 * to localStorage whenever settings change and read synchronously when the store is created. Immersive Mode is
 * switched on by the host before the page loads (`startup.immersive`, which this setting keeps in step), so the
 * desktop route underneath it is simply the last page.
 */
import type { Settings } from '../bridge/types';

export type StartPage = Settings['startup.page'];

export const START_PAGES: readonly { value: StartPage; label: string }[] = [
  { value: 'last', label: 'The last page you were on' },
  { value: 'home', label: 'Home' },
  { value: 'library', label: 'Library' },
  { value: 'discover', label: 'Discover' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'journal', label: 'Journal' },
  { value: 'performance', label: 'Performance' },
  { value: 'immersive', label: 'Immersive Mode' },
];

export const START_PAGE_KEY = 'vystral.startPage';

export const isStartPage = (v: unknown): v is StartPage => typeof v === 'string' && START_PAGES.some((p) => p.value === v);

/**
 * The page the settings ask for. "Start in Immersive Mode" (the older switch, still in Controller settings) wins, so
 * the two never disagree about what happens.
 */
export function effectiveStartPage(s: Pick<Settings, 'startup.page' | 'startup.immersive'> | null | undefined): StartPage {
  if (!s) return 'last';
  if (s['startup.immersive']) return 'immersive';
  return isStartPage(s['startup.page']) ? s['startup.page'] : 'last';
}

/** The two settings to write for a choice (both, so Immersive and the old switch stay in step). */
export function startPagePatch(page: StartPage, current: Pick<Settings, 'startup.page' | 'startup.immersive'>): Partial<Pick<Settings, 'startup.page' | 'startup.immersive'>> {
  const patch: Partial<Pick<Settings, 'startup.page' | 'startup.immersive'>> = {};
  if (current['startup.page'] !== page) patch['startup.page'] = page;
  if (current['startup.immersive'] !== (page === 'immersive')) patch['startup.immersive'] = page === 'immersive';
  return patch;
}

/** The choice remembered from the last time settings were seen (null when unknown, or storage is unavailable). */
export function readStartPage(): StartPage | null {
  try {
    const v = localStorage.getItem(START_PAGE_KEY);
    return isStartPage(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberStartPage(page: StartPage) {
  try {
    if (localStorage.getItem(START_PAGE_KEY) !== page) localStorage.setItem(START_PAGE_KEY, page);
  } catch {
    // storage unavailable — the next start reconciles once settings arrive
  }
}

/** A route by name for a fixed start page; null for "last" and "immersive" (they restore the last page). */
export function startRouteName(page: StartPage | null): 'home' | 'library' | 'discover' | 'wishlist' | 'journal' | 'performance' | null {
  return page && page !== 'last' && page !== 'immersive' ? page : null;
}
