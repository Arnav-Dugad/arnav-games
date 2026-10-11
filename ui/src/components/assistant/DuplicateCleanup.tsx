import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, CopyCheck, Merge, Minus, RotateCcw, SkipForward } from 'lucide-react';
import { call, errorMessage } from '../../bridge/bridge';
import type { MergeProposal } from '../../bridge/types';
import { pick, spring } from '../../lib/motion';
import { useExtras } from '../../state/assistantExtras';
import { useReducedMotion, useStore } from '../../state/store';
import { GameCover } from '../game/GameCover';
import { Dialog } from '../ui/Dialog';
import { Badge, Button, Skeleton } from '../ui/primitives';
import './assistant-extras.css';

type RowState = 'pending' | 'merging' | 'merged' | 'skipped' | 'undoing' | 'undone' | 'failed';

const CONFIDENCE: Record<MergeProposal['confidence'], { label: string; tone: 'ok' | 'accent' | 'warn' }> = {
  strong: { label: 'Very likely the same', tone: 'ok' },
  likely: { label: 'Likely the same', tone: 'accent' },
  unsure: { label: 'Check this one', tone: 'warn' },
};

/**
 * Track E1: smart duplicate cleanup. The Assistant's proposals from the library's duplicate suggestions, each with the
 * facts behind it and which entry keeps its page. Approve or skip each one, or approve all after a review step. Merges
 * use the same `game.merge` as everywhere else, and each can be undone with `game.unmerge` (it separates exactly the
 * store versions that moved). Nothing on disk changes either way.
 */
export function DuplicateCleanupDialog() {
  const open = useExtras((s) => s.cleanupOpen);
  const close = useExtras((s) => s.closeCleanup);
  return (
    <Dialog open={open} onClose={close} wide title={<span className="asx-dup__title"><CopyCheck size={18} aria-hidden /> Clean up duplicates</span>}
      actions={<Button onClick={close}>Done</Button>}>
      {open && <DuplicateCleanup />}
    </Dialog>
  );
}

export function DuplicateCleanup() {
  const reduce = useReducedMotion();
  const toast = useStore((s) => s.toast);
  const refresh = useStore((s) => s.refreshLibrary);
  const byId = useStore((s) => s.gamesById);
  const [list, setList] = useState<MergeProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, { s: RowState; msg?: string }>>({});
  const [review, setReview] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await call<MergeProposal[]>('assistant.duplicates'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mark = (id: string, s: RowState, msg?: string) => setState((x) => ({ ...x, [id]: { s, msg } }));
  const pending = useMemo(() => (list ?? []).filter((p) => (state[p.id]?.s ?? 'pending') === 'pending'), [list, state]);

  const merge = async (p: MergeProposal): Promise<boolean> => {
    mark(p.id, 'merging');
    try {
      const ok = await call<boolean>('game.merge', { targetGameId: p.targetGameId, sourceGameId: p.sourceGameId });
      if (!ok) throw new Error('One of these entries is no longer in your library.');
      mark(p.id, 'merged');
      return true;
    } catch (err) {
      mark(p.id, 'failed', errorMessage(err));
      return false;
    }
  };

  const undo = async (p: MergeProposal) => {
    mark(p.id, 'undoing');
    try {
      for (const installationId of p.sourceInstallationIds) await call('game.unmerge', { installationId });
      mark(p.id, 'undone');
      await refresh();
      toast({ tone: 'success', title: 'Separated again', body: `${p.sourceTitle} has its own entry again. It won’t be suggested as a duplicate of ${p.targetTitle} any more.` });
    } catch (err) {
      mark(p.id, 'merged', errorMessage(err));
      toast({ tone: 'danger', title: 'Couldn’t separate them', body: `${errorMessage(err)} You can also separate versions from the game’s Versions tab.` });
    }
  };

  const approveOne = async (p: MergeProposal) => {
    if (await merge(p)) {
      await refresh();
      toast({ tone: 'success', title: `Merged into ${p.targetTitle}`, body: 'Both store versions stay. Undo separates them again.', action: { label: 'Undo', run: () => void undo(p) } });
    }
  };

  const runAll = async () => {
    if (!review || !list) return;
    setRunning(true);
    let done = 0;
    for (const id of review) {
      const p = list.find((x) => x.id === id);
      if (p && (await merge(p))) done++;
    }
    setRunning(false);
    setReview(null);
    await refresh();
    toast({ tone: done ? 'success' : 'warning', title: done === 1 ? '1 duplicate merged' : `${done} duplicates merged`, body: 'Each one can be undone from this list.' });
  };

  if (error) return <div className="asx-dup__error" role="alert"><p>{error}</p><Button size="sm" onClick={() => void load()}>Try again</Button></div>;
  if (!list) return <div className="asx-dup__loading" aria-busy="true"><Skeleton height={96} radius={16} /><Skeleton height={96} radius={16} /></div>;
  if (list.length === 0)
    return (
      <div className="asx-dup__empty">
        <CopyCheck size={26} aria-hidden />
        <p><strong>No possible duplicates.</strong> When VYSTRAL finds two entries that look like the same game but differ in edition or store, they show up here.</p>
      </div>
    );

  if (review)
    return (
      <div className="asx-dup__review">
        <p className="asx-dup__intro">Merge these {review.length === 1 ? 'one' : review.length}? Untick any you want to keep apart. Every merge can be undone afterwards.</p>
        <ul className="asx-dup__checks">
          {pending.map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={review.includes(p.id)} disabled={running}
                  onChange={(e) => setReview((r) => (r ? (e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id)) : r))} />
                <span><strong>{p.sourceTitle}</strong> into <strong>{p.targetTitle}</strong></span>
                <Badge tone={CONFIDENCE[p.confidence].tone}>{CONFIDENCE[p.confidence].label}</Badge>
              </label>
            </li>
          ))}
        </ul>
        <div className="asx-dup__bar">
          <Button variant="ghost" icon={<ArrowLeft size={15} aria-hidden />} onClick={() => setReview(null)} disabled={running}>Back</Button>
          <Button variant="primary" icon={<Merge size={15} aria-hidden />} loading={running} disabled={!review.length || running} onClick={() => void runAll()}>
            {review.length === 1 ? 'Merge 1' : `Merge ${review.length}`}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="asx-dup">
      <p className="asx-dup__intro">
        These look like the same game in different stores or editions, so VYSTRAL kept them apart until you say so. Merging only changes how they
        appear here: both store versions stay, and nothing on disk changes.
      </p>
      {pending.length > 1 && (
        <div className="asx-dup__bar">
          <span>{pending.length} to review</span>
          <Button size="sm" variant="secondary" icon={<Check size={14} aria-hidden />} onClick={() => setReview(pending.map((p) => p.id))}>Approve all…</Button>
        </div>
      )}
      <ul className="asx-dup__list" aria-label="Merge proposals">
        <AnimatePresence initial={false}>
          {list.map((p) => {
            const st = state[p.id]?.s ?? 'pending';
            const target = byId.get(p.targetGameId);
            const source = byId.get(p.sourceGameId);
            return (
              <motion.li key={p.id} className="asx-dup__item surface" data-state={st} layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pick(reduce, spring.panel)}>
                <div className="asx-dup__pair">
                  <span className="asx-dup__cover" aria-hidden>{source && <GameCover game={source} />}</span>
                  <span className="asx-dup__arrow" aria-hidden><Merge size={16} /></span>
                  <span className="asx-dup__cover" aria-hidden>{target && <GameCover game={target} />}</span>
                  <div className="asx-dup__names">
                    <h3 className="asx-dup__name"><span>{p.sourceTitle}</span> <span className="asx-dup__into">into</span> <span>{p.targetTitle}</span></h3>
                    <Badge tone={CONFIDENCE[p.confidence].tone}>{CONFIDENCE[p.confidence].label}</Badge>
                  </div>
                </div>
                <ul className="asx-dup__facts" aria-label="Why">
                  {p.facts.map((f) => (
                    <li key={f.kind + f.text} data-supports={f.supports || undefined}>
                      {f.supports ? <Check size={13} aria-hidden /> : <Minus size={13} aria-hidden />}
                      <span><span className="visually-hidden">{f.supports ? 'Alike: ' : 'Different: '}</span>{f.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="asx-dup__keep">{p.keepReason}</p>
                <div className="asx-dup__actions" aria-live="polite">
                  {st === 'pending' && (
                    <>
                      <Button size="sm" variant="ghost" icon={<SkipForward size={14} aria-hidden />} onClick={() => mark(p.id, 'skipped')}>Skip</Button>
                      <Button size="sm" variant="primary" icon={<Merge size={14} aria-hidden />} onClick={() => void approveOne(p)}>Approve merge</Button>
                    </>
                  )}
                  {(st === 'merging' || st === 'undoing') && <span className="asx-dup__status">{st === 'merging' ? 'Merging…' : 'Separating…'}</span>}
                  {st === 'merged' && (
                    <>
                      <span className="asx-dup__status" data-ok><Check size={14} aria-hidden /> Merged</span>
                      <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} onClick={() => void undo(p)}>Undo</Button>
                    </>
                  )}
                  {st === 'skipped' && (
                    <>
                      <span className="asx-dup__status">Skipped</span>
                      <Button size="sm" variant="ghost" onClick={() => mark(p.id, 'pending')}>Review again</Button>
                    </>
                  )}
                  {st === 'undone' && <span className="asx-dup__status">Kept apart</span>}
                  {st === 'failed' && (
                    <>
                      <span className="asx-dup__status" data-bad>{state[p.id]?.msg ?? 'That didn’t work.'}</span>
                      <Button size="sm" variant="ghost" onClick={() => void approveOne(p)}>Try again</Button>
                    </>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
