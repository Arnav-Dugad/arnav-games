namespace Vystral.Core.Contracts;

// Track E3 (performance insights) bridge DTOs. Mirrored in ui/src/bridge/types.trackE3.ts.

/// <summary>Seconds plugged in, on battery and unknown; seconds with battery saver on; the most-used effective power mode.</summary>
public sealed record SessionPowerDto(int AcSeconds, int BatterySeconds, int UnknownSeconds, int SaverSeconds, string? Mode);

/// <summary>What a finished session adds to its perf summary: the GPU driver, the display refresh rate and the power state.</summary>
public sealed record PerfSessionExtraDto(string SessionId, string? Driver, int? DisplayHz, SessionPowerDto? Power);

/// <summary>A game's frame-rate goal: TargetFps (20–360), or Display = true for each session's display refresh rate.</summary>
public sealed record PerfGoalDto(string GameId, int? TargetFps, bool Display);

/// <summary>
/// call('perfInsights.context'). HasBattery: this PC reports a system battery right now; OnBattery: it is running on it
/// (null when Windows didn't say). Sessions lists only finished sessions that have at least one extra value.
/// </summary>
public sealed record PerfInsightContextDto(bool HasBattery, bool? OnBattery, IReadOnlyList<PerfSessionExtraDto> Sessions, IReadOnlyList<PerfGoalDto> Goals);

/// <summary>evt('perf.insight'): a note announced once. Kind: thermal | driver.</summary>
public sealed record PerfInsightEventDto(string Kind, string SessionId, string GameId, string Title, string Body);
