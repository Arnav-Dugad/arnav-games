using System.Text.Json;
using Vystral.Tests.Ai;
using Vystral.Tests.Support;
using Vystral.Windows.Ai.Extras;
using Vystral.Windows.Services;
using Xunit;

namespace Vystral.Tests.TrackE1;

/// <summary>Track E1: when the weekly recap notification is due, what week it covers, and the notification it becomes.</summary>
public sealed class WeeklyRecapScheduleTests
{
    // 2026-10-11 is a Sunday.
    private static DateTime At(int day, int hour, int minute = 0) => new(2026, 10, day, hour, minute, 0, DateTimeKind.Local);

    [Fact]
    public void Sunday_at_six_covers_the_week_ending_that_day()
    {
        var sunday = DayOfWeek.Sunday;
        Assert.Equal(new DateOnly(2026, 10, 5), WeeklyRecapSchedule.Due(At(11, 18), sunday, 18, null));
        Assert.Equal(new DateOnly(2026, 10, 5), WeeklyRecapSchedule.Due(At(12, 9), sunday, 18, null)); // PC was off on Sunday evening
        Assert.Null(WeeklyRecapSchedule.Due(At(13, 7), sunday, 18, null)); // more than 36 hours late: skip, never days late
        Assert.Null(WeeklyRecapSchedule.Due(At(11, 20), sunday, 18, new DateOnly(2026, 10, 5))); // once per week
        Assert.Equal(new DateOnly(2026, 10, 12), WeeklyRecapSchedule.Due(At(18, 18, 30), sunday, 18, new DateOnly(2026, 10, 5)));
    }

    [Fact]
    public void Before_the_hour_on_the_day_nothing_new_is_due()
    {
        // Last Sunday's moment (4 Oct 18:00) is more than 36 h before Sunday 11 Oct 17:59.
        Assert.Null(WeeklyRecapSchedule.Due(At(11, 17, 59), DayOfWeek.Sunday, 18, null));
        Assert.Equal(At(4, 18), WeeklyRecapSchedule.LastMoment(At(11, 17, 59), DayOfWeek.Sunday, 18));
        Assert.Equal(At(11, 18), WeeklyRecapSchedule.LastMoment(At(11, 18), DayOfWeek.Sunday, 18));
    }

    [Fact]
    public void Monday_covers_the_week_before_and_the_hour_is_clamped()
    {
        Assert.Equal(new DateOnly(2026, 10, 5), WeeklyRecapSchedule.Due(At(12, 9), DayOfWeek.Monday, 8, null));
        Assert.Equal(new DateOnly(2026, 10, 5), WeeklyRecapSchedule.WeekFor(At(12, 8), DayOfWeek.Monday));
        Assert.Equal(new DateOnly(2026, 10, 5), WeeklyRecapSchedule.WeekFor(At(11, 18), DayOfWeek.Sunday));
        Assert.Equal(At(12, 23), WeeklyRecapSchedule.LastMoment(At(12, 23, 30), DayOfWeek.Monday, 99));
        Assert.Equal(DayOfWeek.Monday, WeeklyRecapSchedule.Day("monday"));
        Assert.Equal(DayOfWeek.Sunday, WeeklyRecapSchedule.Day("anything"));
    }

    [Fact]
    public void The_card_and_summary_come_from_local_sessions_only()
    {
        var ashen = AiTestData.Game("Ashen Crown", ["RPG"]);
        var nebula = AiTestData.Game("Nebula Drift", ["Racing"]);
        var sessions = new[]
        {
            AiTestData.Session(ashen, "2026-09-30T19:00:00Z", 3600), // the week before
            AiTestData.Session(ashen, "2026-10-06T19:00:00Z", 7200),
            AiTestData.Session(ashen, "2026-10-08T19:00:00Z", 3600),
            AiTestData.Session(nebula, "2026-10-10T10:00:00Z", 1800),
        };
        var card = WeeklyRecapSchedule.Card([ashen, nebula], sessions, new DateOnly(2026, 10, 5), TimeZoneInfo.Utc, At(12, 9));
        Assert.Equal("2026-10-05", card.Week);
        Assert.Equal("2026-10-11", card.To);
        Assert.Equal(12600, card.TotalSeconds);
        Assert.Equal(3, card.DaysPlayed);
        Assert.Equal("Ashen Crown", card.TopGames[0].Title);
        Assert.Equal(["Nebula Drift"], card.FirstTime);
        Assert.True(card.Finished);
        Assert.Equal("3 h 30 min over 3 days · most played: Ashen Crown (3 h) · up 2 h 30 min on last week · new: Nebula Drift.", card.Summary);

        var empty = WeeklyRecapSchedule.Card([ashen], [], new DateOnly(2026, 10, 5), TimeZoneInfo.Utc, At(11, 9));
        Assert.Equal(0, empty.TotalSeconds);
        Assert.False(empty.Finished);
        Assert.Equal("No games tracked this week.", empty.Summary);
    }

    [Fact]
    public void The_state_file_remembers_the_last_week()
    {
        using var dir = new TempDir();
        var state = new WeeklyRecapState(dir.Path);
        Assert.Null(state.LastWeek);
        state.Mark(new DateOnly(2026, 10, 5));
        Assert.Equal(new DateOnly(2026, 10, 5), new WeeklyRecapState(dir.Path).LastWeek);
        File.WriteAllText(Path.Combine(dir.Path, "recap-notify.json"), """{"lastWeek":"../../x"}""");
        Assert.Null(state.LastWeek);
    }

    [Fact]
    public void The_notification_is_opt_in_once_per_week_and_opens_the_assistant_with_that_recap()
    {
        var on = new Dictionary<string, bool> { [NotificationPolicy.Enabled] = true, [NotificationPolicy.WeeklyRecap] = true };
        var policy = new NotificationPolicy(k => on.GetValueOrDefault(k), _ => null);
        JsonElement P(string json) => JsonDocument.Parse(json).RootElement;
        var payload = P("""{"week":"2026-10-05","title":"Your week in games","summary":"3 h 30 min over 3 days · most played: Ashen Crown (3 h)."}""");
        var n = Assert.Single(policy.Evaluate("assistant.recap", payload, foreground: false));
        Assert.Equal("weeklyRecap", n.Category);
        Assert.Equal("Your week in games", n.Title);
        Assert.StartsWith("3 h 30 min", n.Body);
        Assert.Equal("vystral://open?route=assistant&recap=2026-10-05", ActivationUri.Build(n.RouteJson));
        Assert.Equal("""{"name":"assistant","recap":"2026-10-05"}""", ActivationUri.RouteFromUri("vystral://open?route=assistant&recap=2026-10-05"));
        Assert.Empty(policy.Evaluate("assistant.recap", payload, foreground: false)); // once

        Assert.Empty(policy.Evaluate("assistant.recap", P("""{"week":"../x"}"""), foreground: false));
        Assert.Null(ActivationUri.RouteFromUri("vystral://open?route=assistant&recap=2026-13-40"));
        Assert.Null(ActivationUri.RouteFromUri("vystral://open?route=assistant&id=" + new string('a', 32)));
        Assert.Equal("""{"name":"assistant"}""", ActivationUri.RouteFromUri("vystral://open?route=assistant"));

        on[NotificationPolicy.WeeklyRecap] = false;
        Assert.Empty(new NotificationPolicy(k => on.GetValueOrDefault(k), _ => null).Evaluate("assistant.recap", payload, foreground: false));
    }
}
