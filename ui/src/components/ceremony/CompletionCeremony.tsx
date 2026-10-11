import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Clipboard, Download, Trophy } from 'lucide-react';
import { call, errorMessage } from '../../bridge/bridge';
import type { AchievementProgress, Game, Session } from '../../bridge/types';
import { ceremonyFacts, ceremonySummary, type CeremonyFacts } from '../../lib/ceremony';
import { exit, spring } from '../../lib/motion';
import { peekPalette, titleHue } from '../../lib/palette';
import { CARD_H, CARD_W, toBase64Chunks } from '../../lib/replay';
import { sound } from '../../lib/sound';
import { useCeremony } from '../../state/ceremony';
import { useReducedMotion, useStore } from '../../state/store';
import { GameCover } from '../game/GameCover';
import { Button } from '../ui/primitives';
import { drawCompletion, type CompletionImages, type CompletionTheme } from './drawCompletion';
import './ceremony.css';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Loads an image as a bitmap through fetch, so the canvas never becomes tainted (same as the replay card). */
async function bitmap(url: string | null | undefined): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/** Sends the PNG in chunks (one bridge message is capped at 256 K characters). */
async function upload(gameId: string, blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { token } = await call<{ token: string }>('completion.imageBegin', { gameId, bytes: bytes.length });
  const chunks = toBase64Chunks(bytes);
  for (let i = 0; i < chunks.length; i++) await call('completion.imageChunk', { token, index: i, data: chunks[i] });
  return token;
}

/**
 * Track E2a: the Completed 100% ceremony. Mounted once (App); shows when a game is marked Completed 100% for the
 * first time. The cover rises into a golden light that sweeps across it, the achievements ring fills (when Steam
 * achievements are known), hours and the time since your first session count in, and a soft fanfare plays (only
 * with interface sounds on). Reduced motion gets one quiet fade. Save image / Copy image make a 1920×1080 card.
 */
export function CompletionCeremonyHost() {
  const gameId = useCeremony((s) => s.gameId);
  const at = useCeremony((s) => s.at);
  const close = useCeremony((s) => s.close);
  const game = useStore((s) => (gameId ? s.gamesById.get(gameId) : undefined));
  return createPortal(
    <AnimatePresence>{game && <Ceremony key={game.id} game={game} at={at} onClose={() => close()} />}</AnimatePresence>,
    document.body,
  );
}

type Facts = { state: 'loading' } | { state: 'ready'; facts: CeremonyFacts };

function Ceremony({ game, at, onClose }: { game: Game; at: number; onClose: () => void }) {
  const reduce = useReducedMotion();
  const toast = useStore((s) => s.toast);
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Facts>({ state: 'loading' });
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null);
  const hue = titleHue(game.title);
  const accent = peekPalette(game)?.accent ?? `oklch(0.72 0.15 ${hue})`;

  // What the moment says: real numbers only (sessions VYSTRAL saw, Steam achievements when known).
  useEffect(() => {
    let alive = true;
    const steam = game.installations.some((i) => i.platform === 'steam');
    void Promise.all([
      call<Session[]>('sessions.list', { gameId: game.id, limit: 5000 }).catch(() => [] as Session[]),
      steam ? call<AchievementProgress | null>('gamePage.achievements', { gameId: game.id }).catch(() => null) : Promise.resolve(null),
    ]).then(([sessions, ach]) => {
      if (alive) setData({ state: 'ready', facts: ceremonyFacts(game, Array.isArray(sessions) ? sessions : [], ach ?? null) });
    });
    return () => { alive = false; };
    // The moment is about the game as it was when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // A soft fanfare as the cover arrives (respects the interface-sounds setting and never plays during a game).
  useEffect(() => {
    const t = window.setTimeout(() => sound.fanfare(), reduce ? 0 : 280);
    return () => window.clearTimeout(t);
  }, [reduce]);

  // Modal: focus moves in, Tab stays inside, Escape (controller B) closes, focus returns afterwards.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), reduce ? 20 : 420);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose, reduce]);

  const facts = data.state === 'ready' ? data.facts : null;
  const summary = facts ? ceremonySummary(game.title, facts) : `${game.title}: completed 100%.`;

  const renderPng = useCallback(async (): Promise<Blob> => {
    if (!facts) throw new Error('The card isn’t ready yet.');
    const css = getComputedStyle(document.documentElement);
    const theme: CompletionTheme = {
      accent,
      fontDisplay: css.getPropertyValue('--font-display').trim() || 'sans-serif',
      fontUi: css.getPropertyValue('--font-ui').trim() || 'sans-serif',
      hue,
    };
    const [cover, backdrop] = await Promise.all([bitmap(game.art.cover ?? game.art.header), bitmap(game.art.hero ?? game.art.header)]);
    await document.fonts?.ready;
    const images: CompletionImages = { cover, backdrop };
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The image couldn’t be created.');
    drawCompletion(ctx, game.title, facts, images, theme, new Date(at || Date.now()));
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('The image couldn’t be created.');
    return blob;
  }, [facts, accent, hue, game, at]);

  const save = async () => {
    setBusy('save');
    try {
      const token = await upload(game.id, await renderPng());
      const r = await call<{ path: string } | null>('completion.imageSave', { token }, 300_000);
      if (r?.path) toast({ tone: 'success', title: 'Image saved', body: r.path });
    } catch (err) {
      toast({ tone: 'danger', title: 'Couldn’t save the image', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    setBusy('copy');
    try {
      const token = await upload(game.id, await renderPng());
      await call('completion.imageCopy', { token });
      toast({ tone: 'success', title: 'Image copied', body: 'Paste it anywhere that takes images.' });
    } catch (err) {
      toast({ tone: 'danger', title: 'Couldn’t copy the image', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const style = { ['--c100-accent' as string]: accent, ['--c100-hue' as string]: hue } as CSSProperties;
  const stagger = (i: number) => (reduce ? { duration: 0.2 } : { ...spring.panel, delay: 0.55 + i * 0.12 });

  return (
    <motion.div
      className="c100"
      data-reduced={reduce || undefined}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: reduce ? { duration: 0.15 } : exit }}
      transition={{ duration: reduce ? 0.35 : 0.4 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      data-dialog-open
    >
      <div ref={ref} className="c100__stage" role="dialog" aria-modal="true" aria-labelledby="c100-title" aria-describedby="c100-summary">
        <p id="c100-summary" className="visually-hidden">{summary}</p>
        {!reduce && <Motes />}
        <motion.div
          className="c100__cover"
          initial={reduce ? false : { opacity: 0, y: 90, scale: 0.84, rotateX: 22 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18, mass: 1.1, delay: 0.05 }}
        >
          <span className="c100__halo" aria-hidden />
          <span className="c100__frame">
            <GameCover game={game} eager />
            {!reduce && <span className="c100__sweep" aria-hidden />}
          </span>
        </motion.div>

        <div className="c100__text">
          <motion.p className="c100__eyebrow" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={stagger(0)}>
            <Trophy size={16} aria-hidden /> Completed 100%
          </motion.p>
          <motion.h2 id="c100-title" className="c100__title" initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={stagger(1)}>
            {game.title}
          </motion.h2>
          <div className="c100__facts" aria-hidden>
            {facts ? (
              <>
                {facts.achievements && <Ring a={facts.achievements} reduce={reduce} delay={reduce ? 0 : 0.95} />}
                {facts.hours && (
                  <motion.span className="c100__fact" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={stagger(3)}>
                    <b>{facts.hours}</b><span>played</span>
                  </motion.span>
                )}
                {facts.span && facts.since && (
                  <motion.span className="c100__fact" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={stagger(4)}
                    title={`From ${facts.since.at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`}>
                    <b>{facts.span}</b><span>{facts.since.kind === 'firstSession' ? 'since your first session' : 'in your library'}</span>
                  </motion.span>
                )}
              </>
            ) : <span className="c100__fact c100__fact--wait" />}
          </div>
          <motion.div className="c100__actions" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={stagger(5)}>
            <Button variant="primary" onClick={onClose} data-autofocus>Done</Button>
            <Button icon={<Download size={15} />} loading={busy === 'save'} disabled={!facts || !!busy} onClick={() => void save()}>Save image</Button>
            <Button variant="ghost" icon={<Clipboard size={15} />} loading={busy === 'copy'} disabled={!facts || !!busy} onClick={() => void copy()}>Copy image</Button>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/** The achievements ring: fills to what you've unlocked (it rarely reaches all of them, and says so honestly). */
function Ring({ a, reduce, delay }: { a: NonNullable<CeremonyFacts['achievements']>; reduce: boolean; delay: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const target = c * (1 - a.ratio);
  return (
    <span className="c100__fact c100__ring-fact">
      <svg className="c100__ring" viewBox="0 0 72 72" width={72} height={72} aria-hidden>
        <circle cx={36} cy={36} r={r} className="c100__ring-track" />
        <motion.circle cx={36} cy={36} r={r} className="c100__ring-fill" strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? target : c }} animate={{ strokeDashoffset: target }}
          transition={reduce ? { duration: 0 } : { duration: 1.3, ease: [0.22, 1, 0.36, 1], delay }} />
        <text x={36} y={41} textAnchor="middle" className="c100__ring-pct">{Math.round(a.ratio * 100)}%</text>
      </svg>
      <span className="c100__ring-words"><b>{a.unlocked} of {a.total}</b><span>achievements</span></span>
    </span>
  );
}

/** A few golden motes drifting up around the cover (decorative; not shown with reduced motion). */
function Motes() {
  const motes = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    left: 50 + Math.sin(i * 2.4) * 34,
    delay: 0.4 + ((i * 0.37) % 2.2),
    dur: 3.2 + ((i * 0.61) % 1.8),
    size: 3 + (i % 3),
  })), []);
  return (
    <span className="c100__motes" aria-hidden>
      {motes.map((m, i) => (
        <span key={i} style={{ left: `${m.left}%`, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` } as CSSProperties} />
      ))}
    </span>
  );
}
