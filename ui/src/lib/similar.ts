/**
 * Track D1: "Similar in your library" — games you already own that resemble this one, with the ones you've forgotten
 * (never played, or not for months) lifted to the front. Pure, local and fast: Steam community tags from the library
 * tag map (Track C4), genres, a series guess from the titles, and — when IGDB facts are cached for this game — its
 * series and "similar games" names. Every pick says why in a few words.
 *
 * Track E2a: tags are weighted the way a search engine weights words. A tag most of your library has (Singleplayer,
 * Action, Adventure, Indie) says little about what a game is like, so it counts for little (inverse document
 * frequency across your own library, plus a short list of tags that are generic everywhere). A tag near the top of a
 * game's list counts more than one near the bottom. Genre families (racing, horror, roguelikes, …) get a boost when
 * both games belong to one, and a game that defines itself by one (Forza: Racing, Driving) suggests games outside it
 * only when they are strongly alike otherwise. Weak picks are left out: the strip shows nothing rather than filler.
 */
import type { Game, LibraryTags } from '../bridge/types';
import { lastPlayed } from './format';
import { hasNeverBeenPlayed } from './neverPlayed';

export interface SimilarFacts {
  /** IGDB "similar games" names for this game (cached facts only). */
  similar?: readonly string[];
  /** IGDB series and franchise names for this game. */
  series?: readonly string[];
}

export interface SimilarPick {
  game: Game;
  score: number;
  /** "Shares Racing · Driving · Automobile Sim · not played in 8 months". */
  why: string;
  sameSeries: boolean;
  forgotten: 'never' | 'long' | null;
}

const DAY = 86_400_000;
/** Strongest tags of this game that count (Steam lists up to 20; the tail is noise). */
const MY_TAGS = 12;
/** A candidate's tags looked at (its strongest ones). */
const THEIR_TAGS = 15;
/** A pick needs at least this much in common. */
export const MIN_SCORE = 1.4;
/** Tag similarity (0..1, the cosine of the two weighted tag lists) is worth up to this many points. */
const TAG_SCALE = 6;
/** Both games belong to a genre family this game defines itself by (both are racers). */
const FAMILY_BONUS = 1.1;
/** This game defines itself by a genre family and the other game isn't in it: most of the tag score goes. */
const OFF_FAMILY = 0.4;
/** A family counts as defining when one of its tags is among this game's strongest few. */
const DEFINING_TOP = 6;
/** "Forgotten": not played for this long. */
export const FORGOTTEN_DAYS = 60;

const EDITION = /\b(remastered|remaster|definitive|deluxe|ultimate|complete|goty|game of the year|anniversary|enhanced|director'?s cut|edition|hd|redux|reloaded)\b/g;
const ROMAN = /\b(ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\b/g;

/** Lower-case words only, for comparing titles. */
export function normTitle(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The series a title probably belongs to: the part before a subtitle (":" or " - "), without edition words, sequel
 * numbers or roman numerals. "Forza Horizon 5" and "Forza Horizon 4: Premium" share "forza horizon". Null when what's
 * left is too short to mean anything.
 */
export function seriesKey(title: string): string | null {
  const head = title.split(/\s[-–—]\s|:/)[0];
  const k = normTitle(head).replace(EDITION, ' ').replace(ROMAN, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  return k.length >= 4 ? k : null;
}

/** "8 months", "a year", "3 years". */
export function awaySpan(days: number): string {
  if (days < 365) {
    const m = Math.max(2, Math.round(days / 30.44));
    return `${m} months`;
  }
  const y = Math.floor(days / 365);
  return y === 1 ? 'a year' : `${y} years`;
}

function forgottenOf(g: Game, now: number): { kind: 'never' | 'long' | 'recent' | null; days: number } {
  if (hasNeverBeenPlayed(g)) return { kind: 'never', days: Infinity };
  const at = lastPlayed(g).at;
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return { kind: null, days: 0 };
  const days = Math.max(0, (now - t) / DAY);
  if (days >= FORGOTTEN_DAYS) return { kind: 'long', days };
  if (days <= 14) return { kind: 'recent', days };
  return { kind: null, days };
}

// ---------------------------------------------------------------- tag weights

/** Tags that say almost nothing about what a game is like: most games have them. Lower-case Steam tag names. */
const GENERIC = new Set([
  'singleplayer', 'multiplayer', 'action', 'adventure', 'indie', 'casual', '2d', '3d', 'great soundtrack', 'colorful', 'colourful',
  'funny', 'controller', 'full controller support', 'partial controller support', 'early access', 'free to play', 'first-person',
  'third person', 'third-person', 'co-op', 'online co-op', 'local co-op', 'local multiplayer', 'pvp', 'online pvp', 'pve',
  'nudity-free', 'cute', 'family friendly', 'beautiful', 'classic', 'masterpiece', 'addictive', 'difficult', 'replay value',
  'moddable', 'mature', 'violent', 'gore', 'blood', 'female protagonist', 'male protagonist', 'character customization',
  'great graphics', 'good soundtrack', 'cinematic', 'memes', 'remake', 'remaster', 'vr', 'stylized', 'realistic', 'immersive',
  'hand-drawn', 'cartoony', 'cartoon', 'short', 'multiple endings', 'choices matter', 'drama', 'emotional', 'epic',
]);
/** Broad, descriptive tags: worth something, but less than a real genre. */
const SOFT = new Set([
  'atmospheric', 'story rich', 'exploration', 'open world', 'fantasy', 'sci-fi', 'sandbox', 'simulation', 'strategy', 'rpg',
  'action rpg', 'anime', 'retro', 'pixel graphics', 'relaxing', 'dark', 'dark fantasy', 'psychological', 'mystery', 'physics',
  'competitive', 'team-based', 'fast-paced', 'arcade', 'shooter', 'space', 'medieval', 'historical', 'war', 'military',
  'post-apocalyptic', 'futuristic', 'cyberpunk', 'nature', 'crafting', 'building', 'management', 'puzzle', 'platformer',
  'top-down', 'isometric', 'side scroller', 'survival', 'online', 'mmo',
]);

/**
 * Genre families: tags that mean the same kind of game. Sharing one is the strongest sign two games are alike (Racing
 * and Driving are one family, so a pure driving sim still matches an arcade racer).
 */
const FAMILIES: Record<string, readonly string[]> = {
  racing: ['racing', 'driving', 'automobile sim', 'arcade racing', 'combat racing', 'kart racing', 'offroad', 'motocross', 'motorbike', 'vehicular combat', 'trucking'],
  horror: ['horror', 'psychological horror', 'survival horror', 'lovecraftian', 'cosmic horror', 'jump scare', 'zombies'],
  soulslike: ['souls-like', 'soulslike'],
  roguelike: ['roguelike', 'roguelite', 'action roguelike', 'traditional roguelike', 'roguevania'],
  deckbuilder: ['deckbuilding', 'card game', 'card battler', 'roguelike deckbuilder', 'trading card game'],
  metroidvania: ['metroidvania', 'roguevania'],
  platformer: ['precision platformer', '2d platformer', '3d platformer', 'puzzle platformer', 'collectathon'],
  puzzle: ['logic', 'puzzle platformer', 'escape room', 'hidden object', 'match 3'],
  shooter: ['fps', 'looter shooter', 'arena shooter', 'hero shooter', 'third-person shooter', 'tactical shooter', 'boomer shooter', 'bullet hell', "shoot 'em up", 'twin stick shooter'],
  strategy: ['rts', 'turn-based strategy', 'grand strategy', '4x', 'tactical rpg', 'turn-based tactics', 'real time tactics', 'wargame', 'tower defense', 'auto battler'],
  builder: ['city builder', 'colony sim', 'base building', 'automation', 'resource management', 'god game', 'economy'],
  sports: ['sports', 'football (soccer)', 'soccer', 'football (american)', 'basketball', 'golf', 'tennis', 'baseball', 'hockey', 'skateboarding', 'skating', 'cycling', 'boxing', 'wrestling', 'bowling'],
  fighting: ['fighting', '2d fighter', '3d fighter', "beat 'em up", 'martial arts', 'hack and slash', 'character action game'],
  flight: ['flight', 'space sim', 'combat flight', 'air combat', 'aviation'],
  farming: ['farming sim', 'farming', 'life sim', 'agriculture', 'cozy'],
  rhythm: ['rhythm', 'music', 'music-based procedural generation'],
  story: ['visual novel', 'dating sim', 'interactive fiction', 'walking simulator', 'point & click', 'choose your own adventure'],
  survivalcraft: ['open world survival craft', 'base building'],
  stealth: ['stealth', 'immersive sim'],
  detective: ['detective', 'investigation'],
  mmo: ['mmorpg', 'massively multiplayer'],
  jrpg: ['jrpg', 'party-based rpg', 'turn-based combat', 'crpg'],
};
const FAMILY_OF = new Map<string, string[]>();
for (const [family, names] of Object.entries(FAMILIES)) for (const n of names) FAMILY_OF.set(n, [...(FAMILY_OF.get(n) ?? []), family]);

/** How much a tag says about a game by its kind alone (before how common it is in this library). */
export function tagKind(name: string | undefined): 'generic' | 'soft' | 'specific' {
  const n = (name ?? '').trim().toLowerCase();
  if (GENERIC.has(n)) return 'generic';
  if (FAMILY_OF.has(n)) return 'specific';
  return SOFT.has(n) ? 'soft' : 'specific';
}
const KIND_FACTOR = { generic: 0.2, soft: 0.55, specific: 1 } as const;

/** A tag at rank i (0 = strongest) of a game's list. */
const rankWeight = (i: number) => 1 / (1 + 0.12 * i);

/** Per tag map (cached by identity): how many tagged games have each tag, and how many games have tags at all. */
const dfCache = new WeakMap<Record<string, number[]>, { df: Map<number, number>; n: number }>();
function frequencies(tagMap: Record<string, number[]>): { df: Map<number, number>; n: number } {
  const hit = dfCache.get(tagMap);
  if (hit) return hit;
  const df = new Map<number, number>();
  let n = 0;
  for (const ids of Object.values(tagMap)) {
    if (!Array.isArray(ids) || ids.length === 0) continue;
    n++;
    for (const id of ids.slice(0, 20)) df.set(id, (df.get(id) ?? 0) + 1);
  }
  const out = { df, n };
  dfCache.set(tagMap, out);
  return out;
}

/**
 * Inverse document frequency in this library: a tag on every game is worth ln 2, one on a tenth of them ln 11. With
 * few tagged games the counts mean little, so the weight leans toward neutral until there are a dozen.
 */
export function libraryIdf(df: number, n: number): number {
  const raw = Math.log(1 + Math.max(1, n) / Math.max(1, df));
  if (n >= 12) return raw;
  return 1 + (raw - 1) * (Math.max(0, n) / 12);
}

export interface TagWeights {
  /** Weight of a tag in this library (IDF × kind × family). */
  weight(id: number): number;
  name(id: number): string | undefined;
}

/** The weight of every tag in this library: rare, specific tags far above common, generic ones. */
export function tagWeights(tags: LibraryTags | null | undefined): TagWeights {
  const names = new Map((tags?.tags ?? []).map((t) => [t.id, t.name]));
  const { df, n } = frequencies(tags?.games ?? {});
  const cache = new Map<number, number>();
  return {
    name: (id) => names.get(id),
    weight(id) {
      let w = cache.get(id);
      if (w != null) return w;
      const name = names.get(id);
      w = libraryIdf(df.get(id) ?? 1, n) * KIND_FACTOR[tagKind(name)] * (name && FAMILY_OF.has(name.toLowerCase()) ? 1.25 : 1);
      cache.set(id, w);
      return w;
    },
  };
}

const familiesOf = (name: string | undefined): readonly string[] => (name ? FAMILY_OF.get(name.toLowerCase()) ?? [] : []);

/** Store genres (not tags) that say little: Action, Adventure, Indie, Casual and friends. */
const GENERIC_GENRES = new Set(['action', 'adventure', 'indie', 'casual', 'free to play', 'early access', 'massively multiplayer', 'singleplayer', 'multiplayer']);

export function similarInLibrary(
  game: Game,
  library: readonly Game[],
  opts: { tags?: LibraryTags | null; facts?: SimilarFacts | null; now?: number; limit?: number } = {},
): SimilarPick[] {
  const now = opts.now ?? Date.now();
  const tagMap = opts.tags?.games ?? {};
  const W = tagWeights(opts.tags);
  const mine = (tagMap[game.id] ?? []).slice(0, MY_TAGS);
  const myVec = new Map(mine.map((id, i) => [id, W.weight(id) * rankWeight(i)]));
  let myNorm = 0;
  for (const v of myVec.values()) myNorm += v * v;
  myNorm = Math.sqrt(myNorm);
  // The genre families this game defines itself by (one of their tags among its strongest few).
  const defining = new Set(mine.slice(0, DEFINING_TOP).flatMap((id) => familiesOf(W.name(id))));
  const myGenres = new Map(game.genres.map((g) => [g.trim().toLowerCase(), g.trim()]));
  // For games without tags on both sides, the store genres say which family it is (a "Racing" genre).
  const myFamilies = new Set([...defining, ...game.genres.flatMap((g) => familiesOf(g.trim()))]);
  const mySeries = seriesKey(game.title);
  const igdbSeries = (opts.facts?.series ?? []).map((s) => normTitle(s.replace(/\bseries\b/i, ''))).filter((s) => s.length >= 4);
  const igdbSimilar = new Set((opts.facts?.similar ?? []).map(normTitle).filter(Boolean));
  const myTitle = normTitle(game.title);

  const picks: SimilarPick[] = [];
  for (const g of library) {
    if (g.id === game.id || g.hidden || g.notOwned) continue;
    const title = normTitle(g.title);
    if (title === myTitle) continue; // another edition of the same game
    let score = 0;
    let specific = false;
    /** 0 = not in this game's genre family; up to 1 = squarely in it. */
    let family = 0;
    const shared: { name: string; w: number }[] = [];

    // Community tags: the cosine of the two weighted tag lists (0 = nothing alike, 1 = the same list).
    const theirs = (tagMap[g.id] ?? []).slice(0, THEIR_TAGS);
    const hasTags = mine.length > 0 && theirs.length > 0;
    if (hasTags) {
      let dot = 0;
      let theirNorm = 0;
      /** Family → how high its first tag sits in this game's list (GTA V lists Racing 11th: driving is a side dish). */
      const theirFamilies = new Map<string, number>();
      theirs.forEach((id, j) => {
        const v = W.weight(id) * rankWeight(j);
        theirNorm += v * v;
        const name = W.name(id);
        for (const f of familiesOf(name)) if (!theirFamilies.has(f)) theirFamilies.set(f, Math.min(1, Math.max(0.3, 1 - (j - 2) * 0.0875)));
        const m = myVec.get(id);
        if (m == null) return;
        dot += m * v;
        if (name) shared.push({ name, w: m * v });
        if (tagKind(name) !== 'generic') specific = true;
      });
      // Cosine, except that a game whose own list is mostly generic (a thin profile) counts as if it were as full as
      // this one's: two deep Racing tags shouldn't make GTA V look like a racer.
      score += myNorm > 0 && theirNorm > 0 ? (dot / (myNorm * Math.max(myNorm, Math.sqrt(theirNorm)))) * TAG_SCALE : 0;
      family = Math.max(0, ...[...myFamilies].map((f) => theirFamilies.get(f) ?? 0));
      // Strongest shared tags first.
      shared.sort((a, b) => b.w - a.w);
    }

    // Genres: worth less when tags already describe both games (they overlap), and generic ones barely count.
    const genreNames: string[] = [];
    for (const genre of g.genres) {
      const own = myGenres.get(genre.trim().toLowerCase());
      if (!own) continue;
      const generic = GENERIC_GENRES.has(own.toLowerCase());
      score += hasTags ? (generic ? 0.05 : 0.25) : generic ? 0.3 : 0.9;
      if (!generic) specific = true;
      genreNames.push(own);
      // A shared genre from this game's family (both "Racing") is a family signal too: the whole signal when there
      // are no tags to compare, a weaker one next to tags.
      if (familiesOf(own).some((f) => myFamilies.has(f))) family = Math.max(family, hasTags ? 0.6 : 1);
    }
    // Genre families: a boost for being the same kind of game; most of the score goes when this game defines itself
    // by a family the other isn't in.
    if (family > 0) score += FAMILY_BONUS * family;
    else if (myFamilies.size) score *= OFF_FAMILY;

    const sameSeries = (!!mySeries && seriesKey(g.title) === mySeries) || igdbSeries.some((s) => title.startsWith(s));
    if (sameSeries) score += 3;
    const igdb = igdbSimilar.has(title);
    if (igdb) score += 2;
    // Show nothing rather than a weak pick: enough in common, and something specific (not just Singleplayer + Action).
    if (score < MIN_SCORE || (!specific && !sameSeries && !igdb)) continue;
    // IGDB's list is what put it here (it wouldn't make it on tags and genres alone): say so first.
    const igdbCarried = igdb && !sameSeries && (score - 2 < MIN_SCORE || !specific);

    // Forgotten games first: never played, or not for months. Games you're playing right now step back a little.
    // (A nudge among comparable picks: it never lifts a loose match over a close one.)
    const f = forgottenOf(g, now);
    if (f.kind === 'never') score *= 1.25;
    else if (f.kind === 'long') score *= 1 + Math.min(0.25, (f.days / 30.44) * 0.03);
    else if (f.kind === 'recent') score *= 0.85;
    if (g.status === 'abandoned') score *= 0.7;

    const parts: string[] = [];
    if (sameSeries) parts.push('Same series');
    else if (igdbCarried) parts.push('IGDB calls it similar');
    const named = explainShared(shared.map((s) => s.name), genreNames);
    if (named.length) parts.push(`Shares ${named.join(' · ')}`);
    else if (igdb && !sameSeries && !igdbCarried) parts.push('IGDB calls it similar');
    if (f.kind === 'never') parts.push('never played');
    else if (f.kind === 'long') parts.push(`not played in ${awaySpan(f.days)}`);
    picks.push({ game: g, score, why: parts.join(' · '), sameSeries, forgotten: f.kind === 'never' || f.kind === 'long' ? f.kind : null });
  }
  return picks.sort((a, b) => b.score - a.score || a.game.sortTitle.localeCompare(b.game.sortTitle)).slice(0, opts.limit ?? 10);
}

/**
 * Up to three names for "Shares …": specific tags first (strongest shared first), then broad ones, then genres not
 * already named. Generic tags and genres (Singleplayer, Action) are never named: a pick that shares only those is
 * there for another reason (same series, IGDB), and says that instead.
 */
export function explainShared(tagNames: readonly string[], genreNames: readonly string[], max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const k = n.toLowerCase();
    if (seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push(n);
  };
  for (const n of tagNames) if (tagKind(n) === 'specific') add(n);
  for (const n of tagNames) if (tagKind(n) === 'soft') add(n);
  for (const n of genreNames) if (!GENERIC_GENRES.has(n.toLowerCase()) && tagKind(n) !== 'generic') add(n);
  return out;
}
