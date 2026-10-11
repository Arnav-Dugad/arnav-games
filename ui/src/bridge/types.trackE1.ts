// Track E1: Assistant upgrades and AI extras (mirror of src/Vystral.Windows/Ai/Extras/* and AppBackend.TrackE1.cs).
import type { AiEngine } from './types.ai';

/** One thing the user asked the Assistant to remember. `origin`: confirmed in a chat, or typed by you. */
export interface AssistantMemory {
  id: string;
  text: string;
  origin: 'chat' | 'you';
  createdAt: string;
  updatedAt: string;
}

/** call('assistant.memory.list') and the `assistant.memory.changed` event. */
export interface AssistantMemoryList {
  enabled: boolean;
  items: AssistantMemory[];
  max: number;
  maxChars: number;
}

/** call('voice.status'). `fix` says what would make voice input work. */
export interface VoiceStatus {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  fix: 'setting' | 'microphone' | 'language' | 'device' | null;
  language: string | null;
  languageName: string | null;
  engine: string;
  /** Recognition runs on this PC (Windows' desktop speech recognizer); audio is never sent anywhere. */
  onDevice: boolean;
  listening: boolean;
}

/** `voice.event`: one push-to-talk hold. `partial` carries the whole text so far; `end` the final text. */
export type VoiceEvent =
  | { sessionId: string; type: 'start'; language: string }
  | { sessionId: string; type: 'level'; level: number }
  | { sessionId: string; type: 'partial'; text: string }
  | { sessionId: string; type: 'notice'; message: string }
  | { sessionId: string; type: 'end'; text: string; cancelled: boolean }
  | { sessionId: string; type: 'error'; message: string; text?: string };

export interface RecapGame {
  gameId: string;
  title: string;
  seconds: number;
}

/** call('assistant.recap.get', { week? }): one week of play, computed on this PC. */
export interface WeeklyRecapCard {
  week: string;
  from: string;
  to: string;
  totalSeconds: number;
  sessions: number;
  daysPlayed: number;
  topGames: RecapGame[];
  longest: { title: string; seconds: number; day: string } | null;
  firstTime: string[];
  previousWeekSeconds: number;
  summary: string;
  /** The week is over (false while it's still going). */
  finished: boolean;
}

/** call('aix.gameSummary', { gameId, refresh?, ask? }). Never the game's description: always labelled as an AI summary. */
export interface GameSummary {
  gameId: string;
  text: string | null;
  sources: string[];
  aiLabel: string | null;
  cached: boolean;
  /** The facts changed since this was written. */
  stale: boolean;
  note: string | null;
  needsAi: boolean;
  featureOn: boolean;
  factCount: number;
  engine: AiEngine;
  sent: string | null;
}

export interface DuplicateFactE1 {
  kind: string;
  text: string;
  supports: boolean;
}

/** call('assistant.duplicates'): merge proposals from the duplicate suggestions, strongest first. */
export interface MergeProposal {
  id: string;
  targetGameId: string;
  sourceGameId: string;
  targetTitle: string;
  sourceTitle: string;
  /** The versions that move; Undo separates exactly these again with game.unmerge. */
  sourceInstallationIds: string[];
  facts: DuplicateFactE1[];
  confidence: 'strong' | 'likely' | 'unsure';
  explanation: string;
  keepReason: string;
}

export type LagCause = 'heat' | 'power' | 'shaders' | 'timer' | 'cpu' | 'gpu' | 'waiting' | 'background' | 'uneven';

/** call('perf.lagNote', { sessionId, refresh? }) and the `perf.lagNote` event after a rough session. */
export interface LagNote {
  sessionId: string;
  rough: boolean;
  text: string | null;
  cause: LagCause | null;
  /** 'analysis': VYSTRAL's own words; 'ai': the same facts worded by the chosen AI. */
  source: 'analysis' | 'ai';
  aiLabel: string | null;
  basis: string;
  cached: boolean;
  sent: string | null;
}

export interface LearnedPrompt {
  text: string;
  count: number;
  lastAsked: string;
}

/** call('assistant.prompts.get'). */
export interface LearnedPrompts {
  enabled: boolean;
  pages: Partial<Record<string, LearnedPrompt[]>>;
}
