import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, Check, Lock, MessageSquare, Pencil, Plus, Trash2, User, X } from 'lucide-react';
import { errorMessage } from '../../bridge/bridge';
import type { AssistantMemory } from '../../bridge/types';
import { memoryProblem } from '../../lib/assistantExtras';
import { formatRelative } from '../../lib/format';
import { pick, spring } from '../../lib/motion';
import { useExtras } from '../../state/assistantExtras';
import { useReducedMotion, useStore } from '../../state/store';
import { HoldToConfirm } from '../controller/HoldToConfirm';
import { Dialog } from '../ui/Dialog';
import { Button, IconButton, Toggle } from '../ui/primitives';
import './assistant-extras.css';

/** Track E1: the memory manager as a dialog (from the Assistant's header or Settings). */
export function MemoryDialog() {
  const open = useExtras((s) => s.memoryOpen);
  const close = useExtras((s) => s.closeMemory);
  return (
    <Dialog open={open} onClose={close} title={<span className="asx-mem__title"><Brain size={18} aria-hidden /> What the Assistant remembers</span>} wide
      actions={<Button onClick={close}>Done</Button>}>
      <MemoryManager />
    </Dialog>
  );
}

/**
 * Track E1: view, add, edit and delete what the Assistant remembers, or clear it all. Only things you confirmed or typed
 * here are kept, on this PC; with a cloud AI they go along with your messages, and each answer's "What was sent" says so.
 */
export function MemoryManager() {
  const list = useExtras((s) => s.memory);
  const enabled = useStore((s) => !!s.settings?.['assistant.memory']);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addId = useId();
  const errId = useId();

  useEffect(() => {
    if (!list) void useExtras.getState().loadMemory();
  }, [list]);

  const items = list?.items ?? [];
  const max = list?.max ?? 40;
  const full = items.length >= max;

  const add = async () => {
    const problem = memoryProblem(draft, list?.maxChars ?? 200);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await useExtras.getState().addMemory(draft, 'you');
      setDraft('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="asx-mem">
      <p className="asx-mem__intro">
        The Assistant uses these to tailor its answers. Only things you confirmed in a chat or typed here are kept, on this PC.
        With a cloud AI they go along with your messages, and each answer’s <em>What was sent</em> says so.
      </p>
      {!enabled && (
        <div className="asx-mem__off" role="note">
          <span>Memory is off, so the Assistant doesn’t use or add anything. What’s listed stays until you delete it.</span>
          <Toggle id="asx-mem-toggle" label="Use Assistant memory" checked={false} onChange={(v) => void setSetting('assistant.memory', v)} />
        </div>
      )}
      <form className="asx-mem__add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label htmlFor={addId} className="visually-hidden">Something for the Assistant to remember</label>
        <input
          id={addId}
          className="input"
          value={draft}
          maxLength={(list?.maxChars ?? 200) + 20}
          placeholder={full ? `Memory is full (${max}). Delete one first.` : 'For example: I like short games on weekdays'}
          disabled={!enabled || full || busy}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
        />
        <Button type="submit" variant="primary" icon={<Plus size={15} aria-hidden />} disabled={!enabled || full || busy || !draft.trim()}>Remember</Button>
      </form>
      {error && <p id={errId} className="asx-mem__error" role="alert">{error}</p>}
      {list == null ? (
        <p className="asx-mem__empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="asx-mem__empty">
          <Brain size={22} aria-hidden />
          <p><strong>Nothing remembered yet.</strong> Tell the Assistant “remember that I play with a controller”, or add something above.</p>
        </div>
      ) : (
        <ul className="asx-mem__list" aria-label="Memories">
          <AnimatePresence initial={false}>
            {items.map((m) => (
              <motion.li key={m.id} layout={!reduce} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }} transition={pick(reduce, spring.panel)}>
                <MemoryRow m={m} onError={(msg) => toast({ tone: 'danger', title: 'Couldn’t change that memory', body: msg })} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <div className="asx-mem__foot">
        <span><Lock size={12} aria-hidden /> {items.length} of {max} · never passwords, keys or links</span>
        {items.length > 0 && (
          <HoldToConfirm size="sm" icon={<Trash2 size={14} />} onConfirm={() => void useExtras.getState().clearMemory()}>Forget everything</HoldToConfirm>
        )}
      </div>
    </div>
  );
}

function MemoryRow({ m, onError }: { m: AssistantMemory; onError: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const save = async () => {
    const p = memoryProblem(text);
    if (p) { setProblem(p); return; }
    try {
      await useExtras.getState().updateMemory(m.id, text);
      setEditing(false);
      setProblem(null);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };
  return (
    <div className="asx-mem__row" data-editing={editing || undefined}>
      <span className="asx-mem__origin" title={m.origin === 'chat' ? 'Confirmed in a chat' : 'Added by you'}>
        {m.origin === 'chat' ? <MessageSquare size={14} aria-hidden /> : <User size={14} aria-hidden />}
        <span className="visually-hidden">{m.origin === 'chat' ? 'Confirmed in a chat' : 'Added by you'}</span>
      </span>
      {editing ? (
        <form className="asx-mem__edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label htmlFor={inputId} className="visually-hidden">Edit memory</label>
          <input id={inputId} className="input" value={text} data-autofocus autoFocus maxLength={240}
            aria-invalid={!!problem || undefined}
            onChange={(e) => { setText(e.target.value); setProblem(null); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setEditing(false); setText(m.text); setProblem(null); } }} />
          <IconButton size="sm" label="Save" type="submit"><Check size={15} /></IconButton>
          <IconButton size="sm" label="Cancel" type="button" onClick={() => { setEditing(false); setText(m.text); setProblem(null); }}><X size={15} /></IconButton>
          {problem && <p className="asx-mem__error" role="alert">{problem}</p>}
        </form>
      ) : (
        <>
          <span className="asx-mem__text selectable">{m.text}</span>
          <span className="asx-mem__when">{formatRelative(m.updatedAt)}</span>
          <span className="asx-mem__actions">
            <IconButton size="sm" label={`Edit “${m.text}”`} onClick={() => setEditing(true)}><Pencil size={14} /></IconButton>
            <IconButton size="sm" label={`Forget “${m.text}”`} onClick={() => void useExtras.getState().deleteMemory(m.id).catch((err) => onError(errorMessage(err)))}><Trash2 size={14} /></IconButton>
          </span>
        </>
      )}
    </div>
  );
}
