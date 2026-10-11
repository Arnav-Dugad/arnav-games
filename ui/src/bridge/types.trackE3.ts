// ---------- Track E3: performance insights (mirror of Core/Contracts/PerfInsightDtos.cs) ----------

/** Windows' effective power mode while a session ran (read-only). */
export type PowerMode = 'batterySaver' | 'betterBattery' | 'balanced' | 'highPerformance' | 'maxPerformance' | 'gameMode' | 'mixedReality';

/** Seconds plugged in, on battery and unknown; seconds with battery saver on; the most-used power mode. */
export interface SessionPower {
  acSeconds: number;
  batterySeconds: number;
  unknownSeconds: number;
  saverSeconds: number;
  mode: PowerMode | null;
}

/** What a finished session adds to its perf summary. Null when it wasn't recorded. */
export interface PerfSessionExtra {
  sessionId: string;
  driver: string | null;
  displayHz: number | null;
  power: SessionPower | null;
}

/** A game's frame-rate goal: a fixed target (20–360 fps), or `display` for each session's display refresh rate. */
export interface PerfGoal {
  gameId: string;
  targetFps: number | null;
  display: boolean;
}

/** call('perfInsights.context'). */
export interface PerfInsightContext {
  /** This PC reports a system battery (laptops, handhelds). */
  hasBattery: boolean;
  onBattery: boolean | null;
  /** Finished sessions with at least one extra value. */
  sessions: PerfSessionExtra[];
  goals: PerfGoal[];
}

/** evt('perf.insight'): a note the backend announces once, when the session that caused it ends. */
export interface PerfInsightEvent {
  kind: 'thermal' | 'driver';
  sessionId: string;
  gameId: string;
  title: string;
  body: string;
}
