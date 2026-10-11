using System.Text.Json;
using Dapper;
using Vystral.Core.Data;
using Vystral.Core.Domain;
using Vystral.Core.Insights;
using Vystral.Tests.Support;
using Vystral.Windows.Monitoring;
using Vystral.Windows.Services;
using Xunit;

namespace Vystral.Tests.TrackE3;

/// <summary>Track E3: power sampling, migration 11, frame-rate goals, notes shown once, thermal trends and driver notes.</summary>
public sealed class PowerSamplingTests
{
    [Theory]
    // AC line, battery flag, percent, saver flag → on battery, saver, percent
    [InlineData((byte)1, (byte)8, (byte)87, (byte)0, false, false, 87)]       // laptop charging
    [InlineData((byte)0, (byte)1, (byte)64, (byte)0, true, false, 64)]        // laptop on battery
    [InlineData((byte)0, (byte)2, (byte)18, (byte)1, true, true, 18)]         // low battery, battery saver on
    [InlineData((byte)1, (byte)128, (byte)255, (byte)0, false, false, null)]  // desktop: no system battery
    public void System_power_status_is_interpreted(byte ac, byte flag, byte pct, byte saverFlag, bool? onBattery, bool? saver, int? percent)
    {
        var r = PowerProbe.Interpret(ac, flag, pct, saverFlag, effectiveMode: null);
        Assert.Equal(onBattery, r.OnBattery);
        Assert.Equal(saver, r.Saver);
        Assert.Equal(percent, r.BatteryPercent);
        Assert.Null(r.Mode);
    }

    [Fact]
    public void Unknown_values_stay_unknown()
    {
        var laptop = PowerProbe.Interpret(255, 8, 255, 255, null);
        Assert.Null(laptop.OnBattery);   // a battery exists but the line status is unknown
        Assert.Null(laptop.Saver);
        Assert.Null(laptop.BatteryPercent);
        var desktop = PowerProbe.Interpret(255, 128, 255, 0, null);
        Assert.False(desktop.OnBattery); // no battery: it can only be on mains power
        Assert.True(PowerProbe.HasBattery(8));
        Assert.False(PowerProbe.HasBattery(128));
        Assert.False(PowerProbe.HasBattery(255));
    }

    [Theory]
    [InlineData(0, "batterySaver")]
    [InlineData(2, "balanced")]
    [InlineData(4, "maxPerformance")]
    [InlineData(5, "gameMode")]
    [InlineData(7, null)]
    [InlineData(-1, null)]
    public void Effective_power_modes_have_names(int value, string? name)
    {
        Assert.Equal(name, PowerModes.FromEffective(value));
        Assert.Equal(name, PowerProbe.Interpret(1, 8, 50, 0, value).Mode);
    }

    [Fact]
    public void Readings_are_stored_at_the_start_and_on_change_only()
    {
        var t = new PowerChangeTracker();
        var plugged = new PowerReading(false, false, 80, "balanced");
        Assert.True(t.ShouldStore(plugged));                                  // session start
        Assert.False(t.ShouldStore(plugged with { BatteryPercent = 81 }));    // charge alone is not a change
        Assert.True(t.ShouldStore(plugged with { OnBattery = true }));        // unplugged
        Assert.False(t.ShouldStore(new PowerReading(true, false, 70, "balanced")));
        Assert.True(t.ShouldStore(new PowerReading(true, true, 19, "balanced")));       // battery saver came on
        Assert.True(t.ShouldStore(new PowerReading(true, true, 19, "batterySaver")));   // and the mode followed
    }

    [Fact]
    public void A_flapping_charger_cannot_grow_the_table_without_bound()
    {
        var t = new PowerChangeTracker();
        var stored = 0;
        for (var i = 0; i < 1000; i++)
            if (t.ShouldStore(new PowerReading(i % 2 == 0, false, 50, null))) stored++;
        Assert.Equal(PowerChangeTracker.MaxRows, stored);
    }

    [Fact]
    public void A_handed_over_session_continues_from_its_stored_rows()
    {
        var t = new PowerChangeTracker([new SessionPowerRow(0, false, false, 90, "balanced"), new SessionPowerRow(60_000, true, false, 88, "balanced")]);
        Assert.False(t.ShouldStore(new PowerReading(true, false, 80, "balanced"))); // same as the last stored row
        Assert.True(t.ShouldStore(new PowerReading(false, false, 80, "balanced")));
    }

    [Fact]
    public void Time_on_each_source_is_summed_from_the_change_rows()
    {
        // Plugged in for the first 10 minutes (the first reading counts from the start), then 50 minutes on battery,
        // the last 20 of them with battery saver on.
        var rows = new[]
        {
            new SessionPowerRow(1800, false, false, 100, "maxPerformance"),
            new SessionPowerRow(600_000, true, false, 97, "balanced"),
            new SessionPowerRow(2_400_000, true, true, 20, "batterySaver"),
        };
        var s = SessionPower.Summarize(rows, 3_600_000)!;
        Assert.Equal(600, s.AcSeconds);
        Assert.Equal(3000, s.BatterySeconds);
        Assert.Equal(0, s.UnknownSeconds);
        Assert.Equal(1200, s.SaverSeconds);
        Assert.Equal("balanced", s.Mode); // 30 minutes, the longest
        Assert.Equal("battery", SessionPower.Classify(new SessionPowerSummary(100, 3500, 0, 0, null)));
        Assert.Equal("ac", SessionPower.Classify(new SessionPowerSummary(3500, 100, 0, 0, null)));
        Assert.Equal("mixed", SessionPower.Classify(s));
        Assert.Null(SessionPower.Classify(new SessionPowerSummary(0, 0, 3600, 0, null)));
        Assert.Null(SessionPower.Summarize([], 1000));
    }
}

public sealed class PerfInsightsRepositoryTests : IDisposable
{
    private readonly TestDb _t = new();
    private static readonly DateTimeOffset T0 = new(2026, 6, 1, 18, 0, 0, TimeSpan.Zero);

    public void Dispose() => _t.Dispose();

    private (string GameId, string InstallationId) Game(string appId, string title)
    {
        _t.Repo.ApplyScan([TestDb.Ok(PlatformId.Steam, TestDb.Install(PlatformId.Steam, appId, title, steamAppId: appId))]);
        var inst = _t.Repo.GetInstallationsByPlatformId(PlatformId.Steam, appId)!;
        return (inst.GameId, inst.Id);
    }

    private string Session(string gameId, string instId, DateTimeOffset start, int seconds, string? perf = null)
    {
        var id = _t.Repo.StartSession(gameId, instId, start);
        _t.Repo.EndSession(id, start.AddSeconds(seconds), seconds, perf);
        return id;
    }

    [Fact]
    public void Migration_11_upgrades_a_version_10_database_and_keeps_its_sessions()
    {
        using var dir = new TempDir();
        var db = new Database(Path.Combine(dir.Path, "v10.db"));
        using (var conn = db.Open())
        {
            conn.Execute("CREATE TABLE schema_version (version INTEGER NOT NULL, applied TEXT NOT NULL, name TEXT NOT NULL);");
            foreach (var (version, name, sql) in Migrations.All.Where(m => m.Version <= 10))
            {
                conn.Execute(sql);
                conn.Execute("INSERT INTO schema_version VALUES (@version, '2026-01-01', @name)", new { version, name });
            }
            conn.Execute("INSERT INTO games(id, title, sort_title, added, updated) VALUES ('g1', 'Game', 'game', '2026-01-01', '2026-01-01')");
            conn.Execute("INSERT INTO sessions(id, game_id, start, end, duration_seconds, source, gpu_driver) VALUES ('s1', 'g1', '2026-01-02T10:00:00.0000000+00:00', '2026-01-02T11:00:00.0000000+00:00', 3600, 'tracked', '572.16')");
        }

        Assert.Equal(10, db.Migrate());
        Assert.Equal(11, db.SchemaVersion());
        var repo = new LibraryRepository(db);
        var row = Assert.Single(repo.GetPerfInsightSessions());
        Assert.Equal(("s1", "572.16", 3600), (row.SessionId, row.Driver, row.DurationSeconds));
        Assert.Null(row.Power); // older sessions have no power rows
        Assert.Empty(repo.GetPerfGoals());
        TestDb.ReleasePool(db);
    }

    [Fact]
    public void Power_rows_are_summarised_per_session_and_deleted_with_it()
    {
        var (g, i) = Game("1293830", "Forza Horizon 4");
        var a = Session(g, i, T0, 3600);
        _t.Repo.AddSessionPower(a, 2000, new PowerReading(false, false, 100, "balanced"));
        _t.Repo.AddSessionPower(a, 1_200_000, new PowerReading(true, false, 99, "nonsense"));
        _t.Repo.AddSessionPower("0123456789abcdef0123456789abcdef", 0, new PowerReading(true, null, null, null)); // no such session: ignored

        var rows = _t.Repo.GetSessionPower(a);
        Assert.Equal(2, rows.Count);
        Assert.Null(rows[1].Mode); // unknown mode names are never stored
        var s = Assert.Single(_t.Repo.GetPerfInsightSessions(g));
        Assert.Equal(new SessionPowerSummary(1200, 2400, 0, 0, "balanced"), s.Power);

        Assert.True(_t.Repo.DeleteSession(a));
        using var conn = _t.Db.Open();
        Assert.Equal(0, conn.ExecuteScalar<long>("SELECT COUNT(*) FROM session_power"));
    }

    [Fact]
    public void Goals_are_stored_per_game_validated_and_cleared()
    {
        var (g, _) = Game("620", "Portal 2");
        var (h, _) = Game("1091500", "Cyberpunk 2077");
        Assert.True(_t.Repo.SetPerfGoal(g, 60, display: false));
        Assert.True(_t.Repo.SetPerfGoal(h, 144, display: false));
        Assert.True(_t.Repo.SetPerfGoal(h, null, display: true)); // switch to the display's refresh rate
        Assert.Equal(new[] { new PerfGoalRow(g, 60, false), new PerfGoalRow(h, null, true) }, _t.Repo.GetPerfGoals().OrderBy(x => x.GameId == h).ToList());
        Assert.Throws<ArgumentOutOfRangeException>(() => _t.Repo.SetPerfGoal(g, 1000, false));
        Assert.Throws<ArgumentOutOfRangeException>(() => _t.Repo.SetPerfGoal(g, 5, false));
        Assert.False(_t.Repo.SetPerfGoal("0123456789abcdef0123456789abcdef", 60, false));
        Assert.True(_t.Repo.SetPerfGoal(g, null, false));
        Assert.Equal(new[] { h }, _t.Repo.GetPerfGoals().Select(x => x.GameId));
    }

    [Fact]
    public void A_goal_follows_a_merge()
    {
        var (g, _) = Game("620", "Portal 2");
        var (h, _) = Game("400", "Portal");
        _t.Repo.SetPerfGoal(h, 120, false);
        Assert.True(_t.Repo.MergeGames(g, h));
        Assert.Equal(new[] { new PerfGoalRow(g, 120, false) }, _t.Repo.GetPerfGoals());
    }

    [Fact]
    public void A_notice_is_claimed_once_and_a_repeating_one_only_after_its_interval()
    {
        Assert.True(_t.Repo.TryClaimPerfNotice("driver", "g:572.16", T0));
        Assert.False(_t.Repo.TryClaimPerfNotice("driver", "g:572.16", T0.AddDays(400)));
        Assert.True(_t.Repo.TryClaimPerfNotice("thermal", "g", T0, TimeSpan.FromDays(30)));
        Assert.False(_t.Repo.TryClaimPerfNotice("thermal", "g", T0.AddDays(10), TimeSpan.FromDays(30)));
        Assert.True(_t.Repo.TryClaimPerfNotice("thermal", "g", T0.AddDays(31), TimeSpan.FromDays(30)));
        Assert.False(_t.Repo.TryClaimPerfNotice("thermal", "g", T0.AddDays(32), TimeSpan.FromDays(30)));
    }
}

public sealed class PerfTrendRuleTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 30, 20, 0, 0, TimeSpan.Zero);
    private const string G = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    private static TrendSession S(int daysAgo, double? temp, double? gpu = 95, int seconds = 3600, string? power = "ac", string? driver = "572.16",
        double? fps = 60, double? low = 40, string game = G) =>
        new($"s{daysAgo:000}{game[..4]}", game, Now.AddDays(-daysAgo), seconds, temp, gpu, fps, low, driver, power);

    [Fact]
    public void A_hotter_month_is_found_with_medians_of_like_for_like_sessions()
    {
        var sessions = new[]
        {
            S(70, 66), S(60, 68), S(50, 67), S(45, 90, gpu: 40), // earlier; the 90 °C one ran at a very different load
            S(20, 74), S(10, 73), S(2, 75), S(1, 60, seconds: 300), // recent; the 5-minute one is too short to count
        };
        var t = PerfTrendRules.Thermal(sessions, G)!;
        Assert.Equal(74, t.RecentC);
        Assert.Equal(67, t.EarlierC);
        Assert.Equal(7, t.DeltaC);
        Assert.Equal((3, 3), (t.RecentSessions, t.EarlierSessions));
        Assert.Equal("hotter", t.Direction);
        var (title, body) = PerfTrendRules.ThermalText(t, "Forza Horizon 4")!.Value;
        Assert.Equal("Your GPU runs 7 °C hotter in Forza Horizon 4", title);
        Assert.Contains("warm room", body);
        Assert.DoesNotContain("fan", body, StringComparison.OrdinalIgnoreCase); // never suggests changing hardware settings
    }

    [Fact]
    public void Too_few_sessions_battery_sessions_or_a_small_change_give_no_alert()
    {
        Assert.Null(PerfTrendRules.Thermal([S(60, 66), S(50, 67), S(20, 74), S(10, 75), S(2, 76)], G)); // only two earlier
        // Battery sessions run cooler; they're never compared with plugged-in ones.
        Assert.Null(PerfTrendRules.Thermal([S(60, 60, power: "battery"), S(55, 60, power: "battery"), S(50, 61, power: "battery"), S(20, 74), S(10, 75), S(2, 76)], G));
        var steady = PerfTrendRules.Thermal([S(60, 70), S(50, 71), S(40, 69), S(20, 72), S(10, 73), S(2, 72)], G)!;
        Assert.Equal("steady", steady.Direction);
        Assert.Null(PerfTrendRules.ThermalText(steady, "x"));
        Assert.Null(PerfTrendRules.Thermal([S(60, null), S(50, null), S(40, null), S(20, null), S(10, null), S(2, null)], G)); // no temperature (non-NVIDIA)
    }

    [Fact]
    public void Driver_notes_compare_the_first_session_on_a_new_driver_with_the_median_before()
    {
        var sessions = new[]
        {
            S(30, null, fps: 70, low: 50, driver: "572.16"),
            S(20, null, fps: 72, low: 48, driver: "572.16"),
            S(10, null, fps: 74, low: 52, driver: "572.16"),
            S(5, null, fps: 74, low: 47, driver: "617.42"),   // first on the new driver
            S(3, null, fps: 80, low: 49, driver: "617.42"),   // second: no new note
            S(4, null, fps: 30, low: 10, driver: "617.42", seconds: 60), // too short to count
        };
        var note = Assert.Single(PerfTrendRules.DriverNotes(sessions));
        Assert.Equal(("617.42", "572.16", 72.0, 50.0, 3), (note.Driver, note.PreviousDriver, note.BeforeAvg, note.BeforeLow, note.BeforeSessions));
        Assert.Equal(sessions[3].SessionId, note.SessionId);
        Assert.Equal(note, PerfTrendRules.DriverNoteFor(sessions, sessions[3].SessionId));
        Assert.Null(PerfTrendRules.DriverNoteFor(sessions, sessions[4].SessionId));
        var (title, body) = PerfTrendRules.DriverText(note, "Forza Horizon 4");
        Assert.Equal("Driver 617.42: Forza Horizon 4 +2 fps average, 1% lows −3 fps", title);
        Assert.Contains("the median of your last 3 sessions on 572.16", body);
    }

    [Fact]
    public void Driver_notes_need_frame_rate_on_both_sides()
    {
        var sessions = new[] { S(10, null, fps: null, driver: "572.16"), S(5, null, fps: 70, driver: "617.42") };
        Assert.Empty(PerfTrendRules.DriverNotes(sessions));
        Assert.Equal("±0", PerfTrendRules.Signed(0.4));
        Assert.Equal("−1", PerfTrendRules.Signed(-0.5));
    }

    [Fact]
    public void The_summary_fields_are_read_from_the_stored_json()
    {
        var json = """{"samples":10,"gpuTempAvgC":71.5,"gpuAvg":96.1,"fpsAvg":58.3,"fps1Low":22.4,"fpsStatus":"x"}""";
        Assert.Equal(((double?)71.5, (double?)96.1, (double?)58.3, (double?)22.4), TrendSession.ParseSummary(json));
        Assert.Equal(default, TrendSession.ParseSummary("{not json"));
        Assert.Equal(default, TrendSession.ParseSummary("""{"gpuTempAvgC":"hot"}"""));
    }
}

public sealed class PerfInsightNotificationTests
{
    private const string Sid = "0123456789abcdef0123456789abcdef";

    private static NotificationPolicy Policy(bool on = true) =>
        new(k => k switch { NotificationPolicy.Enabled => true, NotificationPolicy.PerfInsights => on, _ => false }, _ => null);

    private static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    [Fact]
    public void A_perf_note_becomes_one_notification_that_opens_the_session()
    {
        var p = Policy();
        var payload = J(new { kind = "driver", sessionId = Sid, gameId = Sid, title = "Driver 617.42: Forza Horizon 4 +2 fps average", body = "Your first session…" });
        var n = Assert.Single(p.Evaluate("perf.insight", payload, foreground: false));
        Assert.Equal("Driver 617.42: Forza Horizon 4 +2 fps average", n.Title);
        Assert.Contains("\"sessionId\":\"" + Sid + "\"", n.RouteJson);
        Assert.Empty(p.Evaluate("perf.insight", payload, foreground: false)); // once
    }

    [Fact]
    public void The_setting_and_malformed_payloads_are_respected()
    {
        Assert.Empty(Policy(on: false).Evaluate("perf.insight", J(new { kind = "thermal", sessionId = Sid, title = "t", body = "b" }), false));
        Assert.Empty(Policy().Evaluate("perf.insight", J(new { kind = "launch", sessionId = Sid, title = "t", body = "b" }), false));
        Assert.Empty(Policy().Evaluate("perf.insight", J(new { kind = "thermal", sessionId = "../x", title = "t", body = "b" }), false));
        Assert.Empty(Policy().Evaluate("perf.insight", J(new { kind = "thermal", sessionId = Sid, title = "\u0007", body = "b" }), false));
    }
}
