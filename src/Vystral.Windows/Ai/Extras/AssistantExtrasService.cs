using System.Text.Json.Nodes;
using Vystral.Core.Contracts;
using Vystral.Windows.Ai.Assistant;
using Vystral.Windows.Services;

namespace Vystral.Windows.Ai.Extras;

/// <summary>What a lag note reads for one session (the app loads it through its read-only bridge methods).</summary>
public sealed record LagInput(SessionDto Session, JsonObject? Summary, JsonArray Samples, JsonArray Insight, IReadOnlyList<string> BackgroundSuspects);

/// <summary>
/// Track E1: lag notes and AI game summaries, with their small JSON caches under <c>cache/ai</c> (no migration; capped;
/// re-validated on read; cleared with the other AI caches).
/// </summary>
public sealed class AssistantExtrasService(AiRouter ai, string cacheFolder)
{
    private readonly Lock _lock = new();
    public const int LagCacheCap = 800;

    private string LagFile => Path.Combine(cacheFolder, "lag-notes.json");
    private string SummaryFile => Path.Combine(cacheFolder, "game-summaries.json");

    private sealed class Cache
    {
        public int Version { get; set; } = 1;
        public Dictionary<string, Item>? Items { get; set; }
    }

    private sealed class Item
    {
        public string? Text { get; set; }
        public string? Cause { get; set; }
        public string? Source { get; set; }
        public string? Label { get; set; }
        public string? Hash { get; set; }
        public List<string>? Sources { get; set; }
        public DateTimeOffset At { get; set; }
    }

    private string? Sent(AiAnswer a, string feature) =>
        a.Cloud
            ? $"Sent to {CloudAiProviders.Company(CloudAiProviders.FromId(a.Engine) ?? CloudAiProvider.Compatible)} ({a.Label}): " + AiRouter.Features.First(f => f.Id == feature).Sends
            : "Handled by local AI on this PC. Nothing left your computer.";

    // ---------------- Lag notes ----------------

    public const string LagBasis = "From VYSTRAL’s frame-time analysis of this session. Nothing was changed.";

    public LagNoteDto? CachedLagNote(string sessionId)
    {
        var hit = Read(LagFile, sessionId, 1024 * 1024);
        if (hit?.Text is not { } text) return null;
        var t = LagNotes.Clip(AiText.Clean(text, 300));
        return t.Length == 0 ? null
            : new LagNoteDto(sessionId, true, t, Safe(hit.Cause), hit.Source == "ai" ? "ai" : "analysis", hit.Source == "ai" ? AiText.Clean(hit.Label, 80) : null, LagBasis, true, null);
    }

    private static string? Safe(string? cause) =>
        cause is "heat" or "power" or "shaders" or "timer" or "cpu" or "gpu" or "waiting" or "background" or "uneven" ? cause : "uneven";

    /// <summary>
    /// The note for one session: cached when there is one (unless <paramref name="refresh"/>), else worked out now. Smooth or
    /// unmeasured sessions get no note. The AI only rewords VYSTRAL's facts, and only with the lag-note switch on.
    /// </summary>
    public async Task<LagNoteDto> LagNoteAsync(string sessionId, Func<CancellationToken, Task<LagInput?>> load, bool refresh, CancellationToken ct)
    {
        if (!refresh && CachedLagNote(sessionId) is { } cached) return cached;
        var input = await load(ct);
        if (input is null || !LagNotes.IsRough(input.Summary, input.Session.DurationSeconds))
            return new LagNoteDto(sessionId, false, null, null, "analysis", null, LagBasis, false, null);
        var analysis = StutterAnalysis.Analyze(input.Summary, input.Samples, input.Insight, input.Session.DurationSeconds);
        var facts = LagNotes.Explain(analysis, input.Summary, input.Session.DurationSeconds, input.BackgroundSuspects);
        var note = new LagNoteDto(sessionId, true, facts.Text, facts.Cause, "analysis", null, LagBasis, false, null);
        if (ai.FeatureEnabled("lagNotes"))
        {
            var outcome = await ai.AskAsync("lagNotes", new AiPrompt(
                "You write one short line (under 22 words) for a game session card, saying the most likely reason the session was rough. " +
                "Use only the facts; keep VYSTRAL's reading unless the facts clearly point elsewhere. Start with \"Likely\". " +
                "Quote numbers exactly or leave them out. Never say anything was changed or fixed, and give no instructions. No markdown, no emoji.",
                facts.FactsText, Json: false, MaxTokens: 512),
                raw => LagNotes.AcceptAi(raw, facts.FactsText), ct);
            if (outcome.Answer is { } a)
                note = note with { Text = a.Text, Source = "ai", AiLabel = a.Label, Sent = Sent(a, "lagNotes") };
        }
        Write(LagFile, sessionId, new Item { Text = note.Text, Cause = note.Cause, Source = note.Source, Label = note.AiLabel, At = DateTimeOffset.UtcNow }, LagCacheCap, 1024 * 1024);
        return note;
    }

    // ---------------- Game summaries ----------------

    /// <summary>
    /// A summary for a game without a description. Cached ones come back at once (marked stale when the facts changed).
    /// Writing a new one needs the AI ready and either the feature switch on or the user's explicit click.
    /// </summary>
    public async Task<GameSummaryDto> SummaryAsync(GameDto g, SummaryFacts facts, bool refresh, bool userAsked, CancellationToken ct)
    {
        var engine = ai.Active();
        var featureOn = ai.FeatureEnabled("gameSummaries");
        if (!refresh && Read(SummaryFile, g.Id, 2 * 1024 * 1024) is { Text: { } cachedText } hit &&
            GameSummaries.Accept(cachedText, cachedText) is { } clean)
        {
            var src = (hit.Sources ?? []).Select(s => AiText.Clean(s, 40)).Where(s => s.Length > 0).Take(5).ToList();
            return new GameSummaryDto(g.Id, clean, src, AiText.Clean(hit.Label, 80), true, hit.Hash != facts.Hash, null, false, featureOn, facts.Count, engine, null);
        }
        if (facts.Count < GameSummaries.MinFacts)
            return new GameSummaryDto(g.Id, null, facts.Sources, null, false, false,
                "VYSTRAL doesn’t know enough about this game yet to write a summary from facts.", false, featureOn, facts.Count, engine, null);
        if (!engine.Ready)
            return new GameSummaryDto(g.Id, null, facts.Sources, null, false, false, engine.Reason, true, featureOn, facts.Count, engine, null);
        if (!featureOn && !userAsked)
            return new GameSummaryDto(g.Id, null, facts.Sources, null, false, false, null, false, false, facts.Count, engine, null);
        var prompt = new AiPrompt(GameSummaries.Prompt, facts.Text, Json: false, MaxTokens: 600);
        Func<string, string?> accept = raw => GameSummaries.Accept(raw, facts.Text);
        // A click is consent for this one game; the chosen engine and every other rule still apply.
        var outcome = await ai.AskAsync("gameSummaries", prompt, accept, ct, ignoreFeatureSwitch: userAsked && !featureOn);
        if (outcome.Answer is not { } a)
            return new GameSummaryDto(g.Id, null, facts.Sources, null, false, false,
                outcome.Note ?? "The AI’s summary didn’t stick to the facts, so it wasn’t used.", false, featureOn, facts.Count, engine, null);
        Write(SummaryFile, g.Id, new Item { Text = a.Text, Label = a.Label, Hash = facts.Hash, Sources = [.. facts.Sources], At = DateTimeOffset.UtcNow }, GameSummaries.CacheCap, 2 * 1024 * 1024);
        return new GameSummaryDto(g.Id, a.Text, facts.Sources, a.Label, false, false, a.Note, false, featureOn, facts.Count, engine, Sent(a, "gameSummaries"));
    }

    public bool ForgetSummary(string gameId)
    {
        lock (_lock)
        {
            var c = JsonFileCache.Read<Cache>(SummaryFile, 2 * 1024 * 1024);
            if (c?.Items is null || !c.Items.Remove(gameId)) return false;
            return JsonFileCache.Write(SummaryFile, c);
        }
    }

    public void ClearCaches()
    {
        lock (_lock)
        {
            JsonFileCache.Delete(LagFile);
            JsonFileCache.Delete(SummaryFile);
        }
    }

    // ---------------- Cache files ----------------

    private Item? Read(string file, string key, long max)
    {
        lock (_lock)
        {
            var c = JsonFileCache.Read<Cache>(file, max);
            return c?.Items is not null && c.Items.TryGetValue(key, out var e) ? e : null;
        }
    }

    private void Write(string file, string key, Item item, int cap, long max)
    {
        lock (_lock)
        {
            var c = JsonFileCache.Read<Cache>(file, max) ?? new Cache();
            c.Items ??= [];
            c.Items[key] = item;
            if (c.Items.Count > cap)
                foreach (var old in c.Items.OrderBy(kv => kv.Value?.At ?? DateTimeOffset.MinValue).Take(c.Items.Count - cap).Select(kv => kv.Key).ToList())
                    c.Items.Remove(old);
            JsonFileCache.Write(file, c);
        }
    }
}
