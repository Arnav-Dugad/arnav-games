using System.Globalization;
using System.Text.Json;

namespace Vystral.Core.Insights;

// Track E3 (performance insights): power source per session, thermal trends and driver notes.
// The page computes the same figures in ui/src/views/perf/trends.ts (same constants, same rules); this copy
// exists so a note can be announced once, as a Windows notification, the moment the session that caused it ends.

// ======================================================================== power during a session

/// <summary>
/// One read of the PC's power state (read-only GetSystemPowerStatus and the effective power mode).
/// OnBattery null = Windows didn't say. Mode is one of <see cref="PowerModes.All"/>, or null when unknown.
/// </summary>
public sealed record PowerReading(bool? OnBattery, bool? Saver, int? BatteryPercent, string? Mode);

/// <summary>A stored power reading: the state from <c>TOffsetMs</c> until the next row (or the session end).</summary>
public sealed record SessionPowerRow(int TOffsetMs, bool? OnBattery, bool? Saver, int? BatteryPercent, string? Mode);

/// <summary>Seconds a session spent on each power source, and the effective power mode it spent most time in.</summary>
public sealed record SessionPowerSummary(int AcSeconds, int BatterySeconds, int UnknownSeconds, int SaverSeconds, string? Mode);

public static class PowerModes
{
    /// <summary>Windows' EFFECTIVE_POWER_MODE values 0–6, in order.</summary>
    public static readonly IReadOnlyList<string> All =
        ["batterySaver", "betterBattery", "balanced", "highPerformance", "maxPerformance", "gameMode", "mixedReality"];

    public static string? FromEffective(int value) => value >= 0 && value < All.Count ? All[value] : null;

    public static bool IsKnown(string? mode) => mode is not null && All.Contains(mode);
}

/// <summary>
/// Decides which power readings to keep: the first one of a session, then only when the source, battery saver or
/// power mode changes (the battery percentage alone never makes a row). At most <see cref="MaxRows"/> per session,
/// so a flapping charger can't grow the table.
/// </summary>
public sealed class PowerChangeTracker
{
    public const int MaxRows = 240;
    private PowerReading? _last;
    private int _rows;

    /// <summary>Starts from a session's stored rows (a handed-over session continues where it was).</summary>
    public PowerChangeTracker(IReadOnlyList<SessionPowerRow>? existing = null)
    {
        if (existing is { Count: > 0 })
        {
            var r = existing[^1];
            _last = new PowerReading(r.OnBattery, r.Saver, r.BatteryPercent, r.Mode);
            _rows = existing.Count;
        }
    }

    public bool ShouldStore(PowerReading reading)
    {
        if (_rows >= MaxRows) return false;
        var changed = _last is null || _last.OnBattery != reading.OnBattery || _last.Saver != reading.Saver ||
                      !string.Equals(_last.Mode, reading.Mode, StringComparison.Ordinal);
        if (!changed) return false;
        _last = reading;
        _rows++;
        return true;
    }
}

public static class SessionPower
{
    /// <summary>
    /// Time on each source from the stored change rows. Each row lasts until the next one; the last until
    /// <paramref name="endOffsetMs"/>. Rows past the end are ignored; null without any usable row.
    /// </summary>
    public static SessionPowerSummary? Summarize(IReadOnlyList<SessionPowerRow> rows, long endOffsetMs)
    {
        var ordered = rows.Where(r => r.TOffsetMs >= 0 && r.TOffsetMs <= endOffsetMs).OrderBy(r => r.TOffsetMs).ToList();
        if (ordered.Count == 0 || endOffsetMs <= 0) return null;
        double ac = 0, battery = 0, unknown = 0, saver = 0;
        var modes = new Dictionary<string, double>(StringComparer.Ordinal);
        for (var i = 0; i < ordered.Count; i++)
        {
            var r = ordered[i];
            // The first reading stands for the session from its start (it is taken as the session begins).
            var from = i == 0 ? 0 : r.TOffsetMs;
            var to = i + 1 < ordered.Count ? ordered[i + 1].TOffsetMs : endOffsetMs;
            var ms = Math.Max(0, to - from);
            if (r.OnBattery == true) battery += ms;
            else if (r.OnBattery == false) ac += ms;
            else unknown += ms;
            if (r.Saver == true) saver += ms;
            if (PowerModes.IsKnown(r.Mode)) modes[r.Mode!] = modes.GetValueOrDefault(r.Mode!) + ms;
        }
        static int S(double ms) => (int)Math.Round(ms / 1000);
        var mode = modes.Count == 0 ? null : modes.MaxBy(kv => kv.Value).Key;
        return new SessionPowerSummary(S(ac), S(battery), S(unknown), S(saver), mode);
    }

    /// <summary>"battery" when at least 90% of the known time was on battery, "ac" for 90% plugged in, else "mixed"; null when unknown.</summary>
    public static string? Classify(SessionPowerSummary? p)
    {
        if (p is null) return null;
        var known = p.AcSeconds + p.BatterySeconds;
        if (known <= 0) return null;
        if (p.BatterySeconds >= 0.9 * known) return "battery";
        if (p.AcSeconds >= 0.9 * known) return "ac";
        return "mixed";
    }
}

// ======================================================================== thermal trend and driver notes

/// <summary>A finished session as the trend rules see it. Null figures were not measured.</summary>
public sealed record TrendSession(
    string SessionId, string GameId, DateTimeOffset Start, int DurationSeconds,
    double? GpuTempAvgC, double? GpuAvg, double? FpsAvg, double? Fps1Low, string? Driver, string? PowerClass)
{
    /// <summary>Reads the few fields the rules need from perf_summary_json (camelCase). Malformed JSON gives nulls.</summary>
    public static (double? TempAvg, double? GpuAvg, double? FpsAvg, double? Fps1Low) ParseSummary(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return default;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return default;
            return (Num(r, "gpuTempAvgC"), Num(r, "gpuAvg"), Num(r, "fpsAvg"), Num(r, "fps1Low"));
        }
        catch (JsonException) { return default; }

        static double? Num(JsonElement o, string name) =>
            o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;
    }
}

/// <summary>"Your GPU runs 6 °C hotter than last month in this game": recent and earlier medians of session averages.</summary>
public sealed record ThermalTrend(
    string GameId, double RecentC, double EarlierC, double DeltaC, int RecentSessions, int EarlierSessions,
    double? RecentLoad, double? EarlierLoad, string Direction);

/// <summary>The first measured session of a game on a new GPU driver against the sessions before it.</summary>
public sealed record DriverNote(
    string GameId, string SessionId, string Driver, string PreviousDriver, DateTimeOffset At,
    double FpsAvg, double? Fps1Low, double BeforeAvg, double? BeforeLow, int BeforeSessions);

public static class PerfTrendRules
{
    /// <summary>Sessions shorter than this rarely reach a steady temperature and are left out of thermal trends.</summary>
    public const int ThermalMinSeconds = 600;
    /// <summary>"Recent" is the 30 days up to the newest qualifying session; "earlier" the 90 days before that.</summary>
    public const int RecentDays = 30;
    public const int EarlierDays = 90;
    /// <summary>Each side needs at least this many sessions.</summary>
    public const int ThermalMinSessions = 3;
    /// <summary>A difference of medians at or above this (°C) is worth telling.</summary>
    public const double ThermalAlertC = 5;
    /// <summary>Like with like: only sessions whose GPU load is within this many points of the game's median load.</summary>
    public const double LoadBand = 12;
    /// <summary>Sessions shorter than this are mostly menus and loading screens (same rule as the driver card).</summary>
    public const int DriverMinSeconds = 120;
    /// <summary>The "before" side of a driver note: the newest sessions of the game on the previous driver, at most this many.</summary>
    public const int DriverBeforeMax = 5;

    /// <summary>
    /// The thermal trend for one game, or null when there isn't enough like-for-like data. Uses sessions of at least
    /// ten minutes with a GPU temperature and GPU load, not mostly on battery, and within <see cref="LoadBand"/> points of
    /// the game's median GPU load. Ambient temperature is unknown, so the caller must say so.
    /// </summary>
    public static ThermalTrend? Thermal(IEnumerable<TrendSession> sessions, string gameId)
    {
        var usable = sessions.Where(s => s.GameId == gameId && s.DurationSeconds >= ThermalMinSeconds &&
                                         s.GpuTempAvgC is > 0 and < 130 && s.GpuAvg is >= 0 && s.PowerClass is not ("battery" or "mixed"))
            .OrderBy(s => s.Start).ToList();
        if (usable.Count < ThermalMinSessions * 2) return null;
        var anchor = usable[^1].Start;
        var recentFrom = anchor.AddDays(-RecentDays);
        var earlierFrom = recentFrom.AddDays(-EarlierDays);
        var window = usable.Where(s => s.Start > earlierFrom).ToList();
        var load = Median(window.Select(s => s.GpuAvg));
        if (load is null) return null;
        var like = window.Where(s => Math.Abs(s.GpuAvg!.Value - load.Value) <= LoadBand).ToList();
        var recent = like.Where(s => s.Start > recentFrom).ToList();
        var earlier = like.Where(s => s.Start <= recentFrom).ToList();
        if (recent.Count < ThermalMinSessions || earlier.Count < ThermalMinSessions) return null;
        var r = Median(recent.Select(s => s.GpuTempAvgC))!.Value;
        var e = Median(earlier.Select(s => s.GpuTempAvgC))!.Value;
        var delta = Math.Round(r - e, 1);
        var direction = delta >= ThermalAlertC ? "hotter" : delta <= -ThermalAlertC ? "cooler" : "steady";
        return new ThermalTrend(gameId, r, e, delta, recent.Count, earlier.Count,
            Median(recent.Select(s => s.GpuAvg)), Median(earlier.Select(s => s.GpuAvg)), direction);
    }

    /// <summary>
    /// The driver note for <paramref name="sessionId"/>, or null when it isn't the first measured session of its game on
    /// a driver that differs from the game's previous measured session.
    /// </summary>
    public static DriverNote? DriverNoteFor(IEnumerable<TrendSession> sessions, string sessionId)
    {
        var all = sessions.ToList();
        var target = all.FirstOrDefault(s => s.SessionId == sessionId);
        if (target is null) return null;
        return DriverNotes(all.Where(s => s.GameId == target.GameId)).FirstOrDefault(n => n.SessionId == sessionId);
    }

    /// <summary>Every driver note for the given sessions, newest first.</summary>
    public static IReadOnlyList<DriverNote> DriverNotes(IEnumerable<TrendSession> sessions)
    {
        var notes = new List<DriverNote>();
        foreach (var game in sessions.Where(Measured).GroupBy(s => s.GameId, StringComparer.Ordinal))
        {
            var list = game.OrderBy(s => s.Start).ToList();
            for (var i = 1; i < list.Count; i++)
            {
                var cur = list[i];
                var prevDriver = list[i - 1].Driver!;
                if (string.Equals(cur.Driver, prevDriver, StringComparison.OrdinalIgnoreCase)) continue;
                // Only the first session on a driver: a game going back to an older driver is a change too.
                var before = list.Take(i).Reverse().TakeWhile(s => string.Equals(s.Driver, prevDriver, StringComparison.OrdinalIgnoreCase))
                    .Take(DriverBeforeMax).ToList();
                notes.Add(new DriverNote(cur.GameId, cur.SessionId, cur.Driver!, prevDriver, cur.Start, cur.FpsAvg!.Value, cur.Fps1Low,
                    Median(before.Select(s => s.FpsAvg))!.Value, Median(before.Select(s => s.Fps1Low)), before.Count));
            }
        }
        return notes.OrderByDescending(n => n.At).ToList();
    }

    /// <summary>Sessions a driver note may use: a known driver and frame rate, long enough, and not on battery (a laptop on battery runs slower anyway).</summary>
    private static bool Measured(TrendSession s) =>
        !string.IsNullOrWhiteSpace(s.Driver) && s.FpsAvg is > 0 && s.DurationSeconds >= DriverMinSeconds && s.PowerClass is not ("battery" or "mixed");

    /// <summary>"Your GPU ran 6 °C hotter in Forza Horizon 4 than the month before" — notification text, or null for no alert.</summary>
    public static (string Title, string Body)? ThermalText(ThermalTrend t, string gameTitle)
    {
        if (t.Direction != "hotter") return null;
        var d = Math.Round(t.DeltaC);
        return ($"Your GPU runs {d.ToString(CultureInfo.InvariantCulture)} °C hotter in {gameTitle}",
            $"Typical {Math.Round(t.RecentC).ToString(CultureInfo.InvariantCulture)} °C over the last month, up from {Math.Round(t.EarlierC).ToString(CultureInfo.InvariantCulture)} °C, at a similar load. " +
            "A warm room can do this too. Cleaning the vents or raising a laptop can help.");
    }

    /// <summary>Title "Driver 617.42: Forza Horizon 4 +2 fps average, 1% lows −3 fps" and a body that says what it was compared with.</summary>
    public static (string Title, string Body) DriverText(DriverNote n, string gameTitle)
    {
        var title = $"Driver {n.Driver}: {gameTitle} {Signed(n.FpsAvg - n.BeforeAvg)} fps average";
        if (n.Fps1Low is double low && n.BeforeLow is double bl) title += $", 1% lows {Signed(low - bl)} fps";
        var before = n.BeforeSessions == 1 ? "your last session" : $"the median of your last {n.BeforeSessions} sessions";
        return (title, $"Your first session on the new driver, against {before} on {n.PreviousDriver}. One session can be noise, and settings or game updates move these numbers too.");
    }

    /// <summary>"+2", "−3" (a real minus sign), "±0".</summary>
    public static string Signed(double v)
    {
        var r = (int)Math.Round(v, MidpointRounding.AwayFromZero);
        return r > 0 ? $"+{r}" : r < 0 ? $"−{-r}" : "±0";
    }

    public static double? Median(IEnumerable<double?> values)
    {
        var v = values.Where(x => x is double d && double.IsFinite(d)).Select(x => x!.Value).Order().ToList();
        if (v.Count == 0) return null;
        var m = v.Count / 2;
        return v.Count % 2 == 1 ? v[m] : (v[m - 1] + v[m]) / 2;
    }
}
