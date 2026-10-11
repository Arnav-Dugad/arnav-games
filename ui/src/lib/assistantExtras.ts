/**
 * Track E1: pure helpers for the Assistant's extras (unit tested): learned suggestions (templating and blending), the
 * thinking orb's streaming-speed signal, push-to-talk keys, memory text checks that mirror the native validation, the
 * voice level meter and a few labels.
 */
import type { LagCause, LearnedPrompt } from '../bridge/types';

// ---------------------------------------------------------------- learned suggestions

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** On a game page, the game's title becomes `{game}`, so a question learned on one game page fits every game page. */
export function templatePrompt(text: string, gameTitle?: string | null): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!gameTitle || gameTitle.trim().length < 2) return one;
  return one.replace(new RegExp(escapeRe(gameTitle.trim()), 'gi'), '{game}');
}

export function fillPrompt(template: string, gameTitle?: string | null): string | null {
  if (!template.includes('{game}')) return template;
  return gameTitle ? template.replace('{game}', gameTitle) : null;
}

/** Native limits (PromptLearningStore): 4–120 characters, one {game} at most. */
export function learnable(text: string): boolean {
  const t = text.trim();
  return t.length >= 4 && t.length <= 120 && (t.match(/\{game\}/g)?.length ?? 0) <= 1 && !/[{}]/.test(t.replace('{game}', ''));
}

/** Learned prompts fade with a three-week half-life, so old habits give way to new ones. */
export function promptScore(p: LearnedPrompt, now = Date.now()): number {
  const days = Math.max(0, (now - Date.parse(p.lastAsked)) / 86_400_000);
  return p.count * Math.pow(0.5, (Number.isFinite(days) ? days : 365) / 21);
}

/**
 * Up to `learnedMax` of your own frequent prompts (asked at least twice) first, then the built-in ones, without
 * duplicates, `max` in all. `{game}` prompts need a game; the defaults keep the page's best questions in view.
 */
export function blendSuggestions(
  defaults: readonly string[], learned: readonly LearnedPrompt[] | undefined, gameTitle?: string | null,
  { max = 4, learnedMax = 2, now = Date.now() }: { max?: number; learnedMax?: number; now?: number } = {},
): { text: string; learned: boolean }[] {
  const out: { text: string; learned: boolean }[] = [];
  const seen = new Set<string>();
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const add = (text: string | null, isLearned: boolean) => {
    if (!text || out.length >= max) return;
    const k = key(text);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ text, learned: isLearned });
  };
  const ranked = (learned ?? []).filter((p) => p.count >= 2 && learnable(p.text)).sort((a, b) => promptScore(b, now) - promptScore(a, now));
  let taken = 0;
  for (const p of ranked) {
    if (taken >= learnedMax) break;
    const filled = fillPrompt(p.text, gameTitle);
    if (!filled) continue;
    const before = out.length;
    add(filled, true);
    if (out.length > before) taken++;
  }
  for (const d of defaults) add(d, false);
  return out;
}

// ---------------------------------------------------------------- the thinking orb

/** Streaming speed in tokens a second (about four characters a token), smoothed so the orb breathes rather than flickers. */
export function nextRate(prev: number, chars: number, dtMs: number, tau = 600): number {
  if (!(dtMs > 0)) return prev;
  const instant = chars / 4 / (dtMs / 1000);
  const a = 1 - Math.exp(-dtMs / tau);
  return Math.max(0, prev + (Math.min(instant, 400) - prev) * a);
}

/** Decays the rate when nothing arrives (the stream paused or ended). */
export function decayRate(rate: number, dtMs: number, tau = 900): number {
  return rate * Math.exp(-Math.max(0, dtMs) / tau);
}

/** 0 (calm) to 1 (flat out): log-scaled so 10 tokens/s already feels alive and 120+ is the ceiling. */
export function orbEnergy(rate: number): number {
  if (!(rate > 0.5)) return 0;
  return Math.min(1, Math.log1p(rate) / Math.log1p(120));
}

export type OrbPhase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting' | 'error';

/** Words for the orb's state (its accessible name, and the visible label in High contrast). */
export const ORB_LABEL: Record<OrbPhase, string> = {
  idle: 'Ready',
  thinking: 'Thinking',
  streaming: 'Writing',
  tool: 'Looking something up',
  waiting: 'Waiting for you',
  error: 'Something went wrong',
};

// ---------------------------------------------------------------- push-to-talk

/** Hold Ctrl+Space in the message box to talk (no other modifier). */
export function isPushToTalk(e: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.code === 'Space' || e.key === ' ');
}

/** Releasing either key of the chord ends the hold. */
export function endsPushToTalk(e: { key: string; code?: string }): boolean {
  return e.key === 'Control' || e.code === 'Space' || e.key === ' ';
}

/** Puts dictated words into the draft: after what's there, with one space, keeping the draft's own words. */
export function mergeDictation(draft: string, spoken: string): string {
  const s = spoken.replace(/\s+/g, ' ').trim();
  if (!s) return draft;
  if (!draft.trim()) return s.charAt(0).toUpperCase() + s.slice(1);
  return `${draft.replace(/\s+$/, '')} ${s}`;
}

/** A waveform-like meter from recent levels (0–100): `bars` heights 0..1, newest on the right, softly shaped. */
export function levelBars(history: readonly number[], bars = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const v = history[history.length - bars + i];
    const level = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
    // Speech sits low on the meter: lift quiet sounds so the bars visibly move.
    out.push(Math.min(1, Math.sqrt(level) * 1.15));
  }
  return out;
}

// ---------------------------------------------------------------- memory

/** Mirrors AssistantMemoryStore.Validate for instant feedback; the app checks again. Null when fine. */
export function memoryProblem(text: string, max = 200): string | null {
  const s = text.replace(/\s+/g, ' ').trim().replace(/^["“‘]+|["”’]+$/g, '').trim();
  if (!s) return 'Write what the Assistant should remember.';
  if (s.length < 3) return 'That’s too short to remember.';
  if (s.length > max) return `Keep it under ${max} characters.`;
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|tv|co)\b)/i.test(s)) return 'Memories can’t hold links.';
  if (/\b(password|passwd|passcode|pin code|api[ -]?key|secret key|access token|auth token|2fa code|recovery code)s?\b/i.test(s) ||
      /\b(sk-|ghp_|xox[bp]-|AKIA)[A-Za-z0-9]/.test(s) ||
      (s.match(/[A-Za-z0-9_-]{24,}/g) ?? []).some((t) => /\d/.test(t) && /[A-Za-z]/.test(t)))
    return 'That looks like a password or a key. Arnav Games never keeps those as memories.';
  return null;
}

// ---------------------------------------------------------------- labels

export const LAG_CAUSE_LABEL: Record<LagCause, string> = {
  heat: 'Heat',
  power: 'Power limit',
  shaders: 'Shaders or loading',
  timer: 'Background task',
  cpu: 'Processor',
  gpu: 'Graphics card',
  waiting: 'Loading',
  background: 'Background apps',
  uneven: 'Uneven pacing',
};

/** "6–12 Oct" or "29 Sep – 5 Oct" from yyyy-MM-dd dates, in the user's format. */
export function weekRange(from: string, to: string, locale?: string): string {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} – ${to}`;
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return a.getMonth() === b.getMonth() ? `${day.format(a)}–${dayMonth.format(b)}` : `${dayMonth.format(a)} – ${dayMonth.format(b)}`;
}

/** The current week's Monday, yyyy-MM-dd in local time. */
export function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
