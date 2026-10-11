using System.Text.Json.Nodes;
using Vystral.Core.Contracts;
using Vystral.Core.Data;
using Vystral.Tests.Ai;
using Vystral.Tests.Support;
using Vystral.Windows.Ai.Assistant;
using Vystral.Windows.Ai.Extras;
using Xunit;

namespace Vystral.Tests.TrackE1;

/// <summary>Track E1: merge proposals, lag-note facts, game-summary facts and acceptance, learned prompts.</summary>
public sealed class AssistantExtrasTests
{
    // ---------------- Smart duplicate cleanup ----------------

    [Fact]
    public void Merge_proposals_keep_the_entry_with_your_history_and_list_the_versions_that_move()
    {
        var played = AiTestData.Game("Ashen Crown", platform: "steam", trackedSeconds: 9000, sessions: 4, release: "2023-05-01", developer: "Ninefold");
        var other = AiTestData.Game("Ashen Crown", platform: "epic", release: "2023-05-01", developer: "Ninefold");
        var snap = new LibrarySnapshotDto([other, played], [], [new DuplicateSuggestionDto(other.Id, played.Id, "")], null);
        var p = Assert.Single(DuplicateCleanup.Propose(snap, _ => null));
        Assert.Equal(played.Id, p.TargetGameId);
        Assert.Equal(other.Id, p.SourceGameId);
        Assert.Equal([other.Installations[0].Id], p.SourceInstallationIds);
        Assert.Contains("more of your play history", p.KeepReason);
        Assert.Equal("strong", p.Confidence); // identical titles on different stores, nothing against
        Assert.Contains("The titles are identical.", p.Explanation);
        Assert.DoesNotContain("But:", p.Explanation);
    }

    [Fact]
    public void Proposals_are_ordered_strongest_first_and_skip_hidden_missing_and_repeated_pairs()
    {
        var a1 = AiTestData.Game("Tidebreaker", platform: "steam", release: "2022-01-01");
        var a2 = AiTestData.Game("Tidebreaker Deluxe Edition", platform: "xbox", release: "2024-01-01");
        var b1 = AiTestData.Game("Nebula Drift", platform: "steam");
        var b2 = AiTestData.Game("Nebula Drift", platform: "gog");
        var hidden = AiTestData.Game("Last Signal", hidden: true);
        var c = AiTestData.Game("Last Signal", platform: "epic");
        var snap = new LibrarySnapshotDto([a1, a2, b1, b2, hidden, c], [],
        [
            new(a1.Id, a2.Id, ""), new(b1.Id, b2.Id, ""), new(b2.Id, b1.Id, ""), new(hidden.Id, c.Id, ""), new(c.Id, "f".PadLeft(32, 'f'), ""),
        ], null);
        var list = DuplicateCleanup.Propose(snap, _ => null);
        Assert.Equal(2, list.Count);
        Assert.Equal("Nebula Drift", list[0].TargetTitle);
        Assert.Equal("strong", list[0].Confidence);
        Assert.Equal("unsure", list[1].Confidence); // edition and year differ
        Assert.Contains("But:", list[1].Explanation);
    }

    [Fact]
    public void A_shared_steam_app_is_strong_and_ties_keep_the_entry_added_first()
    {
        var first = AiTestData.Game("Glasswing", platform: "steam") with { Added = "2024-01-01T00:00:00Z" };
        var second = AiTestData.Game("Glasswing: Prism Cut", platform: "epic") with { Added = "2025-01-01T00:00:00Z" };
        var snap = new LibrarySnapshotDto([second, first], [], [new(second.Id, first.Id, "")], null);
        var p = DuplicateCleanup.Propose(snap, _ => "620").Single();
        Assert.Equal(first.Id, p.TargetGameId);
        Assert.Equal("strong", p.Confidence);
        Assert.Contains("same Steam app (620)", p.Explanation);
    }

    // ---------------- Lag notes ----------------

    private static JsonObject Summary(double avg, double? low = null, int? stutters = null, double? cpu = null, int? throttled = null) => new()
    {
        ["fpsAvg"] = avg, ["fps1Low"] = low, ["stutterCount"] = stutters, ["cpuAvg"] = cpu, ["throttledSeconds"] = throttled, ["frameTimeP99Ms"] = 30,
    };

    [Fact]
    public void Rough_uses_the_performance_pages_rule()
    {
        Assert.True(LagNotes.IsRough(Summary(120, low: 50), 3600));        // lows under half the average
        Assert.False(LagNotes.IsRough(Summary(120, low: 70), 3600));       // uneven, not rough
        Assert.True(LagNotes.IsRough(Summary(120, low: 100, stutters: 90), 3600)); // 1.5 a minute
        Assert.False(LagNotes.IsRough(Summary(120, low: 100, stutters: 60), 3600)); // exactly 1 a minute
        Assert.False(LagNotes.IsRough(Summary(120, low: 100, stutters: 5), 30));    // too short to rate stutters
        Assert.True(LagNotes.IsRough(Summary(120, low: 100, cpu: 91), 3600));
        Assert.False(LagNotes.IsRough(new JsonObject { ["cpuAvg"] = 99 }, 3600)); // no frame-rate data: not measured
        Assert.False(LagNotes.IsRough(null, 3600));
    }

    private static JsonArray Insight(params (double T, double Ms)[] frames) =>
        new(frames.Select(f => (JsonNode)new JsonObject { ["t"] = f.T, ["frameTimeMs"] = f.Ms }).ToArray());

    private static JsonArray Samples(params (double T, double Cpu, double Gpu)[] s) =>
        new(s.Select(x => (JsonNode)new JsonObject { ["t"] = x.T, ["cpu"] = x.Cpu, ["gpu"] = x.Gpu }).ToArray());

    private static LagFacts Explain(JsonArray insight, JsonArray samples, int duration = 3600, JsonObject? summary = null, string[]? bg = null)
    {
        summary ??= Summary(90, low: 30, stutters: 120);
        var a = StutterAnalysis.Analyze(summary, samples, insight, duration);
        return LagNotes.Explain(a, summary, duration, bg ?? []);
    }

    private static (double, double)[] Steady(int from, int to) => Enumerable.Range(from, to - from).Select(t => ((double)t, 11.0)).ToArray();

    [Fact]
    public void The_cause_follows_the_strongest_evidence()
    {
        // CPU at 95% during spikes spread across the session.
        var frames = Steady(0, 1200).Select(f => f.Item1 is 300 or 640 or 1001 ? (f.Item1, 90.0) : f).ToArray();
        var cpu = Explain(Insight(frames), Samples((300, 95, 60), (640, 96, 62), (1001, 94, 55)));
        Assert.Equal("cpu", cpu.Cause);
        Assert.StartsWith("Likely the processor", cpu.Text);
        Assert.Contains("Arnav Games’ reading:", cpu.FactsText);

        // The GPU flat out.
        var gpu = Explain(Insight(frames), Samples((300, 40, 99), (640, 35, 98), (1001, 30, 99)));
        Assert.Equal("gpu", gpu.Cause);

        // Early spikes in a long session: shaders.
        var early = Steady(0, 1200).Select(f => f.Item1 is 20 or 60 or 100 ? (f.Item1, 95.0) : f).ToArray();
        Assert.Equal("shaders", Explain(Insight(early), Samples((20, 50, 50), (60, 52, 51), (100, 49, 52))).Cause);

        // The GPU idle at spikes (not early, not periodic).
        var idle = Steady(0, 1200).Select(f => f.Item1 is 300 or 700 or 1150 ? (f.Item1, 95.0) : f).ToArray();
        Assert.Equal("waiting", Explain(Insight(idle), Samples((300, 40, 30), (700, 42, 35), (1150, 45, 32))).Cause);

        // Evenly spaced spikes: a timer.
        var timer = Steady(0, 1200).Select(f => f.Item1 is 400 or 410 or 420 or 430 ? (f.Item1, 95.0) : f).ToArray();
        var t = Explain(Insight(timer), new JsonArray());
        Assert.Equal("timer", t.Cause);
        Assert.Contains("every 10 seconds", t.Text);
    }

    [Fact]
    public void Without_spike_data_it_falls_back_to_the_session_figures()
    {
        var hot = Explain(new JsonArray(), new JsonArray(), summary: Summary(90, low: 30, throttled: 300));
        Assert.Equal("heat", hot.Cause);
        Assert.Contains("5 min", hot.Text);
        var busy = Explain(new JsonArray(), new JsonArray(), summary: Summary(90, low: 80, cpu: 93));
        Assert.Equal("cpu", busy.Cause);
        Assert.Contains("93%", busy.Text);
        var bg = Explain(new JsonArray(), new JsonArray(), summary: Summary(90, low: 30), bg: ["Chrome"]);
        Assert.Equal("background", bg.Cause);
        Assert.Contains("Chrome", bg.Text);
        var plain = Explain(new JsonArray(), new JsonArray(), summary: Summary(90, low: 30));
        Assert.Equal("uneven", plain.Cause);
        Assert.Contains("30 fps", plain.Text);
        Assert.True(plain.Text.Length <= LagNotes.MaxChars);
    }

    [Fact]
    public void Ai_wording_must_stick_to_the_facts_and_never_claim_a_change()
    {
        const string facts = "- Average frame rate: 90 fps\n- 1% low: 30 fps\n- Arnav Games’ reading: Likely the processor.";
        Assert.Equal("Likely the processor: it was busy whenever frames dropped to 30 fps.", LagNotes.AcceptAi("\"Likely the processor: it was busy whenever frames dropped to 30 fps.\"", facts));
        Assert.Null(LagNotes.AcceptAi("Likely the processor, which hit 97% load.", facts)); // a number that isn't in the facts
        Assert.Null(LagNotes.AcceptAi("Likely the processor. I changed your power plan to fix it.", facts));
        Assert.Null(LagNotes.AcceptAi("Likely.", facts));
        Assert.Null(LagNotes.AcceptAi("Likely the processor.\nAlso the GPU.", facts));
        Assert.Null(LagNotes.AcceptAi(new string('x', 200), facts));
    }

    // ---------------- Game summaries ----------------

    [Fact]
    public void Summary_facts_come_from_the_library_igdb_rawg_and_steam_tags_with_their_sources()
    {
        var g = AiTestData.Game("Moss & Marrow", ["Adventure", "Indie"], developer: "Little Lichen", release: "2024-03-02") with { MetadataSource = "Steam" };
        var igdb = new EnrichmentRow("igdb", "1", "exact-title", 1, true,
            """{"genres":["Adventure"],"themes":["Fantasy"],"gameModes":["Single player"],"perspectives":["Third person"],"series":[]}""", null, DateTimeOffset.UtcNow);
        var rawg = new EnrichmentRow("rawg", "2", "exact-title", 1, true, """{"genres":["Indie","Platformer"]}""", null, DateTimeOffset.UtcNow);
        var unmatched = new EnrichmentRow("igdb", null, null, null, false, """{"genres":["Shooter"]}""", null, DateTimeOffset.UtcNow);
        var f = GameSummaries.Facts(g, [igdb, rawg, unmatched], ["Cozy", "Exploration"]);
        Assert.Equal(["Steam", "IGDB", "RAWG", "Steam community tags"], f.Sources);
        Assert.Contains("Themes (IGDB): Fantasy", f.Text);
        Assert.Contains("Released: 2024", f.Text);
        Assert.Contains("Steam community tags: Cozy, Exploration", f.Text);
        Assert.DoesNotContain("Shooter", f.Text);
        Assert.True(f.Count >= GameSummaries.MinFacts);
        Assert.Equal(f.Hash, GameSummaries.Facts(g, [igdb, rawg], ["Cozy", "Exploration"]).Hash);
        Assert.NotEqual(f.Hash, GameSummaries.Facts(g, [igdb, rawg], ["Cozy"]).Hash);

        var bare = GameSummaries.Facts(AiTestData.Game("Unknown Thing"), [], []);
        Assert.True(bare.Count < GameSummaries.MinFacts);
        Assert.Equal(["Your store app"], GameSummaries.Facts(AiTestData.Game("X", ["RPG"]), [], []).Sources);
    }

    [Fact]
    public void Summaries_are_two_short_lines_true_to_the_facts_and_never_official()
    {
        const string facts = "Title: Moss & Marrow\nGenres: Adventure, Indie\nReleased: 2024\nSteam community tags: Cozy, Exploration";
        Assert.Equal("A cozy indie adventure about exploring.\nCalm, unhurried play, released in 2024.",
            GameSummaries.Accept("- A cozy indie adventure about exploring.\n- Calm, unhurried play, released in 2024.", facts));
        Assert.Null(GameSummaries.Accept("A cozy indie adventure.\nCalm play.\nA third line.", facts));
        Assert.Null(GameSummaries.Accept("A cozy indie adventure with 40 hours of story.", facts));
        Assert.Null(GameSummaries.Accept("The official cozy indie adventure.", facts));
        Assert.Null(GameSummaries.Accept("I think it is a cozy indie adventure.", facts));
        Assert.Null(GameSummaries.Accept("See www.example.com for this cozy adventure.", facts));
        Assert.Null(GameSummaries.Accept("Short.", facts));
    }

    // ---------------- Learned prompts ----------------

    [Fact]
    public void Prompts_are_counted_per_page_cleaned_capped_and_erasable()
    {
        using var dir = new TempDir();
        var store = new PromptLearningStore(dir.Path);
        Assert.True(store.Record("game", "Is {game} good with a controller?"));
        Assert.True(store.Record("game", "is {game} good  with a controller?"));
        Assert.True(store.Record("library", "Show my unfinished RPGs"));
        Assert.False(store.Record("nowhere", "Show my unfinished RPGs"));
        Assert.False(store.Record("game", "hi"));
        Assert.False(store.Record("game", "Use {secret} here"));
        Assert.False(store.Record("game", "{game} vs {game}"));
        Assert.False(store.Record("game", "My password is hunter2"));
        var got = store.Get(true);
        var game = Assert.Single(got.Pages["game"]);
        Assert.Equal(2, game.Count);
        for (var i = 0; i < PromptLearningStore.PerPage + 5; i++) store.Record("journal", $"How much did I play in week {i}?");
        Assert.Equal(PromptLearningStore.PerPage, store.Get(true).Pages["journal"].Count);
        store.Clear();
        Assert.Empty(store.Get(true).Pages);
    }
}
