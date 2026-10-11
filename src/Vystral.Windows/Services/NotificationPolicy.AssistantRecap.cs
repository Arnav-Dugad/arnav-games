using System.Globalization;
using System.Text.Json;
using Vystral.Windows.Bridge;

namespace Vystral.Windows.Services;

/// <summary>
/// Track E1: "Your week in games" (<c>assistant.recap</c>), scheduled on this PC for the day and hour chosen in Settings.
/// Selecting it opens the Assistant with the full recap for that week.
/// </summary>
public sealed partial class NotificationPolicy
{
    public const string WeeklyRecap = "notifications.weeklyRecap";

    private void FromAssistantRecap(JsonElement p, List<NotificationRequest> list)
    {
        if (!setting(WeeklyRecap)) return;
        var week = Str(p, "week");
        if (week is null || !DateOnly.TryParseExact(week, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return;
        if (!Once($"recap:{week}")) return;
        var raw = Str(p, "summary");
        var line = raw is null ? "" : new string(raw.Where(c => !char.IsControl(c)).ToArray()).Trim();
        var body = line.Length == 0 ? "Your play this week, summed up." : line.Length > 180 ? line[..179] + "…" : line;
        var title = Clean(Str(p, "title")) ?? "Your week in games";
        list.Add(new NotificationRequest("weeklyRecap", title, body, Route("assistant", ("recap", week)), Tag: "weekly-recap"));
    }
}
