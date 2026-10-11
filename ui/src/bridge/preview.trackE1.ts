/**
 * Track E1 preview: Assistant memory, voice input (SIMULATED: no microphone is used and nothing is recognised; a fixed
 * phrase streams in while you hold), the weekly recap, AI game summaries and lag notes from the FAKE provider, smart
 * duplicate cleanup and learned suggestions. Fictional data only. URL switches:
 *   ?voice          voice input turned on (Settings › AI › Assistant)
 *   ?voiceNoLang    no on-device recognizer installed       ?voiceMicBlocked  Windows blocks the microphone for desktop apps
 *   ?recapNotify    the weekly recap notification is on and fires shortly after load (shown as an in-app toast here)
 *   ?summaries      two games lose their description (to show AI summaries)
 *   ?lagNote        the latest measured session is rough (to show the lag note)
 *   ?dupes          three more duplicate pairs for the cleanup flow
 *   ?memories       three memories already saved
 */
import type {
  AiCloudStatus, AssistantMemory, AssistantMemoryList, Game, GameSummary, Installation, LagNote, LearnedPrompts, MergeProposal, Session, Settings,
  VoiceStatus, WeeklyRecapCard,
} from './types';
import { BridgeError } from './bridge';

type Emit = (name: string, payload: unknown) => void;

export const TRACK_E1_DEFAULT_SETTINGS: Pick<Settings, 'assistant.memory' | 'assistant.voice' | 'notifications.weeklyRecap' | 'assistant.recapDay' |
  'assistant.recapHour' | 'ai.features.gameSummaries' | 'ai.features.lagNotes' | 'assistant.learnPrompts'> = {
  'assistant.memory': true,
  'assistant.voice': false,
  'notifications.weeklyRecap': false,
  'assistant.recapDay': 'sunday',
  'assistant.recapHour': 18,
  'ai.features.gameSummaries': false,
  'ai.features.lagNotes': false,
  'assistant.learnPrompts': true,
};

export function previewE1Settings(params: URLSearchParams): Partial<Settings> {
  const s: Partial<Settings> = {};
  if (params.has('voice') || params.has('voiceNoLang') || params.has('voiceMicBlocked')) s['assistant.voice'] = true;
  if (params.has('recapNotify')) s['notifications.weeklyRecap'] = true;
  return s;
}

const hex32 = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** Fictional library tweaks for the switches above (applied once, before anything reads the library). */
export function decorateTrackE1(lib: { games: Game[]; sessions: Session[] }, params: URLSearchParams) {
  if (params.has('summaries'))
    for (const t of ['Quiet Harbor', 'Paper Kingdoms']) {
      const g = lib.games.find((x) => x.title === t);
      if (g) g.description = null;
    }
  if (params.has('lagNote')) {
    const s = lib.sessions.filter((x) => x.perfSummary && x.perfSummary.includes('"fpsAvg"')).sort((a, b) => b.start.localeCompare(a.start))[0];
    if (s) {
      const p = JSON.parse(s.perfSummary!) as Record<string, unknown>;
      Object.assign(p, { fpsAvg: 104.2, fps1Low: 38.5, stutterCount: Math.round((s.durationSeconds / 60) * 2.4), cpuAvg: 91.3 });
      s.perfSummary = JSON.stringify(p);
    }
  }
  if (params.has('dupes')) {
    const copy = (title: string, newTitle: string, platform: Installation['platform'], tracked = 0) => {
      const g = lib.games.find((x) => x.title === title);
      if (!g) return;
      const id = hex32();
      lib.games.push({
        ...g, id, title: newTitle, sortTitle: newTitle.toLowerCase(), favorite: false, collections: [], trackedSeconds: tracked, sessionCount: 0, lastTrackedPlay: null,
        installations: [{ ...g.installations[0], id: hex32(), platform, title: newTitle, platformGameId: `${platform}-${id.slice(0, 6)}` }],
      });
    };
    copy('Tidebreaker', 'Tidebreaker', 'epic');
    copy('Glasswing', 'Glasswing Deluxe Edition', 'gog');
    copy('Northbound', 'Northbound', 'xbox');
  }
}

/** The extra pairs ?dupes adds to the library's duplicate suggestions (only while both entries exist). */
export function previewE1Duplicates(games: Game[], params: URLSearchParams): { gameIdA: string; gameIdB: string; explanation: string }[] {
  if (!params.has('dupes')) return [];
  const out: { gameIdA: string; gameIdB: string; explanation: string }[] = [];
  for (const [a, b] of [['Tidebreaker', 'Tidebreaker'], ['Glasswing', 'Glasswing Deluxe Edition'], ['Northbound', 'Northbound']]) {
    const ga = games.find((g) => g.title === a);
    const gb = games.find((g) => g.title === b && g !== ga);
    if (ga && gb) out.push({ gameIdA: ga.id, gameIdB: gb.id, explanation: 'Same title on different stores.' });
  }
  return out;
}

const PLATFORM: Record<string, string> = { steam: 'Steam', xbox: 'Xbox', epic: 'Epic Games', gog: 'GOG', ea: 'EA app', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net', manual: 'Added by you' };
const COMPANY: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google', compatible: 'the endpoint you entered' };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function trackE1PreviewHandlers(ctx: {
  lib: { games: Game[]; sessions: Session[] };
  emit: () => Emit;
  settings: () => Settings;
  timers: number[];
  call: (method: string, params?: unknown) => unknown;
  duplicates: () => { gameIdA: string; gameIdB: string }[];
}) {
  const params = new URLSearchParams(location.search);
  const s = () => ctx.settings();
  const now = () => new Date().toISOString();
  const memories: AssistantMemory[] = params.has('memories')
    ? ['Prefers short games on weekdays', 'Plays with an Xbox controller', 'Likes cosy co-op games with friends'].map((text, i) => ({
        id: `mem-00000000000${i + 1}`, text, origin: i === 1 ? 'you' : 'chat', createdAt: new Date(Date.now() - (i + 2) * 86400000).toISOString(), updatedAt: new Date(Date.now() - (i + 2) * 86400000).toISOString(),
      }))
    : [];
  const prompts: Record<string, { text: string; count: number; lastAsked: string }[]> = {};
  const summaries = new Map<string, GameSummary>();
  const voiceSessions = new Map<string, { timers: number[]; text: string; ended: boolean }>();

  const list = (): AssistantMemoryList => ({ enabled: s()['assistant.memory'], items: memories.map((m) => ({ ...m })), max: 40, maxChars: 200 });
  const changed = () => ctx.emit()('assistant.memory.changed', list());
  const validate = (text: unknown): string => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^["“]+|["”]+$/g, '');
    if (t.length < 3) throw new BridgeError('invalid', t ? 'That’s too short to remember.' : 'Write what the Assistant should remember.');
    if (t.length > 200) throw new BridgeError('invalid', 'Keep it under 200 characters.');
    if (/https?:\/\/|www\./i.test(t)) throw new BridgeError('invalid', 'Memories can’t hold links.');
    if (/\b(password|passcode|api[ -]?key|secret key|access token)\b/i.test(t) || /\b(sk-|ghp_)[A-Za-z0-9]/.test(t))
      throw new BridgeError('invalid', 'That looks like a password or a key. VYSTRAL never keeps those as memories.');
    return t;
  };
  const norm = (t: string) => t.toLowerCase().replace(/[.!]+$/, '');

  const engine = () => (ctx.call('aiCloud.status') as AiCloudStatus).active;

  const voiceStatus = (): VoiceStatus => {
    const enabled = s()['assistant.voice'];
    const base = { enabled, engine: 'Windows speech recognition', onDevice: true, listening: [...voiceSessions.values()].some((v) => !v.ended) };
    if (params.has('voiceNoLang'))
      return { ...base, available: false, fix: 'language', language: null, languageName: null, reason: 'Windows has no on-device speech recognizer for your languages. Add one with a language’s Speech recognition option in Windows Settings › Time & language.' };
    if (params.has('voiceMicBlocked'))
      return { ...base, available: false, fix: 'microphone', language: 'en-US', languageName: 'English (United States)', reason: 'Windows is blocking microphone access for desktop apps. Turn on “Let desktop apps access your microphone” in Windows Settings › Privacy & security › Microphone.' };
    if (!enabled) return { ...base, available: false, fix: 'setting', language: 'en-US', languageName: 'English (United States)', reason: 'Voice input is off. Turn it on in Settings › AI › Assistant.' };
    return { ...base, available: true, fix: null, language: 'en-US', languageName: 'English (United States)', reason: null };
  };

  const isRough = (p: Record<string, number>, duration: number) => {
    if (!(p.fpsAvg > 0)) return false;
    if (typeof p.fps1Low === 'number' && p.fps1Low / p.fpsAvg < 0.5) return true;
    if (typeof p.stutterCount === 'number' && duration >= 60 && p.stutterCount / (duration / 60) > 1) return true;
    return typeof p.cpuAvg === 'number' && p.cpuAvg > 85;
  };

  const monday = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dur = (sec: number) => { const m = Math.floor(sec / 60); const h = Math.floor(m / 60); return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`; };

  const recap = (week?: string): WeeklyRecapCard => {
    const start = week ? new Date(`${week}T00:00:00`) : monday(new Date());
    if (Number.isNaN(start.getTime()) || start.getDay() !== 1) throw new BridgeError('invalid', 'Unknown week.');
    const end = new Date(start.getTime() + 7 * 86400000);
    const prevStart = new Date(start.getTime() - 7 * 86400000);
    const byId = new Map(ctx.lib.games.map((g) => [g.id, g]));
    const inWeek = ctx.lib.sessions.filter((x) => byId.has(x.gameId) && new Date(x.start) >= start && new Date(x.start) < end && x.durationSeconds > 0);
    // Preview: a fictional week when the sample sessions don't reach it, so the card always has something to show.
    const fake = inWeek.length === 0 ? ctx.lib.games.filter((g) => !g.hidden).slice(0, 3).map((g, i) => ({
      id: `fake${i}`, gameId: g.id, installationId: null, start: new Date(start.getTime() + (i * 2 + 1) * 86400000 + 19 * 3600000).toISOString(),
      end: null, durationSeconds: [8400, 5100, 2700][i], source: 'tracked', perfSummary: null,
    } as unknown as Session)) : [];
    const rows = inWeek.length ? inWeek : fake;
    const total = rows.reduce((n, x) => n + x.durationSeconds, 0);
    const prev = ctx.lib.sessions.filter((x) => new Date(x.start) >= prevStart && new Date(x.start) < start).reduce((n, x) => n + x.durationSeconds, 0) || 9600;
    const perGame = new Map<string, number>();
    for (const x of rows) perGame.set(x.gameId, (perGame.get(x.gameId) ?? 0) + x.durationSeconds);
    const top = [...perGame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([gameId, seconds]) => ({ gameId, title: byId.get(gameId)!.title, seconds }));
    const longest = rows.slice().sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
    const days = new Set(rows.map((x) => new Date(x.start).toDateString())).size;
    const diff = total - prev;
    const summary = total ? [`${dur(total)} over ${days} ${days === 1 ? 'day' : 'days'}`, top[0] ? `most played: ${top[0].title} (${dur(top[0].seconds)})` : null,
      Math.abs(diff) >= 600 ? (diff > 0 ? `up ${dur(diff)} on last week` : `down ${dur(-diff)} on last week`) : 'about the same as last week'].filter(Boolean).join(' · ') + '.' : 'No games tracked this week.';
    return {
      week: ymd(start), from: ymd(start), to: ymd(new Date(start.getTime() + 6 * 86400000)), totalSeconds: total, sessions: rows.length, daysPlayed: days, topGames: top,
      longest: longest ? { title: byId.get(longest.gameId)!.title, seconds: longest.durationSeconds, day: ymd(new Date(longest.start)) } : null,
      firstTime: top.length > 2 ? [top[2].title] : [], previousWeekSeconds: prev, summary, finished: new Date() >= end,
    };
  };

  if (params.has('recapNotify'))
    ctx.timers.push(window.setTimeout(() => {
      const r = recap();
      ctx.emit()('assistant.recap', { week: r.week, title: 'Your week in games', summary: r.summary });
    }, 1500));

  const proposals = (): MergeProposal[] => {
    const byId = new Map(ctx.lib.games.map((g) => [g.id, g]));
    const out: MergeProposal[] = [];
    for (const d of ctx.duplicates()) {
      const a = byId.get(d.gameIdA), b = byId.get(d.gameIdB);
      if (!a || !b || a.hidden || b.hidden) continue;
      const [target, source] = a.trackedSeconds > b.trackedSeconds || (a.trackedSeconds === b.trackedSeconds && a.installations.length >= b.installations.length) ? [a, b] : [b, a];
      const same = target.title.toLowerCase() === source.title.toLowerCase();
      const storesA = [...new Set(target.installations.map((i) => i.platform))], storesB = [...new Set(source.installations.map((i) => i.platform))];
      const shared = storesA.filter((p) => storesB.includes(p));
      const facts = [
        same ? { kind: 'title', text: 'The titles are identical.', supports: true }
          : { kind: 'title', text: `Both titles read “${target.title.replace(/ (Deluxe Edition|Remastered)$/i, '')}” once edition words are set aside.`, supports: true },
        ...(same ? [] : [{ kind: 'edition', text: `One looks like the standard edition, the other like the ${/remastered/i.test(source.title + target.title) ? 'remastered' : 'deluxe'} edition.`, supports: false }]),
        target.developer && target.developer === source.developer ? { kind: 'developer', text: `Same developer: ${target.developer}.`, supports: true } : null,
        shared.length ? { kind: 'store', text: `Both are on ${shared.map((p) => PLATFORM[p]).join(' and ')}, where they’re listed as separate products.`, supports: false }
          : { kind: 'store', text: `They come from different stores: ${storesA.map((p) => PLATFORM[p]).join(', ')} and ${storesB.map((p) => PLATFORM[p]).join(', ')}.`, supports: true },
      ].filter((f): f is { kind: string; text: string; supports: boolean } => !!f);
      const against = facts.filter((f) => !f.supports).length;
      const confidence = same && against === 0 ? 'strong' : facts.filter((f) => f.supports).length > against && !shared.length ? 'likely' : 'unsure';
      const alike = facts.filter((f) => f.supports).map((f) => f.text).join(' ');
      const differ = facts.filter((f) => !f.supports).map((f) => f.text).join(' ');
      out.push({
        id: `dup-${target.id}-${source.id}`, targetGameId: target.id, sourceGameId: source.id, targetTitle: target.title, sourceTitle: source.title,
        sourceInstallationIds: source.installations.map((i) => i.id), facts, confidence, explanation: differ ? `${alike} But: ${differ}` : alike,
        keepReason: `Keeps ${target.title}’s page${target.trackedSeconds > source.trackedSeconds ? ', which has more of your play history' : ''}. ${source.title}’s sessions, collections and store versions join it; where both have notes or a status, ${target.title}’s are kept.`,
      });
    }
    const rank = { strong: 0, likely: 1, unsure: 2 } as const;
    return out.sort((x, y) => rank[x.confidence] - rank[y.confidence] || x.targetTitle.localeCompare(y.targetTitle));
  };

  const fakeAi = async (feature: 'gameSummaries' | 'lagNotes', ask: boolean) => {
    const e = engine();
    if (!ask && !s()[`ai.features.${feature}`]) return null;
    await delay(params.has('aiSlow') ? 1400 : 300);
    if (!e.ready || !e.cloud) return null;
    return e;
  };

  return {
    // ---------- Memory ----------
    'assistant.memory.list': () => list(),
    'assistant.memory.add': (p: { text: string; origin?: string }) => {
      if (!s()['assistant.memory']) throw new BridgeError('forbidden', 'Assistant memory is off. Turn it on in Settings › AI › Assistant.');
      const text = validate(p?.text);
      if (memories.some((m) => norm(m.text) === norm(text))) throw new BridgeError('invalid', 'The Assistant already remembers that.');
      if (memories.length >= 40) throw new BridgeError('invalid', 'Memory is full (40 things). Delete one you no longer need first.');
      const m: AssistantMemory = { id: `mem-${hex32().slice(0, 12)}`, text, origin: p.origin === 'chat' ? 'chat' : 'you', createdAt: now(), updatedAt: now() };
      memories.push(m);
      changed();
      return m;
    },
    'assistant.memory.update': (p: { id: string; text: string }) => {
      const m = memories.find((x) => x.id === p?.id);
      if (!m) throw new BridgeError('invalid', 'That memory is no longer saved.');
      const text = validate(p.text);
      if (memories.some((x) => x !== m && norm(x.text) === norm(text))) throw new BridgeError('invalid', 'The Assistant already remembers that.');
      Object.assign(m, { text, updatedAt: now() });
      changed();
      return { ...m };
    },
    'assistant.memory.delete': (p: { id: string }) => {
      const i = memories.findIndex((x) => x.id === p?.id);
      if (i >= 0) memories.splice(i, 1);
      changed();
      return i >= 0;
    },
    'assistant.memory.clear': () => { memories.splice(0); changed(); return true; },
    /** For the fake Assistant: what's remembered (context), when memory is on. */
    '__e1.memories': () => (s()['assistant.memory'] ? memories.map((m) => m.text) : []),

    // ---------- Voice (simulated) ----------
    'voice.status': () => voiceStatus(),
    'voice.start': (p: { sessionId: string }) => {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(p?.sessionId))) throw new BridgeError('invalid', 'Invalid voice session.');
      const st = voiceStatus();
      if (!st.available) throw new BridgeError('unavailable', st.reason ?? 'Voice input isn’t available.');
      for (const v of voiceSessions.values()) { v.ended = true; v.timers.forEach(clearTimeout); }
      const id = p.sessionId;
      const v = { timers: [] as number[], text: '', ended: false };
      voiceSessions.set(id, v);
      const emit = (e: Record<string, unknown>) => { if (!v.ended || e.type === 'end') ctx.emit()('voice.event', { sessionId: id, ...e }); };
      emit({ type: 'start', language: 'en-US' });
      const words = 'What should I play tonight I have about an hour'.split(' ');
      words.forEach((_, i) => v.timers.push(window.setTimeout(() => { v.text = words.slice(0, i + 1).join(' '); emit({ type: 'partial', text: v.text }); }, 250 + i * 160)));
      for (let i = 0; i < 60; i++) v.timers.push(window.setTimeout(() => emit({ type: 'level', level: Math.round(20 + 60 * Math.abs(Math.sin(i * 0.7)) * (i % 7 === 0 ? 0.3 : 1)) }), 80 + i * 60));
      return { ...st, listening: true };
    },
    'voice.stop': (p: { sessionId: string }) => {
      const v = voiceSessions.get(p?.sessionId);
      if (!v || v.ended) return false;
      v.timers.forEach(clearTimeout);
      v.ended = true;
      ctx.timers.push(window.setTimeout(() => ctx.emit()('voice.event', { sessionId: p.sessionId, type: 'end', text: v.text || 'What should I play tonight', cancelled: false }), 200));
      return true;
    },
    'voice.cancel': (p: { sessionId: string }) => {
      const v = voiceSessions.get(p?.sessionId);
      if (!v || v.ended) return false;
      v.timers.forEach(clearTimeout);
      v.ended = true;
      ctx.emit()('voice.event', { sessionId: p.sessionId, type: 'end', text: v.text, cancelled: true });
      return true;
    },
    'voice.openSettings': () => true,

    // ---------- Weekly recap ----------
    'assistant.recap.get': (p: { week?: string | null }) => recap(p?.week ?? undefined),

    // ---------- AI game summaries ----------
    'aix.gameSummary': async (p: { gameId: string; refresh?: boolean; ask?: boolean }) => {
      const g = ctx.lib.games.find((x) => x.id === p?.gameId);
      if (!g) throw new BridgeError('notFound', 'That game is no longer in your library.');
      const featureOn = s()['ai.features.gameSummaries'];
      const e = engine();
      const sources = ['Preview data', 'IGDB', 'Steam community tags'];
      if (g.description) return { gameId: g.id, text: null, sources: [], aiLabel: null, cached: false, stale: false, note: 'This game has a description from its store, so no summary is needed.', needsAi: false, featureOn, factCount: 0, engine: e, sent: null } satisfies GameSummary;
      const hit = summaries.get(g.id);
      if (hit && !p.refresh) return { ...hit, cached: true, sent: null };
      if (!e.ready) return { gameId: g.id, text: null, sources, aiLabel: null, cached: false, stale: false, note: e.reason, needsAi: true, featureOn, factCount: 6, engine: e, sent: null } satisfies GameSummary;
      const ai = await fakeAi('gameSummaries', !!p.ask);
      if (!ai) return { gameId: g.id, text: null, sources, aiLabel: null, cached: false, stale: false, note: e.cloud ? null : 'Ollama isn’t available in preview mode.', needsAi: false, featureOn, factCount: 6, engine: e, sent: null } satisfies GameSummary;
      const [genre1, genre2] = g.genres.map((x) => x.toLowerCase());
      const text = `A ${genre2 ? `${genre2} ` : ''}${genre1 ?? 'indie'} game from ${g.developer ?? 'a small studio'}.\nCalm, unhurried play built around exploring and figuring things out.`;
      const r: GameSummary = {
        gameId: g.id, text, sources, aiLabel: ai.label, cached: false, stale: false, note: null, needsAi: false, featureOn, factCount: 6, engine: e,
        sent: `Sent to ${COMPANY[ai.engine] ?? 'the provider'} (${ai.label}): for a game with no description, its title, genres, developer, publisher, release year, matched IGDB and RAWG facts and its Steam community tags. (Preview: nothing actually left this PC.)`,
      };
      summaries.set(g.id, r);
      return r;
    },

    // ---------- Smart duplicate cleanup ----------
    'assistant.duplicates': () => proposals(),
    'game.unmerge': (p: { installationId: string }) => {
      const owner = ctx.lib.games.find((g) => g.installations.some((i) => i.id === p?.installationId));
      if (!owner || owner.installations.length < 2) throw new BridgeError('invalid', 'That version can’t be separated (it’s the only one).');
      const inst = owner.installations.find((i) => i.id === p.installationId)!;
      owner.installations = owner.installations.filter((i) => i !== inst);
      const id = hex32();
      ctx.lib.games.push({ ...owner, id, title: inst.title, sortTitle: inst.title.toLowerCase(), installations: [inst], collections: [], favorite: false, trackedSeconds: 0, sessionCount: 0, lastTrackedPlay: null });
      ctx.emit()('library.changed', null);
      return id;
    },

    // ---------- Lag notes ----------
    'perf.lagNote': async (p: { sessionId: string }): Promise<LagNote> => {
      const x = ctx.lib.sessions.find((y) => y.id === p?.sessionId);
      if (!x) throw new BridgeError('notFound', 'That session is no longer in your journal.');
      const basis = 'From VYSTRAL’s frame-time analysis of this session. Nothing was changed.';
      const perf = x.perfSummary ? (JSON.parse(x.perfSummary) as Record<string, number>) : {};
      if (!isRough(perf, x.durationSeconds)) return { sessionId: x.id, rough: false, text: null, cause: null, source: 'analysis', aiLabel: null, basis, cached: false, sent: null };
      const deterministic = perf.cpuAvg > 85
        ? `Likely the processor: it averaged ${Math.round(perf.cpuAvg)}% busy for the whole session.`
        : `Frame pacing was uneven (1% lows of ${Math.round(perf.fps1Low)} fps against a ${Math.round(perf.fpsAvg)} fps average), with no single clear cause in the samples.`;
      const ai = s()['ai.features.lagNotes'] ? await fakeAi('lagNotes', false) : null;
      return ai
        ? { sessionId: x.id, rough: true, text: 'Likely the processor: it stayed nearly maxed out, so frames waited on it.', cause: 'cpu', source: 'ai', aiLabel: ai.label, basis, cached: false, sent: `Sent to ${COMPANY[ai.engine] ?? 'the provider'} (${ai.label}): that session’s frame-rate figures and VYSTRAL’s own stutter findings. (Preview: nothing actually left this PC.)` }
        : { sessionId: x.id, rough: true, text: deterministic, cause: perf.cpuAvg > 85 ? 'cpu' : 'uneven', source: 'analysis', aiLabel: null, basis, cached: false, sent: null };
    },

    // ---------- Learned suggestions ----------
    'assistant.prompts.get': (): LearnedPrompts => ({ enabled: s()['assistant.learnPrompts'], pages: structuredClone(prompts) }),
    'assistant.prompts.record': (p: { page: string; text: string }) => {
      if (!s()['assistant.learnPrompts']) return false;
      const text = String(p?.text ?? '').replace(/\s+/g, ' ').trim();
      if (text.length < 4 || text.length > 120) return false;
      const list = (prompts[p.page] ??= []);
      const hit = list.find((x) => x.text.toLowerCase() === text.toLowerCase());
      if (hit) { hit.count++; hit.lastAsked = now(); }
      else { if (list.length >= 25) list.sort((a, b) => a.count - b.count).shift(); list.push({ text, count: 1, lastAsked: now() }); }
      return true;
    },
    'assistant.prompts.clear': () => { for (const k of Object.keys(prompts)) delete prompts[k]; return true; },
  };
}
