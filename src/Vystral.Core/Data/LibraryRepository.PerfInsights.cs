using System.Globalization;
using Dapper;
using Vystral.Core.Insights;

namespace Vystral.Core.Data;

/// <summary>A finished observed session with what the performance insights need beyond its summary.</summary>
public sealed record PerfInsightSessionRow(
    string SessionId, string GameId, DateTimeOffset Start, int DurationSeconds, string? PerfJson, string? Driver, int? DisplayHz,
    SessionPowerSummary? Power);

/// <summary>A game's frame-rate goal: a fixed target, or the display's refresh rate.</summary>
public sealed record PerfGoalRow(string GameId, int? TargetFps, bool Display);

/// <summary>
/// Track E3 (schema v11): the power state during sessions, frame-rate goals per game, and performance notes that
/// were already announced.
/// </summary>
public sealed partial class LibraryRepository
{
    public const int GoalMinFps = 20;
    public const int GoalMaxFps = 360;

    // ---------- Power during a session ----------

    public void AddSessionPower(string sessionId, int tOffsetMs, PowerReading r)
    {
        using var conn = db.Open();
        conn.Execute("""
            INSERT OR REPLACE INTO session_power(session_id, t_offset_ms, on_battery, saver, battery_pct, mode)
            SELECT @sessionId, @t, @onBattery, @saver, @pct, @mode WHERE EXISTS (SELECT 1 FROM sessions WHERE id=@sessionId)
            """, new
        {
            sessionId, t = Math.Max(0, tOffsetMs),
            onBattery = Bit(r.OnBattery), saver = Bit(r.Saver),
            pct = r.BatteryPercent is >= 0 and <= 100 ? r.BatteryPercent : null,
            mode = PowerModes.IsKnown(r.Mode) ? r.Mode : null,
        });
    }

    public IReadOnlyList<SessionPowerRow> GetSessionPower(string sessionId)
    {
        using var conn = db.Open();
        return conn.Query<(long T, long? Bat, long? Saver, long? Pct, string? Mode)>(
                "SELECT t_offset_ms, on_battery, saver, battery_pct, mode FROM session_power WHERE session_id=@sessionId ORDER BY t_offset_ms", new { sessionId })
            .Select(Row).ToList();
    }

    /// <summary>Finished observed sessions (optionally one game's) with driver, display refresh and power summary, oldest first.</summary>
    public IReadOnlyList<PerfInsightSessionRow> GetPerfInsightSessions(string? gameId = null)
    {
        using var conn = db.Open();
        var sessions = conn.Query<(string Id, string GameId, string Start, int Duration, string? Perf, string? Driver, long? Hz)>($"""
                SELECT id, game_id, start, duration_seconds, perf_summary_json, gpu_driver, display_hz
                FROM sessions WHERE {ObservedFinished} AND (@gameId IS NULL OR game_id=@gameId)
                ORDER BY start
                """, new { gameId }).ToList();
        var power = conn.Query<(string Sid, long T, long? Bat, long? Saver, long? Pct, string? Mode)>("""
                SELECT p.session_id, p.t_offset_ms, p.on_battery, p.saver, p.battery_pct, p.mode
                FROM session_power p JOIN sessions s ON s.id = p.session_id
                WHERE s.end IS NOT NULL AND (@gameId IS NULL OR s.game_id=@gameId)
                ORDER BY p.session_id, p.t_offset_ms
                """, new { gameId })
            .GroupBy(r => r.Sid, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Select(r => Row((r.T, r.Bat, r.Saver, r.Pct, r.Mode))).ToList(), StringComparer.Ordinal);
        return sessions
            .Where(r => DateTimeOffset.TryParse(r.Start, CultureInfo.InvariantCulture, out _))
            .Select(r => new PerfInsightSessionRow(r.Id, r.GameId, DateTimeOffset.Parse(r.Start, CultureInfo.InvariantCulture), r.Duration, r.Perf,
                r.Driver, r.Hz is > 0 and <= 1000 ? (int)r.Hz : null,
                power.TryGetValue(r.Id, out var rows) ? SessionPower.Summarize(rows, Math.Max(1, r.Duration) * 1000L) : null))
            .ToList();
    }

    // ---------- Frame-rate goals ----------

    public IReadOnlyList<PerfGoalRow> GetPerfGoals()
    {
        using var conn = db.Open();
        return conn.Query<(string GameId, long? Target, long Display)>(
                "SELECT game_id, target_fps, display FROM game_perf_goals g WHERE EXISTS (SELECT 1 FROM games WHERE id = g.game_id) ORDER BY game_id")
            .Select(r => new PerfGoalRow(r.GameId, r.Display == 1 ? null : (int?)r.Target, r.Display == 1))
            .Where(r => r.Display || r.TargetFps is >= GoalMinFps and <= GoalMaxFps)
            .ToList();
    }

    /// <summary>Sets (or with neither a target nor display, clears) a game's goal. False when the game doesn't exist.</summary>
    public bool SetPerfGoal(string gameId, int? targetFps, bool display)
    {
        if (targetFps is not null && (targetFps < GoalMinFps || targetFps > GoalMaxFps))
            throw new ArgumentOutOfRangeException(nameof(targetFps));
        using var conn = db.Open();
        if (conn.ExecuteScalar<int>("SELECT COUNT(*) FROM games WHERE id=@gameId", new { gameId }) != 1) return false;
        if (!display && targetFps is null)
        {
            conn.Execute("DELETE FROM game_perf_goals WHERE game_id=@gameId", new { gameId });
            return true;
        }
        conn.Execute("""
            INSERT INTO game_perf_goals(game_id, target_fps, display, updated) VALUES (@gameId, @target, @display, @now)
            ON CONFLICT(game_id) DO UPDATE SET target_fps=excluded.target_fps, display=excluded.display, updated=excluded.updated
            """, new { gameId, target = display ? null : targetFps, display = display ? 1 : 0, now = Now() });
        return true;
    }

    // ---------- Notes shown once ----------

    /// <summary>
    /// Claims a note so it is announced once: true when it was never shown, or (with <paramref name="again"/>) was last
    /// shown before that long ago. Atomic, so two processes can't both announce it.
    /// </summary>
    public bool TryClaimPerfNotice(string kind, string key, DateTimeOffset now, TimeSpan? again = null)
    {
        if (kind.Length is 0 or > 16 || key.Length is 0 or > 160) return false;
        using var conn = db.Open();
        var cutoff = again is { } a ? (now - a).ToString("O", CultureInfo.InvariantCulture) : "";
        return conn.Execute("""
            INSERT INTO perf_notices(kind, key, shown) VALUES (@kind, @key, @now)
            ON CONFLICT(kind, key) DO UPDATE SET shown=excluded.shown WHERE perf_notices.shown < @cutoff
            """, new { kind, key, now = now.ToString("O", CultureInfo.InvariantCulture), cutoff }) == 1;
    }

    private static int? Bit(bool? b) => b is null ? null : b.Value ? 1 : 0;

    private static SessionPowerRow Row((long T, long? Bat, long? Saver, long? Pct, string? Mode) r) =>
        new((int)Math.Clamp(r.T, 0, int.MaxValue), r.Bat is null ? null : r.Bat == 1, r.Saver is null ? null : r.Saver == 1,
            r.Pct is >= 0 and <= 100 ? (int)r.Pct : null, PowerModes.IsKnown(r.Mode) ? r.Mode : null);
}
