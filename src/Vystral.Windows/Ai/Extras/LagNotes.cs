using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Vystral.Windows.Ai.Assistant;

namespace Vystral.Windows.Ai.Extras;

/// <summary>
/// "Why did this session lag?" for one rough session. <c>Source</c>: "analysis" (VYSTRAL's own words from the frame-time
/// analysis) or "ai" (the same facts, worded by the chosen AI). <c>Cause</c> is a stable key the page can use for an icon:
/// heat | power | shaders | timer | cpu | gpu | waiting | background | uneven.
/// </summary>
public sealed record LagNoteDto(string SessionId, bool Rough, string? Text, string? Cause, string Source, string? AiLabel, string Basis, bool Cached, string? Sent);

/// <summary>The facts a lag note may use (all from one session's summary and samples).</summary>
public sealed record LagFacts(string Cause, string Text, string FactsText);

/// <summary>
/// Track E1: the one-line likely cause shown on a rough session's card. "Rough" uses exactly the Performance page's rule
/// (<c>ui/src/views/perf/overview.ts</c> → <c>sessionHealth</c>): 1% lows under half the average, more than one stutter a
/// minute, or the CPU averaging over 85%. The cause comes from Track D3's deterministic stutter analysis
/// (<see cref="StutterAnalysis"/>); an AI, when the user turned that on, may only reword those facts. Purely descriptive:
/// VYSTRAL never changes a setting because of it.
/// </summary>
public static class LagNotes
{
    public const double RoughLowRatio = 0.5;
    public const double RoughStuttersPerMinute = 1;
    public const double RoughCpuAvg = 85;
    public const int MaxChars = 150;

    private static double? N(JsonNode? n, string name) => n is JsonObject o ? AiText.Num(o[name]) : null;

    /// <summary>The Performance page's "Rough" verdict. Needs frame-rate data, like the page.</summary>
    public static bool IsRough(JsonObject? summary, int durationSeconds)
    {
        var avg = N(summary, "fpsAvg");
        if (avg is not > 0) return false;
        if (N(summary, "fps1Low") is { } low && low / avg.Value < RoughLowRatio) return true;
        if (N(summary, "stutterCount") is { } st && durationSeconds >= 60 && st / (durationSeconds / 60.0) > RoughStuttersPerMinute) return true;
        return N(summary, "cpuAvg") is > RoughCpuAvg;
    }

    /// <summary>The most likely cause in one plain line, plus the facts an AI may reword. Order: the strongest evidence first.</summary>
    public static LagFacts Explain(StutterAnalysis a, JsonObject? summary, int durationSeconds, IReadOnlyList<string> backgroundSuspects)
    {
        var spikes = a.Spikes;
        int Count(Func<StutterSpike, bool> p) => spikes.Count(p);
        var n = spikes.Count;
        var withGpu = Count(s => s.Gpu is not null);
        var withCpu = Count(s => s.Cpu is not null);
        var throttled = N(summary, "throttledSeconds") ?? 0;
        var power = N(summary, "powerLimitedSeconds") ?? 0;
        var cpuAvg = N(summary, "cpuAvg");
        var avg = N(summary, "fpsAvg");
        var low = N(summary, "fps1Low");
        var facts = new StringBuilder();
        void F(string s) => facts.Append("- ").AppendLine(s);
        if (avg is { } av) F($"Average frame rate: {Math.Round(av).ToString(CultureInfo.InvariantCulture)} fps");
        if (low is { } lo) F($"1% low: {Math.Round(lo).ToString(CultureInfo.InvariantCulture)} fps");
        if (N(summary, "stutterCount") is { } sc) F($"Stutters: {sc.ToString(CultureInfo.InvariantCulture)}");
        foreach (var s in a.Signals.Take(5)) F(s);

        (string Cause, string Text) pick;
        if (n > 0 && Count(s => s.Thermal) * 2 >= n)
            pick = ("heat", "Likely heat: the graphics card slowed itself down to cool off during the worst moments.");
        else if (n == 0 && throttled >= 60)
            pick = ("heat", $"Likely heat: the graphics card slowed itself down for {AiText.Duration(throttled)} of this session.");
        else if (durationSeconds > 600 && n >= 2 && Count(s => s.T <= 120) * 2 >= n)
            pick = ("shaders", "Likely shaders compiling or a level loading: most hitches came in the first two minutes.");
        else if (Periodic(spikes) is { } every)
            pick = ("timer", $"Likely a background task on a timer: hitches repeated about every {every} seconds.");
        else if (n > 0 && withCpu > 0 && Count(s => s.Cpu >= 85) * 2 >= withCpu)
            pick = ("cpu", "Likely the processor: it was 85% busy or more at most of the worst moments.");
        else if (n > 0 && withGpu > 0 && Count(s => s.Gpu >= 95) * 2 >= withGpu)
            pick = ("gpu", "Likely the graphics card: it was at full load when frames slowed.");
        else if (n > 0 && withGpu > 0 && Count(s => s.Gpu < 70) * 2 >= withGpu)
            pick = ("waiting", "Likely loading or shader work: the graphics card was waiting, not busy, when frames slowed.");
        else if (n > 0 && Count(s => s.Power) * 2 >= n)
            pick = ("power", "Likely the graphics card’s power limit: it hit the limit during the worst moments.");
        else if (cpuAvg is > RoughCpuAvg)
            pick = ("cpu", $"Likely the processor: it averaged {Math.Round(cpuAvg.Value).ToString(CultureInfo.InvariantCulture)}% busy for the whole session.");
        else if (durationSeconds > 0 && power / durationSeconds >= 0.5)
            pick = ("power", "Likely the graphics card’s power limit: it ran at the limit for most of the session.");
        else if (backgroundSuspects.Count > 0)
            pick = ("background", $"No single cause in the samples; {backgroundSuspects[0]} often runs during your rough sessions.");
        else
            pick = ("uneven", low is { } l && avg is { } aa
                ? $"Frame pacing was uneven (1% lows of {Math.Round(l).ToString(CultureInfo.InvariantCulture)} fps against a {Math.Round(aa).ToString(CultureInfo.InvariantCulture)} fps average), with no single clear cause in the samples."
                : "Frame pacing was uneven, with no single clear cause in the samples.");
        if (backgroundSuspects.Count > 0) F($"Background apps often seen in rough sessions: {string.Join(", ", backgroundSuspects.Take(3))}");
        F($"VYSTRAL’s reading: {pick.Text}");
        return new LagFacts(pick.Cause, Clip(pick.Text), facts.ToString());
    }

    private static int? Periodic(IReadOnlyList<StutterSpike> spikes)
    {
        if (spikes.Count < 3) return null;
        var gaps = spikes.Zip(spikes.Skip(1), (a, b) => b.T - a.T).ToList();
        return gaps.Max() - gaps.Min() <= 3 && gaps.Average() >= 5 ? (int)Math.Round(gaps.Average()) : null;
    }

    public static string Clip(string s) => s.Length <= MaxChars ? s : s[..(MaxChars - 1)].TrimEnd() + "…";

    /// <summary>
    /// Accepts an AI's wording only if it's one short line, uses no number that isn't in the facts, and doesn't claim
    /// anything was changed or fixed.
    /// </summary>
    public static string? AcceptAi(string raw, string facts)
    {
        if (raw.Trim().Contains('\n')) return null; // one line only
        var t = AiText.Clean(raw, 400).Trim('"', '“', '”').Trim();
        if (t.Length < 12 || t.Length > MaxChars || t.Contains('\n')) return null;
        if (!AiText.OnlyKnownNumbers(t, facts)) return null;
        var lower = t.ToLowerInvariant();
        string[] claims = ["i changed", "i've changed", "i have changed", "vystral changed", "was fixed", "has been fixed", "i fixed", "i adjusted", "i turned"];
        if (claims.Any(lower.Contains) || lower.Contains("http")) return null;
        return t;
    }
}
