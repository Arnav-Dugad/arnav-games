using System.Globalization;
using Vystral.Core.Contracts;
using Vystral.Windows.Ai.Assistant;
using Vystral.Windows.Services;

namespace Vystral.Windows.Ai.Extras;

/// <summary>A week of play for the recap card (call('assistant.recap.get')) and the notification.</summary>
public sealed record WeeklyRecapCardDto(string Week, string From, string To, long TotalSeconds, int Sessions, int DaysPlayed,
    IReadOnlyList<RecapGameDto> TopGames, RecapLongestDto? Longest, IReadOnlyList<string> FirstTime, long PreviousWeekSeconds, string Summary, bool Finished);

public sealed record RecapGameDto(string GameId, string Title, long Seconds);

public sealed record RecapLongestDto(string Title, int Seconds, string Day);

/// <summary>
/// Track E1: when the weekly recap notification is due. Pure rules, scheduled on this PC (no server, no push):
/// <list type="bullet">
/// <item>The moment is the chosen day at the chosen hour, local time. Sunday covers the week that ends that day (Monday to
/// Sunday); Monday covers the week before.</item>
/// <item>It's due from that moment until <see cref="Window"/> later, so a PC that was off or asleep at 18:00 still gets it
/// when Arnav Games opens that evening or the next day, but never days late.</item>
/// <item>Once per week: the covered week's Monday is remembered after it's shown (or skipped because nothing was played).</item>
/// </list>
/// </summary>
public static class WeeklyRecapSchedule
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(36);

    public static DayOfWeek Day(string setting) => setting == "monday" ? DayOfWeek.Monday : DayOfWeek.Sunday;

    /// <summary>The most recent scheduled moment at or before <paramref name="nowLocal"/>.</summary>
    public static DateTime LastMoment(DateTime nowLocal, DayOfWeek day, int hour)
    {
        hour = Math.Clamp(hour, 0, 23);
        var back = ((int)nowLocal.DayOfWeek - (int)day + 7) % 7;
        var moment = nowLocal.Date.AddDays(-back).AddHours(hour);
        return moment > nowLocal ? moment.AddDays(-7) : moment;
    }

    /// <summary>The Monday of the week a recap shown at <paramref name="moment"/> covers.</summary>
    public static DateOnly WeekFor(DateTime moment, DayOfWeek day)
    {
        var d = DateOnly.FromDateTime(moment);
        var monday = d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
        return day == DayOfWeek.Monday ? monday.AddDays(-7) : monday;
    }

    /// <summary>The week to notify about now, or null when nothing is due.</summary>
    public static DateOnly? Due(DateTime nowLocal, DayOfWeek day, int hour, DateOnly? lastWeekSent)
    {
        var moment = LastMoment(nowLocal, day, hour);
        if (nowLocal - moment > Window) return null;
        var week = WeekFor(moment, day);
        return lastWeekSent is { } last && last >= week ? null : week;
    }

    /// <summary>The recap card for the week starting <paramref name="monday"/>, computed from local sessions.</summary>
    public static WeeklyRecapCardDto Card(IReadOnlyList<GameDto> games, IReadOnlyList<SessionDto> sessions, DateOnly monday, TimeZoneInfo zone, DateTime nowLocal)
    {
        var f = WeeklyRecapFacts.Compute(games, sessions, monday, zone);
        var sunday = monday.AddDays(6);
        return new WeeklyRecapCardDto(
            monday.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), monday.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), sunday.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            f.TotalSeconds, f.Sessions, f.DaysPlayed,
            f.TopGames.Select(g => new RecapGameDto(g.GameId, g.Title, g.Seconds)).ToList(),
            f.Longest is { } l ? new RecapLongestDto(l.Title, l.Seconds, l.Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)) : null,
            f.FirstTime.Take(6).ToList(), f.PreviousWeekSeconds, Summary(f), DateOnly.FromDateTime(nowLocal) > sunday);
    }

    /// <summary>One line for the notification body: total, days, the top game, the change from last week.</summary>
    public static string Summary(WeeklyRecapFacts f)
    {
        if (f.TotalSeconds <= 0) return "No games tracked this week.";
        var parts = new List<string> { $"{AiText.Duration(f.TotalSeconds)} over {f.DaysPlayed} {(f.DaysPlayed == 1 ? "day" : "days")}" };
        if (f.TopGames.Count > 0) parts.Add($"most played: {Clip(f.TopGames[0].Title)} ({AiText.Duration(f.TopGames[0].Seconds)})");
        if (f.PreviousWeekSeconds > 0)
        {
            var diff = f.TotalSeconds - f.PreviousWeekSeconds;
            if (Math.Abs(diff) >= 600) parts.Add(diff > 0 ? $"up {AiText.Duration(diff)} on last week" : $"down {AiText.Duration(-diff)} on last week");
            else parts.Add("about the same as last week");
        }
        if (f.FirstTime.Count > 0) parts.Add($"new: {Clip(f.FirstTime[0])}{(f.FirstTime.Count > 1 ? $" and {f.FirstTime.Count - 1} more" : "")}");
        return string.Join(" · ", parts) + ".";
    }

    private static string Clip(string s) => s.Length <= 40 ? s : s[..39] + "…";
}

/// <summary>Remembers the last week a recap notification covered (one tiny JSON file; no migration).</summary>
public sealed class WeeklyRecapState(string folder)
{
    private sealed class Stored
    {
        public string? LastWeek { get; set; }
        public DateTimeOffset At { get; set; }
    }

    private string File => Path.Combine(folder, "recap-notify.json");

    public DateOnly? LastWeek =>
        JsonFileCache.Read<Stored>(File, 4096)?.LastWeek is { } s && DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public void Mark(DateOnly week) =>
        JsonFileCache.Write(File, new Stored { LastWeek = week.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), At = DateTimeOffset.UtcNow });
}
