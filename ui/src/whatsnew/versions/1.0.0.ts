import type { Tour } from '../tours';
import { APP_NAME } from '../../lib/brand';

/** The 1.0.0 tour (3–6 cards). Each card names a feature key and may deep-link to it. */
export const tour: Omit<Tour, 'source'> = {
  version: '1.0.0',
  title: `Meet ${APP_NAME} 1.0`,
  subtitle: 'VYSTRAL has a new name and a new mark. Your library, settings and history carried over, and updates keep coming the same way.',
  cards: [
    {
      key: 'brand.arnavGames',
      eyebrow: 'New name',
      title: `VYSTRAL is now ${APP_NAME}`,
      body: 'A new name, the Ascent mark and a quieter, sharper look across the app, the Start menu and the taskbar. Everything you had is still here.',
      icon: 'sparkles',
      hue: 265,
    },
    {
      key: 'assistant.memory',
      eyebrow: 'Assistant',
      title: 'An Assistant that remembers, and listens',
      body: 'Tell it what you like once and it remembers, on this PC, where you can see and forget anything. Hold to talk with Windows’ on-device speech, get a Sunday recap as a notification, and short AI summaries on game pages.',
      icon: 'bell',
      hue: 290,
      action: { label: 'Open the Assistant', to: { name: 'assistant' } },
    },
    {
      key: 'performance.trends',
      eyebrow: 'Performance',
      title: 'Know why a session lagged',
      body: 'Temperature trends that warn before they matter, frame-rate goals per game, notes when your graphics driver changes, and how your laptop plays on battery against plugged in.',
      icon: 'activity',
      hue: 25,
      action: { label: 'See your trends', to: { name: 'performance', tab: 'trends' } },
    },
    {
      key: 'library.covers',
      eyebrow: 'Library',
      title: 'Collections with covers, and 100% moments',
      body: 'Collections get collage covers in their own colour. Finishing every achievement gets a proper ceremony and a card to keep. Similar in your library now explains itself by tag, and your wishlist counts the years.',
      icon: 'trophy',
      hue: 45,
      action: { label: 'Open the Library', to: { name: 'library' } },
    },
    {
      key: 'appearance.living',
      eyebrow: 'Appearance',
      title: 'A living app, in your game’s colours',
      body: 'Take the whole accent from a favourite game’s cover, checked for contrast. The sidebar moves with you, numbers roll to their new values, and the Living Canvas gains depth and time-of-day warmth.',
      icon: 'palette',
      hue: 200,
      action: { label: 'Open Appearance', to: { name: 'settings', section: 'appearance' } },
    },
    {
      key: 'settings.startPage',
      eyebrow: 'Your start',
      title: 'Open where you want',
      body: `Choose the page ${APP_NAME} opens on: Home, Library, Discover, the last page you were on, or Immersive Mode. Xbox games now match exactly through their Microsoft Store IDs, too.`,
      icon: 'rocket',
      hue: 150,
      action: { label: 'Choose a start page', to: { name: 'settings', section: 'appearance', row: 'start-page' } },
    },
  ],
};
