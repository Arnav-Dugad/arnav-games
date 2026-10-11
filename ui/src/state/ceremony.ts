/**
 * Track E2a: which game's Completed 100% ceremony is showing. It opens once per game, the first time you mark it
 * Completed 100% (see lib/ceremony.ts); undoing the status closes it.
 */
import { create } from 'zustand';
import { markCelebrated } from '../lib/ceremony';

interface CeremonyState {
  gameId: string | null;
  /** When the status was set (the card's date). */
  at: number;
  open(gameId: string): void;
  close(gameId?: string): void;
}

export const useCeremony = create<CeremonyState>((set, get) => ({
  gameId: null,
  at: 0,
  open: (gameId) => set({ gameId, at: Date.now() }),
  close: (gameId) => {
    if (!gameId || get().gameId === gameId) set({ gameId: null });
  },
}));

/** Opens the ceremony for a game marked Completed 100% — unless it already had one. */
export function celebrateCompletion(gameId: string): boolean {
  if (!markCelebrated(gameId)) return false;
  useCeremony.getState().open(gameId);
  return true;
}
