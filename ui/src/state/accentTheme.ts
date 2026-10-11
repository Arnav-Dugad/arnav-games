import { create } from 'zustand';
import type { Game } from '../bridge/types';
import type { AccentSet } from '../lib/accentSet';
import { useStore } from './store';

/**
 * Track E2b: "Use a game's colours". The chosen game is a setting (`appearance.accent` = 'cover' plus
 * `appearance.accentGame`); while the picker is open, a game being previewed overrides it live without saving
 * anything, and Cancel simply clears the preview.
 */
interface AccentThemeState {
  /** The game being previewed in the picker (not saved), or null. */
  previewGameId: string | null;
  /** The set currently applied to the page (cover or Windows accent), or null for the regular accents. */
  applied: { source: 'cover' | 'system'; gameId: string | null; set: AccentSet } | null;
  /** Accent sets already built from covers, by game id (the saved game's feeds its swatch in Settings). */
  sets: Record<string, AccentSet>;
}

export const useAccentTheme = create<AccentThemeState>(() => ({ previewGameId: null, applied: null, sets: {} }));

export const setAccentPreview = (gameId: string | null) => useAccentTheme.setState({ previewGameId: gameId });

/** The game whose colours the accent comes from right now (preview first, then the setting), if it still exists. */
export function useCoverGame(): Game | null {
  const preview = useAccentTheme((s) => s.previewGameId);
  const accent = useStore((s) => s.settings?.['appearance.accent']);
  const saved = useStore((s) => s.settings?.['appearance.accentGame']);
  const id = preview ?? (accent === 'cover' ? saved : null);
  return useStore((s) => (id ? s.gamesById.get(id) ?? null : null));
}

/** Where the "before" accent is remembered, so Revert can go back to it. Per-device convenience only. */
const BEFORE_KEY = 'vystral.accentBeforeCover';

export function rememberAccentBefore(value: string) {
  try {
    if (value !== 'cover') localStorage.setItem(BEFORE_KEY, value);
  } catch {
    /* storage unavailable: Revert falls back to Automatic */
  }
}

export function accentBefore(): string {
  try {
    const v = localStorage.getItem(BEFORE_KEY);
    if (v && /^(auto|violet|blue|cyan|rose|amber|emerald|system)$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}
