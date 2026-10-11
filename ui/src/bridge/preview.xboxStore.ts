/**
 * Track E4 preview: Xbox Store IDs for exact matching. Everything is FICTIONAL (the preview never touches the network):
 * product IDs start with "9NPREVIEW" so they can't be mistaken for real Store products.
 *
 * URL switch: `?xboxstore` turns "Xbox Store details" on, so the preview's Xbox games show a "Microsoft Store" row in their
 * Matched IDs card (found by package lookup), and Circuit Apex's Steam match also comes through Wikidata by that Store ID.
 */
import type { Game, IdEvidence, ProviderStatus, ResolvedId, Settings } from './types';

const params = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const TRACK_E4_DEFAULT_SETTINGS = (): Pick<Settings, 'dataSources.xboxStore'> => ({
  'dataSources.xboxStore': params().has('xboxstore'),
});

/** Mirror of DataSourcesService.Providers (Track E4 row). */
export const TRACK_E4_PROVIDERS: Omit<ProviderStatus, 'configured' | 'keyMasked' | 'enabled' | 'lastTest' | 'pausedUntil'>[] = [
  {
    id: 'xboxstore', name: 'Xbox Store details', access: 'keyless', settingKey: 'dataSources.xboxStore',
    licence: 'Microsoft’s public Store data, shown with attribution. Not a documented API: it may change, and Arnav Games stops quietly if it does.',
    attribution: 'Store IDs and art from the Microsoft Store.', host: 'displaycatalog.mp.microsoft.com, store-images.s-microsoft.com',
    sends: 'The package names of the Xbox games installed on this PC (one request per game, remembered for months) and your Store region.',
    uses: 'Exact Microsoft Store IDs for your Xbox games, so Wikidata, IGDB, GeForce NOW and Game Pass match them by ID instead of by title, and Store covers and backgrounds for Xbox games without good art.',
  },
];

/** A fictional, stable product ID per preview game: "9NPREVIEW" + three letters/digits from its title. */
export function previewProductId(title: string): string {
  let h = 7;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 46656; // 36^3
  return `9NPREVIEW${h.toString(36).toUpperCase().padStart(3, '0')}`;
}

/** The "Microsoft Store" row for a preview Xbox game, when Xbox Store details are on (like IdentityResolverService with Track E4). */
export function previewStoreId(game: Game, settings: Settings): ResolvedId | null {
  if (!settings['dataSources.xboxStore'] || !game.installations.some((i) => i.platform === 'xbox')) return null;
  return {
    kind: 'msstore', label: 'Microsoft Store', value: previewProductId(game.title), confidence: 1, level: 'certain', status: 'native', used: true,
    evidence: [{ source: 'msstore', method: 'packageLookup', confidence: 1 }], name: game.title, link: true,
  };
}

/** Extra Steam evidence a Store ID brings (Wikidata's Microsoft Store product ID), for the preview's matched Xbox game. */
export function previewStoreSteamEvidence(game: Game, settings: Settings): IdEvidence[] {
  return previewStoreId(game, settings) && game.title === 'Circuit Apex' ? [{ source: 'wikidata', method: 'storeId', confidence: 0.95 }] : [];
}
