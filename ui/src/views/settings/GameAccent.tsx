import { useEffect, useMemo, useState } from 'react';
import { Check, Palette, RotateCcw, Search } from 'lucide-react';
import type { Game } from '../../bridge/types';
import { AA_NON_TEXT, AA_TEXT, passesAA, type AccentSet, type ThemeKind } from '../../lib/accentSet';
import { accentBefore, rememberAccentBefore, setAccentPreview, useAccentTheme } from '../../state/accentTheme';
import { useStore } from '../../state/store';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/primitives';
import { GameCover } from '../../components/game/GameCover';
import './game-accent.css';

/** How many games the picker shows at once (search narrows it). */
const SHOWN = 48;

/** Recently played first, then favourites, then A–Z; hidden games never appear. */
export function pickerGames(games: readonly Game[], query: string): Game[] {
  const q = query.trim().toLocaleLowerCase();
  return games
    .filter((g) => !g.hidden && (!q || g.title.toLocaleLowerCase().includes(q)))
    .sort((a, b) => (b.lastTrackedPlay ?? '').localeCompare(a.lastTrackedPlay ?? '') || Number(b.favorite) - Number(a.favorite) || a.sortTitle.localeCompare(b.sortTitle))
    .slice(0, SHOWN);
}

const themeKind = (theme: string | undefined): ThemeKind => (theme === 'light' ? 'light' : 'dark');

/**
 * Track E2b: Settings › Appearance › "Use a game's colours". Pick any game; its cover's colours become a full
 * accent (accent, hover, wash, focus ring, text on accent), each pairing checked for WCAG AA in the current theme.
 * Picking previews live across the whole app; nothing is saved until "Use these colours", and Cancel (or Escape)
 * puts everything back. Revert returns to the accent you had before.
 */
export function GameAccentRow() {
  const accent = useStore((s) => s.settings?.['appearance.accent']);
  const savedId = useStore((s) => s.settings?.['appearance.accentGame'] ?? '');
  const saved = useStore((s) => (savedId ? s.gamesById.get(savedId) : undefined));
  const theme = useStore((s) => s.settings?.['appearance.theme']);
  const setSetting = useStore((s) => s.setSetting);
  const [open, setOpen] = useState(false);
  const active = accent === 'cover' && !!saved;

  const revert = () => void setSetting('appearance.accent', accentBefore() as never);

  return (
    <div className="srow" data-testid="game-accent">
      <div className="srow__text">
        <div className="srow__label" id="game-accent-label">Use a game’s colours</div>
        <div className="srow__hint">
          {accent === 'cover' && savedId && !saved
            ? 'That game is no longer in your library, so the accent follows the artwork for now.'
            : theme === 'contrast'
              ? 'High contrast always keeps its own colours. A game’s colours apply when you switch to another theme.'
              : 'Turns any game’s cover into a full accent, adjusted so text, buttons and focus rings stay readable in every theme.'}
        </div>
      </div>
      <div className="srow__control gacc-row">
        {active && saved && (
          <span className="gacc-current">
            <span className="gacc-current__cover"><GameCover game={saved} /></span>
            <span className="gacc-current__title" title={saved.title}>{saved.title}</span>
          </span>
        )}
        <Button size="sm" icon={<Palette size={14} />} onClick={() => setOpen(true)} aria-describedby="game-accent-label">
          {active ? 'Change…' : 'Choose a game…'}
        </Button>
        {accent === 'cover' && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={revert}>Revert</Button>
        )}
      </div>
      <GameAccentPicker open={open} onClose={() => setOpen(false)} initial={active ? savedId : null} themeKind={themeKind(theme)} contrastTheme={theme === 'contrast'} />
    </div>
  );
}

function GameAccentPicker({ open, onClose, initial, themeKind: kind, contrastTheme }: { open: boolean; onClose: () => void; initial: string | null; themeKind: ThemeKind; contrastTheme: boolean }) {
  const games = useStore((s) => s.library.games);
  const accent = useStore((s) => s.settings?.['appearance.accent']);
  const setSetting = useStore((s) => s.setSetting);
  const previewId = useAccentTheme((s) => s.previewGameId);
  const applied = useAccentTheme((s) => s.applied);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => pickerGames(games, query), [games, query]);
  const selected = previewId ?? initial;
  const set = applied?.source === 'cover' && applied.gameId === selected ? applied.set : null;

  // Leaving the picker in any way clears the preview (Cancel, Escape, closing Settings).
  useEffect(() => {
    if (!open) return;
    return () => setAccentPreview(null);
  }, [open]);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const apply = async () => {
    if (!selected) return;
    if (accent) rememberAccentBefore(accent);
    await setSetting('appearance.accentGame', selected);
    await setSetting('appearance.accent', 'cover');
    setAccentPreview(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Use a game’s colours"
      describedBy="gacc-desc"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Check size={15} />} disabled={!selected || !set} onClick={() => void apply()}>Use these colours</Button>
        </>
      }
    >
      <p id="gacc-desc" className="gacc-desc">
        Pick a game to preview its colours across VYSTRAL. Nothing changes until you choose “Use these colours”.
        {contrastTheme && ' High contrast keeps its own colours, so the preview shows once you switch theme.'}
      </p>
      <div className="gacc">
        <div className="gacc__browse">
          <label className="gacc-search">
            <Search size={14} aria-hidden />
            <input className="input" type="search" placeholder="Search your games" aria-label="Search your games" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
          </label>
          {shown.length === 0 ? (
            <p className="gacc-empty">{games.length ? `No games match “${query.trim()}”.` : 'Your library is empty. Games appear here once VYSTRAL finds them.'}</p>
          ) : (
            <ul className="gacc-grid" aria-label="Games">
              {shown.map((g) => (
                <li key={g.id}>
                  <button type="button" className="gacc-game" aria-pressed={selected === g.id} onClick={() => setAccentPreview(g.id)} title={g.title}>
                    <span className="gacc-game__cover"><GameCover game={g} /></span>
                    <span className="gacc-game__title">{g.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <AccentPreview set={set} kind={kind} pending={!!selected && !set} />
      </div>
    </Dialog>
  );
}

/** The resulting tokens for the current theme, each with its measured contrast. */
function AccentPreview({ set, kind, pending }: { set: AccentSet | null; kind: ThemeKind; pending: boolean }) {
  if (!set) {
    return (
      <div className="gacc-preview gacc-preview--empty" aria-live="polite">
        {pending ? 'Reading the cover’s colours…' : 'Choose a game to see its colours.'}
      </div>
    );
  }
  const t = set[kind];
  const c = set.checks[kind];
  const rows: { name: string; swatch: string; ratio: number; min: number; what: string }[] = [
    { name: 'Accent', swatch: t.accent, ratio: c.onAccent, min: AA_TEXT, what: 'text on it' },
    { name: 'Hover', swatch: t.strong, ratio: c.onAccent, min: AA_TEXT, what: 'text on it' },
    { name: 'Accent text', swatch: t.text, ratio: c.text, min: AA_TEXT, what: 'on panels' },
    { name: 'Focus ring', swatch: t.ring, ratio: c.ring, min: AA_NON_TEXT, what: 'on panels' },
    { name: 'Wash', swatch: t.weak, ratio: c.weak, min: AA_TEXT, what: 'text on it' },
  ];
  const ok = rows.every((r) => r.ratio >= r.min);
  const everywhere = passesAA(set.checks.dark) && passesAA(set.checks.light);
  return (
    <div className="gacc-preview" data-testid="gacc-preview" data-aa={ok}>
      <div className="gacc-sample" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})`, color: t.onAccent }}>
        <span className="gacc-sample__play">Play</span>
      </div>
      <ul className="gacc-tokens" aria-label={`Colours and contrast in the ${kind === 'light' ? 'Light' : 'dark'} themes`}>
        {rows.map((r) => (
          <li key={r.name} data-token={r.name}>
            <span className="gacc-tokens__swatch" style={{ background: r.swatch }} aria-hidden />
            <span className="gacc-tokens__name">{r.name}</span>
            <span className="gacc-tokens__ratio num" data-ratio={r.ratio.toFixed(2)}>
              {r.ratio.toFixed(1)}:1 {r.what}
            </span>
          </li>
        ))}
      </ul>
      <p className="gacc-verdict">
        <Check size={13} aria-hidden /> {ok && everywhere ? 'Meets WCAG AA contrast in Obsidian, OLED and Light.' : 'Some pairs fall short of WCAG AA in this theme; High contrast is always available.'}
      </p>
    </div>
  );
}
