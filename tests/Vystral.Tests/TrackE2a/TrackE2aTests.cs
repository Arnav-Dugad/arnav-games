using System.Text.Json.Nodes;
using Vystral.Tests.Support;
using Vystral.Windows;
using Vystral.Windows.Bridge;
using Vystral.Windows.Recap;
using Vystral.Windows.Services;
using Xunit;

namespace Vystral.Tests.TrackE2a;

/// <summary>Track E2a: the start page and pinned collection cover settings, and the Completed 100% card's file name and upload rules.</summary>
public sealed class TrackE2aTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly SettingsService _s;

    public TrackE2aTests() => _s = new SettingsService(_t.Repo);

    public void Dispose() => _t.Dispose();

    private static string Id(int n) => n.ToString("x32");

    [Fact]
    public void Defaults_keep_todays_behaviour()
    {
        var all = _s.GetAll();
        Assert.Equal("last", all[AppBackend.StartPageSetting]!.GetValue<string>());
        Assert.Equal("", all[AppBackend.CollectionCoversSetting]!.GetValue<string>());
    }

    [Theory]
    [InlineData("last", true)]
    [InlineData("home", true)]
    [InlineData("library", true)]
    [InlineData("discover", true)]
    [InlineData("wishlist", true)]
    [InlineData("journal", true)]
    [InlineData("performance", true)]
    [InlineData("immersive", true)]
    [InlineData("settings", false)]
    [InlineData("game", false)]
    [InlineData("Library", false)]
    [InlineData("", false)]
    public void Start_page_is_one_of_the_known_pages(string value, bool ok)
    {
        Assert.Equal(ok, _s.Set(AppBackend.StartPageSetting, JsonValue.Create(value)) is null);
        Assert.Equal(ok ? value : "last", _s.GetString(AppBackend.StartPageSetting));
    }

    [Fact]
    public void Collection_covers_accept_only_id_pairs()
    {
        string pair(int c, int g) => $"{Id(c)}:{Id(g)}";
        Assert.Null(_s.Set(AppBackend.CollectionCoversSetting, JsonValue.Create("")));
        Assert.Null(_s.Set(AppBackend.CollectionCoversSetting, JsonValue.Create(pair(1, 2))));
        Assert.Null(_s.Set(AppBackend.CollectionCoversSetting, JsonValue.Create(string.Join('|', Enumerable.Range(0, 200).Select(i => pair(i, i + 1))))));
        Assert.Equal(13_199, _s.GetString(AppBackend.CollectionCoversSetting).Length);

        foreach (var bad in new[]
        {
            string.Join('|', Enumerable.Range(0, 201).Select(i => pair(i, i + 1))), // too many
            $"{pair(1, 2)}|", // trailing separator
            $"{Id(1)}:../../etc", // not an id
            $"{Id(0xabc).ToUpperInvariant()}:{Id(2)}", // ids are lower-case hex
            $"{pair(1, 2)}\n",
            "<script>",
        })
        {
            Assert.NotNull(_s.Set(AppBackend.CollectionCoversSetting, JsonValue.Create(bad)));
        }
        Assert.NotNull(_s.Set(AppBackend.CollectionCoversSetting, JsonValue.Create(42)));
        Assert.Equal(13_199, _s.GetString(AppBackend.CollectionCoversSetting).Length); // unchanged by the rejected values
    }

    [Theory]
    [InlineData(false, "last", false)]
    [InlineData(false, "library", false)]
    [InlineData(false, "immersive", true)]
    [InlineData(true, "last", true)]
    [InlineData(true, "home", true)]
    [InlineData(false, null, false)]
    public void Immersive_start_follows_either_setting(bool startupImmersive, string? page, bool expected) =>
        Assert.Equal(expected, AppBackend.StartsInImmersive(startupImmersive, page));

    [Fact]
    public void Card_file_name_is_built_from_the_title_safely()
    {
        var at = new DateTimeOffset(2026, 10, 11, 20, 0, 0, TimeSpan.Zero);
        var name = AppBackend.CompletionImageName("Half-Life: <Alyx>/\\?*", at);
        Assert.StartsWith("VYSTRAL 100% - Half-Life Alyx - ", name);
        Assert.DoesNotContain(name, c => Path.GetInvalidFileNameChars().Contains(c));
        Assert.Contains("Game", AppBackend.CompletionImageName("???", at));
        Assert.Contains("Game", AppBackend.CompletionImageName("...", at));
        Assert.True(AppBackend.CompletionImageName(new string('x', 500), at).Length < 100);
    }

    [Fact]
    public void Card_uploads_are_bound_and_checked_like_replay_images()
    {
        // The card shares the replay card's store type: exact size, in order, a 1920×1080 PNG, consumed once.
        var store = new ReplayImageStore();
        var token = store.Begin(Id(7), 100);
        Assert.Throws<BridgeException>(() => store.Append(token, 1, Convert.ToBase64String(new byte[10])));
        store.Append(token, 0, Convert.ToBase64String(new byte[100]));
        Assert.Throws<BridgeException>(() => store.Take(token)); // not a PNG
        Assert.Throws<BridgeException>(() => store.Take(token)); // and consumed
    }
}
