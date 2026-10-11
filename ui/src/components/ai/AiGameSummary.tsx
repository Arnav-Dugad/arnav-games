import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { call, errorMessage } from '../../bridge/bridge';
import type { Game, GameSummary } from '../../bridge/types';
import { useStore } from '../../state/store';
import { Button, Skeleton } from '../ui/primitives';
import { AiNote, WhatWasSent } from './AiBits';
import '../assistant/assistant-extras.css';

const cache = new Map<string, GameSummary>();

/**
 * Track E1: a two-line "what is this game" for a game without a description, written by the chosen AI only from facts
 * Arnav Games already has (genres, IGDB/RAWG facts, Steam community tags). Always labelled "AI summary from …", never shown
 * as the game's description; cached and regenerable. With the Game summaries switch off (the default) it waits for a
 * click; without an AI or enough facts it shows `children` (the usual "No description available").
 */
export function AiGameSummary({ game, children }: { game: Game; children: ReactNode }) {
  const featureOn = useStore((s) => !!s.settings?.['ai.features.gameSummaries']);
  const [data, setData] = useState<GameSummary | null>(cache.get(game.id) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (opts: { refresh?: boolean; ask?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<GameSummary>('aix.gameSummary', { gameId: game.id, refresh: opts.refresh ?? false, ask: opts.ask ?? false }, 120_000);
      if (r.text || !cache.get(game.id)?.text) cache.set(game.id, r);
      setData(r.text ? r : cache.get(game.id) ?? r);
      if (!r.text && r.note && (opts.ask || opts.refresh)) setError(r.note);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (game.description) return;
    const hit = cache.get(game.id);
    setData(hit ?? null);
    setError(null);
    if (!hit?.text) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.description, featureOn]);

  if (game.description) return null;
  if (busy && !data?.text) {
    return (
      <div className="ai-summary" aria-busy="true" aria-label="Writing a summary">
        <Skeleton height={14} width="88%" /><Skeleton height={14} width="64%" />
      </div>
    );
  }
  if (data?.text) {
    const sources = data.sources.length ? data.sources.join(', ') : 'facts Arnav Games has';
    return (
      <div className="ai-summary" data-stale={data.stale || undefined}>
        <p className="ai-summary__label">
          <Sparkles size={13} aria-hidden /> <span>AI summary from {sources}</span>
        </p>
        <p className="ai-summary__text selectable">
          {data.text.split('\n').map((l, i) => <span key={i}>{l}</span>)}
        </p>
        <p className="ai-summary__meta">
          {data.aiLabel ? `Worded by ${data.aiLabel}. ` : ''}Not an official description: written from the facts above{data.stale ? ', which have changed since. Regenerate to update it.' : '.'}
        </p>
        <div className="ai-summary__actions">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={13} aria-hidden />} loading={busy} disabled={busy || !data.engine.ready} onClick={() => void run({ refresh: true, ask: true })}>
            Regenerate
          </Button>
          <WhatWasSent sent={data.sent} compact />
        </div>
        {error && <AiNote>{error}</AiNote>}
      </div>
    );
  }
  // No summary yet: the usual text, plus a one-off button when an AI is ready and there are enough facts.
  const canAsk = !!data && data.engine.ready && !data.needsAi && data.factCount >= 3;
  return (
    <>
      {children}
      {canAsk && !featureOn && (
        <div className="ai-summary__ask">
          <Button size="sm" variant="secondary" icon={<Sparkles size={13} aria-hidden />} loading={busy} onClick={() => void run({ ask: true })}>
            Write a 2-line summary with AI
          </Button>
          <span>From its genres, tags and IGDB/RAWG facts. Labelled as AI, never as the official description.</span>
        </div>
      )}
      {error && <AiNote>{error}</AiNote>}
    </>
  );
}
