import { useEffect, type ReactNode } from 'react';
import { Bell, Brain, CalendarDays, History, Mic, Trash2 } from 'lucide-react';
import { call } from '../../bridge/bridge';
import type { Settings } from '../../bridge/types';
import { mondayOf } from '../../lib/assistantExtras';
import { useExtras } from '../../state/assistantExtras';
import { useStore } from '../../state/store';
import { HoldToConfirm } from '../controller/HoldToConfirm';
import { Badge, Button, Kbd, Toggle } from '../ui/primitives';
import { VoiceStatusLine } from './VoiceInput';
import './assistant-extras.css';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2026, 0, 4, h));

/**
 * Track E1: Settings › AI › Assistant, continued — memory, voice input, the weekly recap notification and learned
 * suggestions. Each says plainly what it keeps and where.
 */
export function AssistantExtrasSettings() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const navigate = useStore((s) => s.navigate);
  const memory = useExtras((s) => s.memory);
  const voice = useExtras((s) => s.voice);
  const learned = useExtras((s) => s.learned);

  useEffect(() => {
    void useExtras.getState().loadMemory();
    void useExtras.getState().refreshVoice();
    void useExtras.getState().loadLearned();
  }, []);
  useEffect(() => {
    void useExtras.getState().refreshVoice();
  }, [settings?.['assistant.voice']]);

  if (!settings) return null;
  const toggle = (k: keyof Settings, label: string, hint: ReactNode, icon: ReactNode, extra?: ReactNode) => (
    <div className="srow" data-row={k}>
      <div className="srow__text">
        <label className="srow__label asx-set__label" htmlFor={`asx-e1-${k}`}>{icon}{label}</label>
        <div className="srow__hint">{hint}</div>
        {extra}
      </div>
      <div className="srow__control">
        <Toggle id={`asx-e1-${k}`} label={label} checked={!!settings[k]} onChange={(v) => void setSetting(k, v as never)} />
      </div>
    </div>
  );
  const memCount = memory?.items.length ?? 0;
  const learnedCount = Object.values(learned?.pages ?? {}).reduce((n, l) => n + (l?.length ?? 0), 0);
  const recapOn = settings['notifications.weeklyRecap'];

  return (
    <section className="sgroup" aria-labelledby="asx-e1-title" id="assistant-extras">
      <h2 className="sgroup__title" id="asx-e1-title">Memory, voice and recaps</h2>
      <div className="sgroup__rows surface">
        {toggle('assistant.memory', 'Assistant memory',
          <>Remembers preferences you confirm (“Remember: I like short games on weekdays?”) or add yourself, on this PC. With a cloud AI they go along with your messages, and each answer’s <em>What was sent</em> says so.</>,
          <Brain size={14} aria-hidden />,
          <div className="asx-set__inline">
            <Button size="sm" variant="secondary" onClick={() => useExtras.getState().openMemory()}>
              {memCount ? `View and edit ${memCount} ${memCount === 1 ? 'memory' : 'memories'}` : 'View memories'}
            </Button>
            {memCount > 0 && <HoldToConfirm size="sm" icon={<Trash2 size={13} />} onConfirm={() => void useExtras.getState().clearMemory()}>Forget everything</HoldToConfirm>}
          </div>)}

        {toggle('assistant.voice', 'Voice input (push to talk)',
          <>Hold the microphone button, or hold <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> in the message box, and speak. Uses Windows’ own speech recognizer on this PC: the microphone is on only while you hold, and audio isn’t saved or sent anywhere.</>,
          <Mic size={14} aria-hidden />,
          settings['assistant.voice'] ? (
            <div className="asx-set__inline" aria-live="polite">
              <VoiceStatusLine status={voice} />
              {voice?.fix === 'microphone' && <Button size="sm" variant="secondary" onClick={() => void call('voice.openSettings', { target: 'microphone' })}>Open microphone settings</Button>}
              {voice?.fix === 'language' && <Button size="sm" variant="secondary" onClick={() => void call('voice.openSettings', { target: 'language' })}>Open language settings</Button>}
            </div>
          ) : undefined)}

        {toggle('notifications.weeklyRecap', 'Weekly recap notification',
          <>A Windows notification with your week in games, scheduled on this PC. Selecting it opens the Assistant with the full recap. Skipped for weeks without play and while you’re playing.</>,
          <Bell size={14} aria-hidden />,
          <div className="asx-set__inline">
            <label className="asx-set__select">
              <span className="visually-hidden">Recap day</span>
              <select className="input" value={settings['assistant.recapDay']} disabled={!recapOn}
                onChange={(e) => void setSetting('assistant.recapDay', e.target.value as Settings['assistant.recapDay'])}>
                <option value="sunday">Sundays (this week)</option>
                <option value="monday">Mondays (last week)</option>
              </select>
            </label>
            <label className="asx-set__select">
              <span className="visually-hidden">Recap time</span>
              <select className="input" value={settings['assistant.recapHour']} disabled={!recapOn}
                onChange={(e) => void setSetting('assistant.recapHour', Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <Button size="sm" variant="ghost" icon={<CalendarDays size={13} aria-hidden />} onClick={() => navigate({ name: 'assistant', recap: mondayOf(new Date()) })}>
              See this week’s recap
            </Button>
            {settings['notifications.enabled'] === false && recapOn && <Badge tone="warn">Windows notifications are off above</Badge>}
          </div>)}

        {toggle('assistant.learnPrompts', 'Learn suggestions from what I ask',
          <>Questions you ask more than once become suggestions on that kind of page, mixed with Arnav Games’ own. Kept on this PC.</>,
          <History size={14} aria-hidden />,
          learnedCount > 0 ? (
            <div className="asx-set__inline">
              <span className="srow__hint">{learnedCount} learned {learnedCount === 1 ? 'question' : 'questions'}.</span>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={() => void useExtras.getState().clearLearned()}>Forget learned suggestions</Button>
            </div>
          ) : undefined)}
      </div>
    </section>
  );
}
