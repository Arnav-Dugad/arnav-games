import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Mic, MicOff, ShieldCheck } from 'lucide-react';
import { call, errorMessage, on } from '../../bridge/bridge';
import type { VoiceEvent, VoiceStatus } from '../../bridge/types';
import { endsPushToTalk, isPushToTalk, levelBars, mergeDictation } from '../../lib/assistantExtras';
import { pick, spring } from '../../lib/motion';
import { useExtras } from '../../state/assistantExtras';
import { useGameRunning, useReducedMotion, useStore } from '../../state/store';
import { Button, Kbd } from '../ui/primitives';
import './assistant-extras.css';

type Phase = 'idle' | 'starting' | 'listening' | 'finishing';

let seq = 0;
const newSession = () => `vx-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/**
 * Track E1: push-to-talk for the Assistant's message box. Hold the microphone button, or hold Ctrl+Space in the message
 * box: Windows' on-device speech recognizer listens only while held, words appear live with a level meter, and on release
 * they're added to the message for you to edit and send (nothing is sent by itself). Escape cancels. Hidden until voice
 * input is turned on in Settings; when Windows can't do it, the button explains why and how to fix it.
 */
export function VoiceInput({ inputRef, draft, setDraft, disabled }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  disabled?: boolean;
}) {
  const enabled = useStore((s) => !!s.settings?.['assistant.voice']);
  const status = useExtras((s) => s.voice);
  const running = useGameRunning();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [levels, setLevels] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const session = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const helpId = useId();

  useEffect(() => {
    if (enabled) void useExtras.getState().refreshVoice();
  }, [enabled]);

  // Events for the current hold only.
  useEffect(() => on('voice.event', (e: VoiceEvent) => {
    if (!e || e.sessionId !== session.current) return;
    switch (e.type) {
      case 'start':
        setPhase('listening');
        break;
      case 'level':
        setLevels((l) => [...l.slice(-47), e.level]);
        break;
      case 'partial':
        setText(e.text);
        break;
      case 'notice':
        setNotice(e.message);
        break;
      case 'end':
      case 'error': {
        session.current = null;
        setPhase('idle');
        setLevels([]);
        const spoken = e.text ?? '';
        if (e.type === 'error') setProblem(e.message);
        if (spoken && !(e.type === 'end' && e.cancelled)) {
          setDraft(mergeDictation(draftRef.current, spoken));
          requestAnimationFrame(() => inputRef.current?.focus());
        }
        setText('');
        break;
      }
    }
  }), [inputRef, setDraft]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle' || disabled) return;
    const st = useExtras.getState().voice;
    if (!st?.available) {
      setHelpOpen(true);
      return;
    }
    const id = newSession();
    session.current = id;
    setProblem(null);
    setNotice(null);
    setText('');
    setLevels([]);
    setPhase('starting');
    try {
      await call('voice.start', { sessionId: id });
      if (session.current === id && (phaseRef.current as Phase) === 'starting') setPhase('listening');
    } catch (err) {
      if (session.current === id) {
        session.current = null;
        setPhase('idle');
        setProblem(errorMessage(err));
        void useExtras.getState().refreshVoice();
      }
    }
  }, [disabled]);

  const stop = useCallback(async () => {
    const id = session.current;
    if (!id) return;
    setPhase('finishing');
    try {
      await call('voice.stop', { sessionId: id });
    } catch {
      // Already over; the end event (or nothing) follows.
    }
    // The recognizer finishes the phrase within a moment; never leave the box waiting.
    window.setTimeout(() => {
      if (session.current === id) { session.current = null; setPhase('idle'); setText(''); setLevels([]); }
    }, 5000);
  }, []);

  const cancel = useCallback(async () => {
    const id = session.current;
    if (!id) return;
    session.current = null;
    setPhase('idle');
    setText('');
    setLevels([]);
    try { await call('voice.cancel', { sessionId: id }); } catch { /* already over */ }
  }, []);

  // Hold Ctrl+Space in the message box; Escape cancels.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isPushToTalk(e)) {
        e.preventDefault();
        if (!e.repeat) void start();
      } else if (e.key === 'Escape' && session.current) {
        e.preventDefault();
        e.stopPropagation();
        void cancel();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (session.current && endsPushToTalk(e)) void stop();
    };
    el.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      el.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [inputRef, enabled, start, stop, cancel]);

  // Losing the window or the page ends a hold (the microphone never stays open by accident).
  useEffect(() => {
    const end = () => { if (session.current) void stop(); };
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', end);
    return () => {
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', end);
      if (session.current) void call('voice.cancel', { sessionId: session.current }).catch(() => {});
    };
  }, [stop]);

  if (!enabled) return null;
  const unavailable = !!status && !status.available;
  const live = phase === 'listening' || phase === 'starting' || phase === 'finishing';
  const label = running ? 'Voice input is paused while a game is running' : unavailable ? 'Voice input isn’t available' : live ? 'Release to add what you said' : 'Hold to talk';
  const bars = levelBars(levels, 28);

  return (
    <>
      <button
        type="button"
        className="asx-mic"
        data-live={live || undefined}
        data-unavailable={unavailable || running || undefined}
        aria-label={label}
        aria-keyshortcuts="Control+Space"
        aria-pressed={live}
        aria-describedby={helpOpen ? helpId : undefined}
        title={`${label} (hold Ctrl+Space in the message box)`}
        disabled={disabled || running}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); void start(); } }}
        onPointerUp={() => void stop()}
        onPointerCancel={() => void cancel()}
        onLostPointerCapture={() => { if (session.current) void stop(); }}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void start(); } else if (e.key === 'Escape') void cancel(); }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') void stop(); }}
        onClick={(e) => { if (unavailable) { e.preventDefault(); setHelpOpen((o) => !o); } }}
      >
        {unavailable || running ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
        {live && !reduce && <span className="asx-mic__halo" aria-hidden />}
      </button>
      <AnimatePresence>
        {live && (
          <motion.div
            className="asx-voice"
            role="status"
            aria-label="Listening"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={pick(reduce, spring.panel)}
          >
            <div className="asx-voice__meter" aria-hidden data-level={levels.length ? 'on' : 'off'}>
              {bars.map((b, i) => <span key={i} style={{ transform: `scaleY(${Math.max(0.08, b).toFixed(3)})` }} />)}
            </div>
            <p className="asx-voice__text selectable" data-empty={!text || undefined}>
              {text || (phase === 'starting' ? 'Starting the microphone…' : phase === 'finishing' ? 'Finishing…' : 'Listening… speak now')}
            </p>
            <p className="asx-voice__hint">
              <span><ShieldCheck size={12} aria-hidden /> On this PC · audio isn’t saved or sent</span>
              <span>Release to add it · <Kbd>Esc</Kbd> to cancel</span>
            </p>
            {notice && <p className="asx-voice__notice">{notice}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      {(helpOpen || problem) && !live && (
        <div id={helpId} className="asx-voice-help" role="note">
          <p>{problem ?? status?.reason ?? 'Voice input isn’t available right now.'}</p>
          <div className="asx-voice-help__actions">
            {status?.fix === 'microphone' && <Button size="sm" variant="secondary" onClick={() => void call('voice.openSettings', { target: 'microphone' })}>Open microphone settings</Button>}
            {status?.fix === 'language' && <Button size="sm" variant="secondary" onClick={() => void call('voice.openSettings', { target: 'language' })}>Open language settings</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setHelpOpen(false); setProblem(null); void useExtras.getState().refreshVoice(); }}>Dismiss</Button>
          </div>
        </div>
      )}
    </>
  );
}

/** The voice status line in Settings: which recognizer, and that audio stays on this PC. */
export function VoiceStatusLine({ status }: { status: VoiceStatus | null }) {
  if (!status) return <span>Checking Windows speech recognition…</span>;
  if (!status.available && status.fix !== 'setting') return <span className="asx-voice-status" data-bad>{status.reason}</span>;
  return (
    <span className="asx-voice-status">
      <ShieldCheck size={12} aria-hidden /> {status.engine}{status.languageName ? ` · ${status.languageName}` : ''} · on this PC. Audio isn’t saved or sent anywhere.
    </span>
  );
}
