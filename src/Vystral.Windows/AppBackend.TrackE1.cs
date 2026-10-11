using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Vystral.Core.Contracts;
using Vystral.Windows.Ai;
using Vystral.Windows.Ai.Assistant;
using Vystral.Windows.Ai.Extras;
using Vystral.Windows.Bridge;
using Vystral.Windows.Launch;
using Vystral.Windows.Services;
using static Vystral.Windows.Bridge.BridgeDispatcher;

namespace Vystral.Windows;

// Track E1 parameter records.
public sealed record MemoryAddParams(string Text, string? Origin);
public sealed record MemoryUpdateParams(string Id, string Text);
public sealed record MemoryIdParams(string Id);
public sealed record VoiceSessionParams(string SessionId);
public sealed record VoiceSettingsParams(string Target);
public sealed record RecapWeekParams(string? Week);
public sealed record GameSummaryParams(string GameId, bool? Refresh, bool? Ask);
public sealed record LagNoteParams(string SessionId, bool? Refresh);
public sealed record PromptRecordParams(string Page, string Text);

/// <summary>
/// Track E1: Assistant upgrades and AI extras. Memory the user confirms (viewable and erasable), push-to-talk voice input
/// with Windows' on-device recognizer, the weekly recap as an opt-in Windows notification scheduled on this PC, AI game
/// summaries from known facts, smart duplicate cleanup (proposals; the page merges with the existing APIs), a lag note on
/// rough sessions, and suggested prompts learned per page. Everything is stored as small JSON files under the data folder.
/// </summary>
public sealed partial class AppBackend
{
    private AssistantMemoryStore _memory = null!;
    private PromptLearningStore _prompts = null!;
    private VoiceService _voice = null!;
    private AssistantExtrasService _extras = null!;
    private WeeklyRecapState _recapState = null!;
    private Timer? _recapTimer;

    /// <summary>The only Windows Settings pages voice input links to (opened by the shell, never from page input).</summary>
    public static readonly IReadOnlySet<string> VoiceSettingsLinks = new HashSet<string>(StringComparer.Ordinal)
        { "ms-settings:privacy-microphone", "ms-settings:speech", "ms-settings:regionlanguage" };

    private void RegisterTrackE1Handlers()
    {
        var folder = Path.Combine(Paths.Root, "assistant");
        _memory = new AssistantMemoryStore(folder);
        _prompts = new PromptLearningStore(folder);
        _recapState = new WeeklyRecapState(folder);
        _extras = new AssistantExtrasService(_aiRouter, Path.Combine(Paths.Root, "cache", "ai"));
        _voice = new VoiceService(new WindowsVoiceBackend(), Settings.GetBool, (name, payload) => _events.Emit(name, payload)) { SafeMode = SafeMode };
        _assistant.Memory = _memory;

        // ---------- Memory ----------
        Dispatcher.Register("assistant.memory.list", _ => Task.FromResult<object?>(MemoryList()));
        Dispatcher.Register<MemoryAddParams>("assistant.memory.add", (p, _) =>
        {
            if (!Settings.GetBool("assistant.memory")) throw new BridgeException("forbidden", "Assistant memory is off. Turn it on in Settings › AI › Assistant.");
            var (m, error) = _memory.Add(MemoryText(p.Text), p.Origin == "chat" ? "chat" : "you");
            if (m is null) throw new BridgeException("invalid", error ?? "That couldn’t be remembered.");
            _events.Emit("assistant.memory.changed", MemoryList());
            return Task.FromResult<object?>(m);
        });
        Dispatcher.Register<MemoryUpdateParams>("assistant.memory.update", (p, _) =>
        {
            var (m, error) = _memory.Update(RequireMemoryId(p.Id), MemoryText(p.Text));
            if (m is null) throw new BridgeException("invalid", error ?? "That couldn’t be saved.");
            _events.Emit("assistant.memory.changed", MemoryList());
            return Task.FromResult<object?>(m);
        });
        Dispatcher.Register<MemoryIdParams>("assistant.memory.delete", (p, _) =>
        {
            var ok = _memory.Delete(RequireMemoryId(p.Id));
            _events.Emit("assistant.memory.changed", MemoryList());
            return Task.FromResult<object?>(ok);
        });
        Dispatcher.Register("assistant.memory.clear", _ =>
        {
            _memory.Clear();
            Repository.Audit("assistant.memory.clear", null);
            _events.Emit("assistant.memory.changed", MemoryList());
            return Task.FromResult<object?>(true);
        });

        // ---------- Voice (push-to-talk, on this PC) ----------
        Dispatcher.Register("voice.status", _ => Task.FromResult<object?>(_voice.Status()));
        Dispatcher.Register<VoiceSessionParams>("voice.start", (p, _) =>
        {
            if (IsGameActive) throw new BridgeException("busy", "Voice input is paused while a game is running.");
            return Task.FromResult<object?>(_voice.Start(RequireVoiceSession(p.SessionId)));
        });
        Dispatcher.Register<VoiceSessionParams>("voice.stop", (p, _) => Task.FromResult<object?>(_voice.Stop(RequireVoiceSession(p.SessionId))));
        Dispatcher.Register<VoiceSessionParams>("voice.cancel", (p, _) => Task.FromResult<object?>(_voice.Cancel(RequireVoiceSession(p.SessionId))));
        Dispatcher.Register<VoiceSettingsParams>("voice.openSettings", (p, _) =>
        {
            var link = p.Target switch
            {
                "microphone" => "ms-settings:privacy-microphone",
                "speech" => "ms-settings:speech",
                "language" => "ms-settings:regionlanguage",
                _ => throw new BridgeException("invalid", "Unknown settings page."),
            };
            _shell.OpenUri(new Uri(link));
            return Task.FromResult<object?>(true);
        });

        // ---------- Weekly recap (card and opt-in notification) ----------
        Dispatcher.Register<RecapWeekParams>("assistant.recap.get", (p, _) =>
        {
            var nowLocal = DateTime.Now;
            var thisMonday = Monday(DateOnly.FromDateTime(nowLocal));
            var week = p.Week is null ? thisMonday : RequireWeek(p.Week, thisMonday);
            return Task.FromResult<object?>(WeeklyRecapSchedule.Card(Library.Snapshot().Games, Repository.ListSessions(null, 10000), week, TimeZoneInfo.Local, nowLocal));
        });
        _recapTimer = new Timer(_ => CheckWeeklyRecap(), null, TimeSpan.FromSeconds(45), TimeSpan.FromMinutes(10));

        // ---------- AI game summaries ----------
        Dispatcher.Register<GameSummaryParams>("aix.gameSummary", async (p, ct) =>
        {
            var id = RequireId(p.GameId, "game");
            var game = Library.Snapshot().Games.FirstOrDefault(g => g.Id == id) ?? throw new BridgeException("notFound", "That game is no longer in your library.");
            if (!string.IsNullOrWhiteSpace(game.Description))
                return new GameSummaryDto(id, null, [], null, false, false, "This game has a description from its store, so no summary is needed.", false,
                    _aiRouter.FeatureEnabled("gameSummaries"), 0, _aiRouter.Active(), null);
            var facts = GameSummaries.Facts(game, Repository.GetEnrichment(id), await SteamTagsFor(game, ct));
            return await _extras.SummaryAsync(game, facts, p.Refresh ?? false, p.Ask ?? false, ct);
        });

        // ---------- Smart duplicate cleanup ----------
        Dispatcher.Register("assistant.duplicates", _ =>
            Task.FromResult<object?>(DuplicateCleanup.Propose(Library.Snapshot(), id => Repository.GetGame(id)?.SteamAppId)));

        // ---------- Lag note on rough sessions ----------
        Dispatcher.Register<LagNoteParams>("perf.lagNote", async (p, ct) =>
            await _extras.LagNoteAsync(RequireId(p.SessionId, "session"), c => LoadLagInput(p.SessionId, c), p.Refresh ?? false, ct));
        Sessions.StateChanged += OnSessionEndedLagNote;

        // ---------- Suggested prompts learned per page ----------
        Dispatcher.Register("assistant.prompts.get", _ => Task.FromResult<object?>(_prompts.Get(Settings.GetBool("assistant.learnPrompts"))));
        Dispatcher.Register<PromptRecordParams>("assistant.prompts.record", (p, _) =>
        {
            if (!Settings.GetBool("assistant.learnPrompts")) return Task.FromResult<object?>(false);
            var page = AssistantService.Pages.Contains(p.Page) ? p.Page : throw new BridgeException("invalid", "Unknown page.");
            if (p.Text is null || p.Text.Length > 400) throw new BridgeException("invalid", "Invalid prompt.");
            return Task.FromResult<object?>(_prompts.Record(page, p.Text));
        });
        Dispatcher.Register("assistant.prompts.clear", _ =>
        {
            _prompts.Clear();
            return Task.FromResult<object?>(true);
        });
    }

    private AssistantMemoryListDto MemoryList() =>
        new(Settings.GetBool("assistant.memory"), _memory.List(), AssistantMemoryStore.MaxItems, AssistantMemoryStore.MaxChars);

    private static string MemoryText(string? text) =>
        text is not null && text.Length <= AssistantMemoryStore.MaxChars * 2 ? text : throw new BridgeException("invalid", $"Keep it under {AssistantMemoryStore.MaxChars} characters.");

    private static string RequireMemoryId(string? id) =>
        AssistantMemoryStore.IsId(id) ? id! : throw new BridgeException("invalid", "Unknown memory.");

    private static string RequireVoiceSession(string? id) =>
        id is not null && VoiceSessionId().IsMatch(id) ? id : throw new BridgeException("invalid", "Invalid voice session.");

    [GeneratedRegex(@"\A[A-Za-z0-9_-]{1,40}\z")]
    private static partial Regex VoiceSessionId();

    private static DateOnly Monday(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    /// <summary>A week's Monday within the last year (yyyy-MM-dd).</summary>
    private static DateOnly RequireWeek(string week, DateOnly thisMonday)
    {
        if (!DateOnly.TryParseExact(week, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) || d.DayOfWeek != DayOfWeek.Monday ||
            d > thisMonday || d < thisMonday.AddDays(-7 * 53))
            throw new BridgeException("invalid", "Unknown week.");
        return d;
    }

    /// <summary>
    /// Every 10 minutes: is the weekly recap due (setting on, the chosen day and hour passed within 36 h, not yet shown for
    /// that week)? A running game defers it; a week without play is skipped quietly. The event goes to the page (an in-app
    /// toast when VYSTRAL is in front) and to the notification policy.
    /// </summary>
    private void CheckWeeklyRecap()
    {
        try
        {
            if (SafeMode || !Settings.GetBool(NotificationPolicy.WeeklyRecap) || IsGameActive) return;
            var nowLocal = DateTime.Now;
            var day = WeeklyRecapSchedule.Day(Settings.GetString("assistant.recapDay"));
            var hour = (int)Settings.GetNumber("assistant.recapHour");
            if (WeeklyRecapSchedule.Due(nowLocal, day, hour, _recapState.LastWeek) is not { } week) return;
            var card = WeeklyRecapSchedule.Card(Library.Snapshot().Games, Repository.ListSessions(null, 10000), week, TimeZoneInfo.Local, nowLocal);
            _recapState.Mark(week);
            if (card.TotalSeconds <= 0)
            {
                Log.Info("recap", "Weekly recap skipped: no play that week", new { week = card.Week });
                return;
            }
            _events.Emit("assistant.recap", new { week = card.Week, title = "Your week in games", summary = card.Summary });
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
        {
            Log.Warn("recap", "Weekly recap check failed", ex: ex);
        }
    }

    private async Task<IReadOnlyList<string>> SteamTagsFor(GameDto game, CancellationToken ct)
    {
        if (SafeMode || Repository.GetGame(game.Id)?.SteamAppId is null) return [];
        try
        {
            var r = await Dispatcher.InvokeAsync("tags.get", new { gameId = game.Id, refresh = false }, ct);
            var node = r is null ? null : JsonSerializer.SerializeToNode(r, BridgeDispatcher.Json);
            if (AiText.Str(node?["status"]) != "ok" || node?["tags"] is not JsonArray tags) return [];
            return tags.OfType<JsonObject>().Select(t => AiText.Str(t["name"])).OfType<string>().Take(12).ToList();
        }
        catch (Exception ex) when (ex is BridgeException or HttpRequestException or TaskCanceledException or JsonException or Vystral.Windows.DataSources.DataSourceException)
        {
            return [];
        }
    }

    private async Task<LagInput?> LoadLagInput(string sessionId, CancellationToken ct)
    {
        var row = Repository.GetRecapSession(sessionId);
        if (row is null) throw new BridgeException("notFound", "That session is no longer in your journal.");
        var session = new SessionDto(row.Id, row.GameId, null, row.Start.ToString("O"), row.End.ToString("O"), row.DurationSeconds, row.Source, row.PerfSummaryJson);
        JsonObject? summary = null;
        if (row.PerfSummaryJson is { Length: > 0 and <= 20_000 } json)
            try { summary = JsonNode.Parse(json, documentOptions: new JsonDocumentOptions { MaxDepth = 8 }) as JsonObject; }
            catch (JsonException) { summary = null; }
        if (!LagNotes.IsRough(summary, row.DurationSeconds)) return new LagInput(session, summary, [], [], []);
        async Task<JsonNode?> Read(string method, object? args)
        {
            try
            {
                var r = await Dispatcher.InvokeAsync(method, args, ct);
                return r is null ? null : JsonSerializer.SerializeToNode(r, BridgeDispatcher.Json);
            }
            catch (BridgeException) { return null; }
        }
        var samples = await Read("sessions.samples", new { sessionId }) as JsonArray ?? [];
        var insight = await Read("sessions.insightSamples", new { sessionId }) as JsonArray ?? [];
        var bg = await Read("insights.backgroundApps", null);
        var suspects = bg is JsonObject b && AiText.Bool(b["enough"]) == true && b["suspects"] is JsonArray arr
            ? arr.OfType<JsonObject>().Select(x => AiText.Clean(AiText.Str(x["displayName"]) ?? AiText.Str(x["name"]), 60)).Where(x => x.Length > 0).Take(3).ToList()
            : [];
        return new LagInput(session, summary, samples, insight, suspects);
    }

    /// <summary>After a session ends, write its lag note (only rough sessions get one) so the card has it straight away.</summary>
    private void OnSessionEndedLagNote(LaunchStateDto s)
    {
        if (s.Phase != "ended" || s.SessionId is not { } sessionId || SafeMode) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(4), _life.Token);
                var note = await _extras.LagNoteAsync(sessionId, c => LoadLagInput(sessionId, c), refresh: false, _life.Token);
                if (note.Rough && note.Text is not null) _events.Emit("perf.lagNote", note);
            }
            catch (Exception ex) when (ex is OperationCanceledException or BridgeException or IOException or JsonException)
            {
                // Best effort: the card works it out when it's next shown.
            }
        });
    }
}
