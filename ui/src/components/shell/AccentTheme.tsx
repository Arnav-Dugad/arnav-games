import { useEffect, useMemo } from 'react';
import { accentSetFromCss, accentSetVars, type AccentSet } from '../../lib/accentSet';
import { coverPaletteFor } from '../../lib/palette';
import { deriveSystemAccent } from '../../lib/systemAccent';
import { useAccentTheme, useCoverGame } from '../../state/accentTheme';
import { useStore } from '../../state/store';
import { useSystemAppearance } from '../../state/systemAppearance';
import './accent-set.css';

const VARS = Object.keys(accentSetVars(accentSetFromCss('oklch(0.7 0.17 292)')!));

/**
 * Track E2b: applies a full, contrast-checked accent set (lib/accentSet.ts) for "Use a game's colours" and for the
 * Windows accent: one set of tokens per theme kind, so accent text, fills, washes and the focus ring all meet AA
 * in Obsidian, OLED and Light. High contrast ignores it (accent-set.css). No markup.
 *
 * The cover's colours come from the same palette extraction the Living Canvas uses (in its worker), including the
 * cover's own, un-blended colours (`vivid`).
 */
export function AccentTheme() {
  const accent = useStore((s) => s.settings?.['appearance.accent']);
  const preview = useAccentTheme((s) => s.previewGameId);
  const game = useCoverGame();
  const appearance = useSystemAppearance((s) => s.appearance);
  const sets = useAccentTheme((s) => s.sets);
  const savedId = useStore((s) => s.settings?.['appearance.accentGame']);
  const saved = useStore((s) => (savedId ? s.gamesById.get(savedId) ?? null : null));

  // Cover colours, analysed off the main thread (usually already cached with the game): the active game's, and
  // the saved game's (its swatch in Settings) even while another accent is in use.
  useEffect(() => {
    for (const g of [game, saved]) {
      if (!g || useAccentTheme.getState().sets[g.id]) continue;
      void coverPaletteFor(g).then((p) => {
        const set = accentSetFromCss(p.vivid ?? p.accent, p.vivid2 ?? p.accent2);
        if (set) useAccentTheme.setState((st) => ({ sets: { ...st.sets, [g.id]: set } }));
      });
    }
  }, [game, saved]);

  const system = useMemo(() => {
    if (accent !== 'system' || preview || !appearance) return null;
    const d = deriveSystemAccent(appearance.accent, appearance.accentLight);
    const set = d ? accentSetFromCss(d.accent, d.accent2) : null;
    return d && set ? { set, game: [d.accent, d.accent2] as const } : null;
  }, [accent, preview, appearance]);

  const coverSet = game ? sets[game.id] ?? null : null;
  const active: { source: 'cover' | 'system'; gameId: string | null; set: AccentSet; game: readonly [string, string] } | null = coverSet
    ? { source: 'cover', gameId: game!.id, set: coverSet, game: [coverSet.dark.accent, coverSet.dark.accent2] }
    : system
      ? { source: 'system', gameId: null, set: system.set, game: system.game }
      : null;

  useEffect(() => {
    const root = document.documentElement;
    useAccentTheme.setState({ applied: active && { source: active.source, gameId: active.gameId, set: active.set } });
    if (!active) {
      if (!root.dataset.accentSet) return;
      delete root.dataset.accentSet;
      for (const v of VARS) root.style.removeProperty(v);
      return;
    }
    for (const [k, v] of Object.entries(accentSetVars(active.set))) root.style.setProperty(k, v);
    // --game drives everything that isn't a token (the canvas glow, gradients): the dark-theme accent for a cover,
    // and the same value SystemBackdrop derives for the Windows accent (re-applied here after a cover preview).
    root.style.setProperty('--game', active.game[0]);
    root.style.setProperty('--game-2', active.game[1]);
    root.dataset.accentSet = active.source;
    // `active` is rebuilt every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.source, active?.gameId, active?.set]);

  return null;
}
