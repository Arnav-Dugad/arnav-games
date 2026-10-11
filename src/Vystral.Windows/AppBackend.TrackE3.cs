using Vystral.Core.Contracts;
using Vystral.Core.Data;
using Vystral.Core.Insights;
using Vystral.Windows.Bridge;
using Vystral.Windows.Launch;
using Vystral.Windows.Monitoring;
using Vystral.Windows.Services;
using static Vystral.Windows.Bridge.BridgeDispatcher;

namespace Vystral.Windows;

// Track E3 parameter records.
public sealed record PerfGoalParams(string GameId, int? TargetFps, bool? Display);

/// <summary>
/// Track E3 (performance insights): the power source and mode during sessions (read-only), frame-rate goals per game,
/// and two notes announced once when the session that caused them ends — a GPU running hotter than it used to in the
/// same game, and how a game ran on its first session after a GPU driver change. The page computes the rest
/// (goal shares from the frame-time histogram, battery against plugged in) from the same data. Nothing here changes a
/// hardware, power or driver setting.
/// </summary>
public sealed partial class AppBackend
{
    /// <summary>A thermal note for the same game is repeated at most this often.</summary>
    private static readonly TimeSpan ThermalNoticeEvery = TimeSpan.FromDays(30);

    private void RegisterTrackE3Handlers()
    {
        Sessions.PowerState = PowerProbe.Read;
        // Start listening for the effective power mode now, so the first session already knows it.
        _ = Task.Run(() =>
        {
            try { PowerProbe.Read(); }
            catch (Exception ex) { Log.Warn("power", "Power state unavailable", ex: ex); }
        });
        Sessions.StateChanged += OnSessionEndedPerfNotes;

        Dispatcher.Register("perfInsights.context", _ => Task.FromResult<object?>(PerfInsightContext()));

        Dispatcher.Register<PerfGoalParams>("perfInsights.setGoal", (p, _) =>
        {
            var gameId = RequireId(p.GameId, "game");
            var display = p.Display ?? false;
            if (display && p.TargetFps is not null) throw new BridgeException("invalid", "Choose a frame rate or the display's refresh rate, not both.");
            if (p.TargetFps is int t && (t < LibraryRepository.GoalMinFps || t > LibraryRepository.GoalMaxFps))
                throw new BridgeException("invalid", $"Goals go from {LibraryRepository.GoalMinFps} to {LibraryRepository.GoalMaxFps} fps.");
            if (!Repository.SetPerfGoal(gameId, p.TargetFps, display)) throw new BridgeException("notFound", "That game isn't in your library any more.");
            var goal = Repository.GetPerfGoals().FirstOrDefault(g => g.GameId == gameId);
            return Task.FromResult<object?>(goal is null ? null : new PerfGoalDto(goal.GameId, goal.TargetFps, goal.Display));
        });
    }

    private PerfInsightContextDto PerfInsightContext()
    {
        PowerReading? now = null;
        var hasBattery = false;
        try
        {
            now = PowerProbe.Read();
            hasBattery = PowerProbe.HasBattery();
        }
        catch (Exception ex) { Log.Warn("power", "Power state unavailable", ex: ex); }
        var sessions = Repository.GetPerfInsightSessions()
            .Where(s => s.Driver is not null || s.DisplayHz is not null || s.Power is not null)
            .Select(s => new PerfSessionExtraDto(s.SessionId, s.Driver, s.DisplayHz,
                s.Power is { } p ? new SessionPowerDto(p.AcSeconds, p.BatterySeconds, p.UnknownSeconds, p.SaverSeconds, p.Mode) : null))
            .ToList();
        var goals = Repository.GetPerfGoals().Select(g => new PerfGoalDto(g.GameId, g.TargetFps, g.Display)).ToList();
        return new PerfInsightContextDto(hasBattery, now?.OnBattery, sessions, goals);
    }

    private void OnSessionEndedPerfNotes(LaunchStateDto s)
    {
        if (s.Phase != "ended" || s.SessionId is not { } sessionId) return;
        var gameId = s.GameId;
        _ = Task.Run(() =>
        {
            try
            {
                foreach (var note in PerfNotesFor(sessionId, gameId, DateTimeOffset.UtcNow))
                    _events.Emit("perf.insight", note);
            }
            catch (Exception ex) { Log.Warn("perf", "Performance notes failed", ex: ex); }
        });
    }

    /// <summary>The notes the session just ended earned and that weren't announced before (each is claimed as it is returned).</summary>
    internal IReadOnlyList<PerfInsightEventDto> PerfNotesFor(string sessionId, string gameId, DateTimeOffset now)
    {
        var rows = Repository.GetPerfInsightSessions(gameId);
        if (!rows.Any(r => r.SessionId == sessionId)) return []; // discarded (too short) or not observed
        var sessions = rows.Select(ToTrendSession).ToList();
        var title = SafeGameTitle(gameId) ?? "this game";
        var notes = new List<PerfInsightEventDto>(2);

        if (PerfTrendRules.Thermal(sessions, gameId) is { } trend && PerfTrendRules.ThermalText(trend, title) is { } t &&
            sessions.Any(x => x.SessionId == sessionId && x.GpuTempAvgC is not null) &&
            Repository.TryClaimPerfNotice("thermal", gameId, now, ThermalNoticeEvery))
            notes.Add(new PerfInsightEventDto("thermal", sessionId, gameId, t.Title, t.Body));

        if (PerfTrendRules.DriverNoteFor(sessions, sessionId) is { } note &&
            Repository.TryClaimPerfNotice("driver", $"{gameId}:{note.Driver.ToLowerInvariant()}", now))
        {
            var d = PerfTrendRules.DriverText(note, title);
            notes.Add(new PerfInsightEventDto("driver", sessionId, gameId, d.Title, d.Body));
        }
        return notes;
    }

    internal static TrendSession ToTrendSession(PerfInsightSessionRow r)
    {
        var (temp, gpu, fps, low) = TrendSession.ParseSummary(r.PerfJson);
        return new TrendSession(r.SessionId, r.GameId, r.Start, r.DurationSeconds, temp, gpu, fps, low, r.Driver, SessionPower.Classify(r.Power));
    }
}
