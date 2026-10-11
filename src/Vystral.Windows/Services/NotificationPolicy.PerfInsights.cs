using System.Text.Json;
using Vystral.Windows.Bridge;

namespace Vystral.Windows.Services;

/// <summary>
/// Track E3: "Your GPU runs 6 °C hotter in …" and "Driver 617.42: … +2 fps average" (<c>perf.insight</c>). The backend
/// announces each note once (stored in perf_notices); this only decides whether Windows shows it too.
/// </summary>
public sealed partial class NotificationPolicy
{
    public const string PerfInsights = "notifications.perfInsights";

    private void FromPerfInsight(JsonElement p, List<NotificationRequest> list)
    {
        if (!setting(PerfInsights)) return;
        var kind = Str(p, "kind");
        if (kind is not ("thermal" or "driver") || Str(p, "sessionId") is not { } sessionId || !Hex32().IsMatch(sessionId)) return;
        var title = Text(Str(p, "title"), 120);
        var body = Text(Str(p, "body"), 300);
        if (title is null || body is null || !Once($"perf:{kind}:{sessionId}")) return;
        list.Add(new NotificationRequest(kind == "thermal" ? "thermal" : "perf", title, body,
            Route("performance", ("sessionId", sessionId)), Tag: $"perf-{kind}-{sessionId[..8]}"));
    }

    /// <summary>Plain text without control characters, trimmed and capped (these notes carry longer game titles than most).</summary>
    private static string? Text(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return s.Length == 0 ? null : s.Length > max ? s[..(max - 1)] + "…" : s;
    }
}
