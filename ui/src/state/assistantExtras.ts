import { create } from 'zustand';
import { call, errorMessage, on } from '../bridge/bridge';
import type { AssistantMemory, AssistantMemoryList, LearnedPrompts, VoiceStatus } from '../bridge/types';
import { contextFromRoute } from '../lib/assistant';
import { learnable, templatePrompt } from '../lib/assistantExtras';
import { useStore } from './store';

/**
 * Track E1: state for the Assistant's extras — memory (list and manager), voice status, the duplicate cleanup sheet and
 * suggestions learned from what you ask. Everything persists natively as small JSON files; this is just the page's copy.
 */
interface ExtrasState {
  memory: AssistantMemoryList | null;
  memoryOpen: boolean;
  cleanupOpen: boolean;
  voice: VoiceStatus | null;
  learned: LearnedPrompts | null;

  loadMemory(): Promise<void>;
  openMemory(): void;
  closeMemory(): void;
  addMemory(text: string, origin: 'chat' | 'you'): Promise<AssistantMemory>;
  updateMemory(id: string, text: string): Promise<AssistantMemory>;
  deleteMemory(id: string): Promise<void>;
  clearMemory(): Promise<void>;
  openCleanup(): void;
  closeCleanup(): void;
  refreshVoice(): Promise<void>;
  loadLearned(): Promise<void>;
  clearLearned(): Promise<void>;
}

const app = () => useStore.getState();
let subscribed = false;

export const useExtras = create<ExtrasState>((set, get) => ({
  memory: null,
  memoryOpen: false,
  cleanupOpen: false,
  voice: null,
  learned: null,

  async loadMemory() {
    try {
      set({ memory: await call<AssistantMemoryList>('assistant.memory.list') });
    } catch {
      // The manager shows its own error when it can't load.
    }
  },
  openMemory() {
    set({ memoryOpen: true });
    void get().loadMemory();
  },
  closeMemory() {
    set({ memoryOpen: false });
  },
  async addMemory(text, origin) {
    const m = await call<AssistantMemory>('assistant.memory.add', { text, origin });
    await get().loadMemory();
    return m;
  },
  async updateMemory(id, text) {
    const m = await call<AssistantMemory>('assistant.memory.update', { id, text });
    await get().loadMemory();
    return m;
  },
  async deleteMemory(id) {
    await call('assistant.memory.delete', { id });
    await get().loadMemory();
  },
  async clearMemory() {
    try {
      await call('assistant.memory.clear');
      await get().loadMemory();
      app().toast({ tone: 'success', title: 'Memories deleted', body: 'The Assistant no longer remembers anything about you on this PC.' });
    } catch (err) {
      app().toast({ tone: 'danger', title: 'Couldn’t delete memories', body: errorMessage(err) });
    }
  },
  openCleanup() {
    set({ cleanupOpen: true });
  },
  closeCleanup() {
    set({ cleanupOpen: false });
  },
  async refreshVoice() {
    try {
      set({ voice: await call<VoiceStatus>('voice.status') });
    } catch {
      set({ voice: null });
    }
  },
  async loadLearned() {
    try {
      set({ learned: await call<LearnedPrompts>('assistant.prompts.get') });
    } catch {
      set({ learned: null });
    }
  },
  async clearLearned() {
    try {
      await call('assistant.prompts.clear');
      await get().loadLearned();
      app().toast({ tone: 'success', title: 'Learned suggestions forgotten', body: 'Suggestions are back to VYSTRAL’s own.' });
    } catch (err) {
      app().toast({ tone: 'danger', title: 'Couldn’t forget suggestions', body: errorMessage(err) });
    }
  },
}));

/** Counts a question you asked for its page type (a game's title becomes {game}). Best effort; off with the setting. */
export async function recordAsked(text: string): Promise<void> {
  const s = app();
  if (!s.settings?.['assistant.learnPrompts']) return;
  const route = s.route as { name: string; id?: string; sessionId?: string };
  const ctx = contextFromRoute(route);
  const title = ctx.gameId ? s.gamesById.get(ctx.gameId)?.title : null;
  const t = templatePrompt(text, title);
  if (!learnable(t)) return;
  try {
    if (await call<boolean>('assistant.prompts.record', { page: ctx.page, text: t })) void useExtras.getState().loadLearned();
  } catch {
    // Learning is a nicety; never in the way of asking.
  }
}

/** App-wide events: memory changes, the weekly recap when VYSTRAL is in front, settings that change voice. */
export function subscribeExtras() {
  if (subscribed) return;
  subscribed = true;
  on('assistant.memory.changed', (list) => useExtras.setState({ memory: list }));
  on('settings.changed', () => {
    if (useExtras.getState().voice) void useExtras.getState().refreshVoice();
  });
  on('assistant.recap', (e) => {
    if (!e || typeof e.week !== 'string' || document.visibilityState !== 'visible') return;
    app().toast({
      tone: 'info',
      title: e.title || 'Your week in games',
      body: e.summary,
      action: { label: 'Open recap', run: () => app().navigate({ name: 'assistant', recap: e.week }) },
    });
  });
}
