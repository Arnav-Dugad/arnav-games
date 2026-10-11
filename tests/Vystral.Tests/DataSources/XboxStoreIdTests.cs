using System.Net;
using System.Text.Json.Nodes;
using Vystral.Core.Cloud;
using Vystral.Core.Domain;
using Vystral.Tests.SteamAccount;
using Vystral.Tests.Support;
using Vystral.Windows.DataSources;
using Vystral.Windows.DataSources.Identity;
using Vystral.Windows.Services;
using Xunit;

namespace Vystral.Tests.DataSources;

/// <summary>
/// Track E4: Xbox Store IDs for exact matching. <c>Fixtures/E4/msstore_lookup_fh4.json</c> is the live display-catalogue answer
/// for Forza Horizon 4's package (<c>Microsoft.SunriseBaseGame_8wekyb3d8bbwe</c>), captured on 2026-10-11 and trimmed to the
/// fields VYSTRAL reads; <c>msstore_lookup_none.json</c> is the live answer for a family name the Store doesn't know. The
/// Wikidata answer below is the live answer to the same query shape on that day; the IGDB answers are hand-written from
/// IGDB's documented shapes (no Twitch app was used).
/// </summary>
public sealed class XboxStoreParsingTests
{
    public const string Fh4Pfn = "Microsoft.SunriseBaseGame_8wekyb3d8bbwe";
    public const string Fh4Product = "9PNQKHFLD2WQ";
    /// <summary>"Forza Horizon 4 Standard Edition", a bundle that contains the base game (the ID Wikidata lists).</summary>
    public const string Fh4Standard = "9PNJXVCVWD4K";

    internal static string Fixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "E4", name));

    /// <summary>The live Wikidata answer for P5885 = 9pnjxvcvwd4k (2026-10-11), in the client's query shape.</summary>
    public const string WikidataFh4 = """
        {"head":{"vars":["key","item","lbl","game","v_steam","v_igdb"]},"results":{"bindings":[{
          "key":{"type":"literal","value":"9PNJXVCVWD4K"},
          "item":{"type":"uri","value":"http://www.wikidata.org/entity/Q54893555"},
          "lbl":{"xml:lang":"mul","type":"literal","value":"Forza Horizon 4"},
          "game":{"type":"literal","value":"1"},
          "v_steam":{"type":"literal","value":"1293830"},
          "v_igdb":{"type":"literal","value":"forza-horizon-4"}}]}}
        """;

    [Fact]
    public void The_lookup_names_forza_horizon_4s_product_its_bundles_and_its_store_art()
    {
        var p = XboxStoreLookupClient.Parse(Fixture("msstore_lookup_fh4.json"), Fh4Pfn);
        Assert.NotNull(p);
        Assert.Equal((Fh4Product, Fh4Pfn, "Forza Horizon 4", "Game"), (p.ProductId, p.Pfn, p.Title, p.Kind));
        Assert.Equal(12, p.Bundles.Count);
        Assert.Contains(Fh4Standard, p.Bundles);
        Assert.DoesNotContain(Fh4Product, p.Bundles);
        Assert.All(new[] { p.Poster, p.Hero, p.Logo }, u => Assert.StartsWith("https://store-images.s-microsoft.com/image/apps.", u));
        Assert.Contains("ba2a2523", p.Poster); // the 2:3 Poster, not the square BoxArt
        Assert.Contains("778dc4d6", p.Hero);   // SuperHeroArt, not the TitledHeroArt with the name baked in

        // The family name is compared without regard to case (Windows doesn't care either).
        Assert.Equal(Fh4Product, XboxStoreLookupClient.Parse(Fixture("msstore_lookup_fh4.json"), Fh4Pfn.ToLowerInvariant())!.ProductId);
    }

    [Fact]
    public void Unknown_packages_other_packages_and_broken_answers_are_handled()
    {
        Assert.Null(XboxStoreLookupClient.Parse(Fixture("msstore_lookup_none.json"), "Contoso.NotAGame_8wekyb3d8bbwe"));
        // An answer about another package never counts for this one.
        Assert.Null(XboxStoreLookupClient.Parse(Fixture("msstore_lookup_fh4.json"), "Microsoft.624F8B84B80_8wekyb3d8bbwe"));
        Assert.Throws<DataSourceException>(() => XboxStoreLookupClient.Parse("{}", Fh4Pfn));
        Assert.Throws<DataSourceException>(() => XboxStoreLookupClient.Parse("[]", Fh4Pfn));
        Assert.Throws<DataSourceException>(() => XboxStoreLookupClient.Parse("not json", Fh4Pfn));
        // Wrong types and unsafe values are dropped, not trusted.
        var hostile = """
            {"Products":[{"ProductId":"9PNQKHFLD2WQ","Properties":{"PackageFamilyName":"Microsoft.SunriseBaseGame_8wekyb3d8bbwe"},"ProductKind":"<b>",
              "MarketProperties":[{"RelatedProducts":[{"RelatedProductId":"bad","RelationshipType":"Bundle"},{"RelatedProductId":"9PNJXVCVWD4K","RelationshipType":"Parent"}]}],
              "LocalizedProperties":[{"ProductTitle":"Forza\u0007 Horizon 4","Images":[{"ImagePurpose":"Poster","Uri":"https://evil.example/image/apps.1.2.abcdefgh"},
                {"ImagePurpose":"SuperHeroArt","Uri":"//store-images.s-microsoft.com/image/apps.1.2.abcdefgh?x=1"}]}]}]}
            """;
        var p = XboxStoreLookupClient.Parse(hostile, Fh4Pfn)!;
        Assert.Equal(("Forza Horizon 4", (string?)null), (p.Title, p.Kind));
        Assert.Empty(p.Bundles);
        Assert.Null(p.Poster);
        Assert.Null(p.Hero);
    }

    [Fact]
    public void The_lookup_url_is_built_only_from_validated_values()
    {
        Assert.Equal("https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?alternateId=PackageFamilyName&value=Microsoft.SunriseBaseGame_8wekyb3d8bbwe&market=GB&languages=en-us&fieldsTemplate=details",
            XboxStoreLookupClient.LookupUri(Fh4Pfn, "GB").AbsoluteUri);
        Assert.Throws<ArgumentException>(() => XboxStoreLookupClient.LookupUri("Microsoft.SunriseBaseGame_8wekyb3d8bbwe&market=XX", "US"));
        Assert.Throws<ArgumentException>(() => XboxStoreLookupClient.LookupUri("../../x_8wekyb3d8bbwe", "US"));
        Assert.Throws<ArgumentException>(() => XboxStoreLookupClient.LookupUri(Fh4Pfn, "us"));
    }

    [Fact]
    public void Cached_answers_are_validated_again_when_read()
    {
        var good = XboxStoreCacheEntry.From(Fh4Pfn, XboxStoreLookupClient.Parse(Fixture("msstore_lookup_fh4.json"), Fh4Pfn));
        var round = XboxStoreCacheEntry.Read(System.Text.Json.JsonSerializer.Serialize(good, JsonFileCache.Options))!;
        Assert.Equal((Fh4Product, 12), (round.ProductId, round.Bundles.Count));

        var tampered = XboxStoreCacheEntry.Read("""
            {"v":1,"pfn":"Microsoft.SunriseBaseGame_8wekyb3d8bbwe","productId":"9PNQKHFLD2WQ","title":"x\u0000","bundles":["9PNQKHFLD2WQ","nope","9PNJXVCVWD4K"],
             "poster":"https://evil.example/a.png","hero":"javascript:alert(1)"}
            """)!;
        Assert.Equal(["9PNJXVCVWD4K"], tampered.Bundles);
        Assert.Null(tampered.Title);
        Assert.Null(tampered.Poster);
        Assert.Null(tampered.Hero);
        Assert.Null(XboxStoreCacheEntry.Read("""{"v":1,"pfn":"not a pfn","productId":"9PNQKHFLD2WQ"}"""));
        Assert.Null(XboxStoreCacheEntry.Read("""{"v":1,"pfn":"Microsoft.SunriseBaseGame_8wekyb3d8bbwe","productId":"lowercase1234"}""")!.ProductId);
        Assert.Null(XboxStoreCacheEntry.Read("{"));
    }

    [Fact]
    public void Wikidata_is_asked_by_store_product_in_both_cases_and_answers_in_upper_case()
    {
        var q = WikidataClient.BuildQuery("microsoft", [Fh4Product, Fh4Standard, "9pnqkhfld2wq", "\" } DELETE {"])!;
        Assert.Contains("\"9PNQKHFLD2WQ\" \"9pnqkhfld2wq\"", q);
        Assert.Contains("\"9PNJXVCVWD4K\" \"9pnjxvcvwd4k\"", q);
        Assert.Contains("wdt:P5885 ?raw . BIND(UCASE(STR(?raw)) AS ?key)", q);
        Assert.DoesNotContain("DELETE", q);
        Assert.Null(WikidataClient.BuildQuery("microsoft", ["9pnqkhfld2wq"])); // keys are upper case

        var ids = WikidataClient.Parse(WikidataFh4, [Fh4Product, Fh4Standard], "microsoft");
        Assert.Equal(2, ids.Count);
        Assert.Null(ids.Single(i => i.Key == Fh4Product).ItemId);
        var std = ids.Single(i => i.Key == Fh4Standard);
        Assert.Equal(("Q54893555", "Forza Horizon 4", "1293830"), (std.ItemId, std.Label, std.Ids["steam"]));
    }

    [Fact]
    public void Igdb_is_asked_by_store_product_in_both_cases_with_the_documented_sources()
    {
        var q = IgdbClient.BuildMicrosoftStoreQuery([Fh4Product, Fh4Standard]);
        Assert.Contains("where external_game_source = (11,31,54) & uid = (\"9PNQKHFLD2WQ\",\"9pnqkhfld2wq\",\"9PNJXVCVWD4K\",\"9pnjxvcvwd4k\")", q);
        Assert.Contains("game.external_games.uid", q);
        Assert.Throws<ArgumentException>(() => IgdbClient.BuildMicrosoftStoreQuery(["9PNQ\"; fields *"]));
        Assert.Throws<ArgumentException>(() => IgdbClient.BuildMicrosoftStoreQuery([]));
    }

    private const string IgdbRow = """
        {"id":1,"uid":"%UID%","external_game_source":%SRC%,"game":{"id":%GAME%,"name":"%NAME%","first_release_date":1538697600,
          "external_games":[{"id":2,"uid":"%STEAM%","external_game_source":1},{"id":3,"uid":"1207658930","external_game_source":5},{"id":4,"uid":"junk","external_game_source":1}]}}
        """;

    private static string Row(string uid, long game, string name = "Forza Horizon 4", string steam = "1293830", int src = 11) =>
        IgdbRow.Replace("%UID%", uid).Replace("%GAME%", game.ToString()).Replace("%NAME%", name).Replace("%STEAM%", steam).Replace("%SRC%", src.ToString());

    [Fact]
    public void Igdb_rows_for_the_product_win_bundles_must_agree_and_other_sources_are_ignored()
    {
        // The product itself (IGDB's case doesn't matter), with the game's own Steam and GOG entries one link further.
        var own = XboxStoreEvidence.ParseIgdb($"[{Row("9pnqkhfld2wq", 11160)},{Row(Fh4Standard, 999, "Another")}]", Fh4Product, [Fh4Standard]);
        Assert.Equal(("11160", "product", "1293830", "1207658930", (int?)2018), (own.Igdb, own.Via, own.Steam, own.Gog, own.Year));

        var bundle = XboxStoreEvidence.ParseIgdb($"[{Row(Fh4Standard, 11160)}]", Fh4Product, [Fh4Standard, "9N54CX9XJBP6"]);
        Assert.Equal(("11160", "bundle"), (bundle.Igdb, bundle.Via));

        // Two bundles pointing at two games (an "A + B bundle") say nothing.
        Assert.False(XboxStoreEvidence.ParseIgdb($"[{Row(Fh4Standard, 11160)},{Row("9N54CX9XJBP6", 135243, "Forza Horizon 5")}]", Fh4Product, [Fh4Standard, "9N54CX9XJBP6"]).Found);
        // A source that isn't a Microsoft one, and IDs that weren't asked about, are ignored.
        Assert.False(XboxStoreEvidence.ParseIgdb($"[{Row(Fh4Product, 11160, src: 1)}]", Fh4Product, []).Found);
        Assert.False(XboxStoreEvidence.ParseIgdb($"[{Row("9ZZZZZZZZZZZ", 11160)}]", Fh4Product, []).Found);
        Assert.False(XboxStoreEvidence.ParseIgdb("[]", Fh4Product, []).Found);
        Assert.Throws<DataSourceException>(() => XboxStoreEvidence.ParseIgdb("{}", Fh4Product, []));
    }

    private static XboxStoreCacheEntry Fh4Entry() => XboxStoreCacheEntry.From(Fh4Pfn, XboxStoreLookupClient.Parse(Fixture("msstore_lookup_fh4.json"), Fh4Pfn));

    [Fact]
    public void The_product_id_is_certain_and_wikidata_by_store_id_brings_the_steam_app()
    {
        var wd = WikidataClient.Parse(WikidataFh4, [Fh4Standard], "microsoft").ToDictionary(i => i.Key);
        var evidence = XboxStoreEvidence.Build(Fh4Entry(), k => wd.TryGetValue(k, out var i) ? (i.ItemId, i.Label, i.Ids) : null, null);
        var (ids, _) = IdentityMerge.Merge(evidence);

        var ms = ids.Single(i => i.Kind == IdKinds.MicrosoftStore);
        Assert.Equal((Fh4Product, "native", 1.0), (ms.Value, ms.Status, ms.Confidence));
        Assert.Equal(("msstore", "packageLookup"), (ms.Evidence[0].Source, ms.Evidence[0].Method));

        var steam = ids.Single(i => i.Kind == IdKinds.Steam);
        Assert.Equal(("1293830", "matched", 0.9), (steam.Value, steam.Status, steam.Confidence));
        Assert.Equal(("wikidata", "storeId"), (steam.Evidence[0].Source, steam.Evidence[0].Method));
        Assert.Equal("Q54893555", ids.Single(i => i.Kind == IdKinds.Wikidata).Value);
    }

    [Fact]
    public void Wikidata_by_the_product_beats_bundles_and_disagreeing_bundles_say_nothing()
    {
        IReadOnlyDictionary<string, string> Ids(string steam) => new Dictionary<string, string> { ["steam"] = steam };
        var entry = Fh4Entry();
        var byProduct = XboxStoreEvidence.Build(entry, k => k == Fh4Product ? ("Q1", "FH4", Ids("100")) : k == Fh4Standard ? ("Q2", "Other", Ids("200")) : null, null);
        Assert.Contains(byProduct, e => e is { Kind: "steam", Value: "100", Confidence: 0.95 });
        Assert.DoesNotContain(byProduct, e => e.Value == "200");

        var split = XboxStoreEvidence.Build(entry, k => k == Fh4Standard ? ("Q2", "FH4", Ids("200")) : k == "9N54CX9XJBP6" ? ("Q3", "FH5", Ids("300")) : null, null);
        Assert.Equal(["msstore"], split.Select(e => e.Source).Distinct());

        var none = XboxStoreEvidence.Build(XboxStoreCacheEntry.From(Fh4Pfn, null), _ => ("Q1", "x", Ids("1")), null);
        Assert.Empty(none);
    }

    [Fact]
    public void Igdb_by_store_id_is_high_confidence_and_agrees_with_wikidata()
    {
        var wd = WikidataClient.Parse(WikidataFh4, [Fh4Standard], "microsoft").ToDictionary(i => i.Key);
        var igdb = XboxStoreEvidence.ParseIgdb($"[{Row(Fh4Product, 11160)}]", Fh4Product, [Fh4Standard]);
        var (ids, _) = IdentityMerge.Merge(XboxStoreEvidence.Build(Fh4Entry(), k => wd.TryGetValue(k, out var i) ? (i.ItemId, i.Label, i.Ids) : null, igdb));
        Assert.Equal(("11160", 0.95), (ids.Single(i => i.Kind == IdKinds.Igdb).Value, ids.Single(i => i.Kind == IdKinds.Igdb).Confidence));
        var steam = ids.Single(i => i.Kind == IdKinds.Steam);
        Assert.Equal("1293830", steam.Value);
        Assert.True(steam.Confidence >= 0.99, $"two independent store-ID links should be near certain, was {steam.Confidence}");
        Assert.Equal("high", IdentityResolverService.Level(0.95));
        Assert.Contains(ids, i => i.Kind == IdKinds.Gog && i.Value == "1207658930");
    }

    [Fact]
    public void A_store_fact_beats_any_title_match_and_the_kind_is_validated()
    {
        var (ids, _) = IdentityMerge.Merge([
            new IdEvidence(IdKinds.MicrosoftStore, Fh4Product, "msstore", "packageLookup", 1.0),
            new IdEvidence(IdKinds.MicrosoftStore, "9ZZZZZZZZZZZ", "wikidata", "exactTitleYear", 0.85),
        ]);
        Assert.Equal((Fh4Product, "native"), (ids.Single().Value, ids.Single().Status));
        Assert.False(IdKinds.IsValid(IdKinds.MicrosoftStore, "9pnqkhfld2wq"));
        Assert.False(IdKinds.IsValid(IdKinds.MicrosoftStore, "9PNQKHFLD2W"));
        Assert.Equal("Microsoft Store", IdKinds.Label(IdKinds.MicrosoftStore));
        Assert.Equal("https://apps.microsoft.com/detail/9PNQKHFLD2WQ", IdentityResolverService.LinkFor(IdKinds.MicrosoftStore, Fh4Product));
        Assert.Null(IdentityResolverService.LinkFor(IdKinds.MicrosoftStore, "../x"));
    }
}

public sealed class XboxStoreIdServiceTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly List<Uri> _sent = [];
    private readonly HttpClient _http;
    private readonly SettingsService _settings;
    private readonly DataSourcesService _sources;
    private readonly IdentityResolverService _identity;
    private readonly XboxStoreIdService _store;
    private string _lookupAnswer = XboxStoreParsingTests.Fixture("msstore_lookup_fh4.json");
    private readonly List<string> _changed = [];

    public XboxStoreIdServiceTests()
    {
        _http = new HttpClient(new FakeHandler(Respond));
        _settings = new SettingsService(_t.Repo);
        _settings.Set("dataSaver.onMetered", JsonValue.Create(false));
        _settings.Set("library.fetchMetadata", JsonValue.Create(false)); // keep Steam's title search out of these tests
        var art = new ArtworkService(new AppPaths(Path.Combine(_t.Dir.Path, "data")), _t.Repo, _http);
        _sources = new DataSourcesService(_t.Repo, _settings, art, new FakeSecretStore(), _http);
        foreach (var id in new[] { "wikidata", "steamdeck", "gogcatalog", "igdb", "rawg", "xboxstore" }) _sources.Transport(id).Delay = (_, _) => Task.CompletedTask;
        _identity = new IdentityResolverService(_t.Repo, _settings, _sources, _sources.GogCatalog);
        _store = new XboxStoreIdService(_t.Repo, _settings, _sources, _sources.XboxStore);
        _identity.StoreEvidence = _store.Evidence;
        _identity.StoreLookup = (g, r, ct) => _store.ResolveGameAsync(g, r, ct);
        _store.Changed += (ids, _) => _changed.AddRange(ids);
    }

    public void Dispose()
    {
        _http.Dispose();
        _t.Dispose();
    }

    private HttpResponseMessage Respond(HttpRequestMessage r)
    {
        lock (_sent) _sent.Add(r.RequestUri!);
        if (r.RequestUri!.Host == XboxStoreLookupClient.Host) return FakeHandler.Json(HttpStatusCode.OK, _lookupAnswer);
        if (r.RequestUri.Host == "query.wikidata.org")
        {
            var body = r.Content!.ReadAsStringAsync().Result;
            // The store-ID query (P5885) gets the live answer; Wikidata's title search finds nothing.
            return FakeHandler.Json(HttpStatusCode.OK, body.Contains("P5885+%3Fraw", StringComparison.Ordinal) || body.Contains("P5885 ?raw", StringComparison.Ordinal)
                ? XboxStoreParsingTests.WikidataFh4 : """{"results":{"bindings":[]}}""");
        }
        return FakeHandler.Json(HttpStatusCode.NotFound, "{}");
    }

    private int StoreRequests() { lock (_sent) return _sent.Count(u => u.Host == XboxStoreLookupClient.Host); }

    private string Forza()
    {
        _t.Repo.ApplyScan([TestDb.Ok(PlatformId.Xbox, TestDb.Install(PlatformId.Xbox, XboxStoreParsingTests.Fh4Pfn, "Forza Horizon 4"))]);
        return _t.Repo.LoadSnapshot((_, _) => null).Games.Single(g => g.Title == "Forza Horizon 4").Id;
    }

    [Fact]
    public async Task Forza_horizon_4_gets_its_store_id_by_package_lookup_and_its_steam_app_through_wikidata()
    {
        _settings.Set(XboxStoreIdService.SettingKey, JsonValue.Create(true));
        var gameId = Forza();
        var dto = await _identity.GetAsync(gameId, allowNetwork: true, refresh: false, CancellationToken.None);

        var ms = dto.Ids.Single(i => i.Kind == IdKinds.MicrosoftStore);
        Assert.Equal((XboxStoreParsingTests.Fh4Product, "native", "certain", true, "Microsoft Store"), (ms.Value, ms.Status, ms.Level, ms.Used, ms.Label));
        Assert.Equal(("msstore", "packageLookup"), (ms.Evidence[0].Source, ms.Evidence[0].Method));
        Assert.True(ms.Link);
        Assert.Equal("matched", dto.Status);
        Assert.Equal("1293830", dto.Steam!.Value);
        Assert.Contains(dto.Steam.Evidence, e => e is { Source: "wikidata", Method: "storeId" });
        Assert.Equal("1293830", _identity.SteamAppIdFor(gameId));
        Assert.Contains(gameId, _changed);

        // The exact product → package map for Game Pass and GeForce NOW: the product and its bundles.
        var map = _store.ProductPfns();
        Assert.Equal(XboxStoreParsingTests.Fh4Pfn, map[XboxStoreParsingTests.Fh4Product]);
        Assert.Equal(XboxStoreParsingTests.Fh4Pfn, map[XboxStoreParsingTests.Fh4Standard]);

        // Cached for months: the next visit doesn't ask the Store again.
        var before = StoreRequests();
        await _identity.GetAsync(gameId, allowNetwork: true, refresh: false, CancellationToken.None);
        Assert.Equal(before, StoreRequests());
        Assert.Equal(1, before);
    }

    [Fact]
    public async Task Off_offline_and_running_games_send_nothing_to_the_store()
    {
        var gameId = Forza();
        await _identity.GetAsync(gameId, true, false, CancellationToken.None); // off by default
        Assert.Equal(0, StoreRequests());
        Assert.DoesNotContain((await _identity.GetAsync(gameId, false, false, CancellationToken.None)).Ids, i => i.Kind == IdKinds.MicrosoftStore);

        _settings.Set(XboxStoreIdService.SettingKey, JsonValue.Create(true));
        _settings.Set("privacy.localOnly", JsonValue.Create(true));
        Assert.False(await _store.ResolveGameAsync(gameId, false, CancellationToken.None));
        Assert.Equal(0, await _store.RefreshLibraryAsync(10, () => false, CancellationToken.None));
        _settings.Set("privacy.localOnly", JsonValue.Create(false));
        _store.IsGameActive = () => true;
        Assert.False(await _store.ResolveGameAsync(gameId, false, CancellationToken.None));
        Assert.Equal(0, StoreRequests());
    }

    [Fact]
    public async Task A_package_the_store_doesnt_list_is_remembered_as_not_listed()
    {
        _settings.Set(XboxStoreIdService.SettingKey, JsonValue.Create(true));
        _lookupAnswer = XboxStoreParsingTests.Fixture("msstore_lookup_none.json");
        var gameId = Forza();
        Assert.Equal(1, await _store.RefreshLibraryAsync(10, () => false, CancellationToken.None));
        Assert.Null(_store.EntryFor(gameId));
        Assert.Empty(_store.Evidence(gameId));
        Assert.Empty(_store.ProductPfns());
        Assert.Equal(0, await _store.RefreshLibraryAsync(10, () => false, CancellationToken.None)); // not due again
        Assert.Equal(1, StoreRequests());
    }

    [Fact]
    public async Task A_broken_answer_keeps_what_was_known()
    {
        _settings.Set(XboxStoreIdService.SettingKey, JsonValue.Create(true));
        var gameId = Forza();
        await _store.ResolveGameAsync(gameId, false, CancellationToken.None);
        _lookupAnswer = "{\"oops\":true}";
        await _store.ResolveGameAsync(gameId, refresh: true, CancellationToken.None);
        Assert.Equal(XboxStoreParsingTests.Fh4Product, _store.EntryFor(gameId)!.ProductId);
    }

    [Fact]
    public async Task Exact_ids_match_geforce_now_xbox_variants_listed_under_a_bundle()
    {
        _settings.Set(XboxStoreIdService.SettingKey, JsonValue.Create(true));
        var gameId = Forza();
        await _store.ResolveGameAsync(gameId, false, CancellationToken.None);
        // GeForce NOW lists the game under its "Standard Edition" product; the catalogue's forward lookup has no package for it.
        var entry = new CloudCatalogEntry(CloudServices.GeForceNow, "4b7c3f4e-6b5e-4f0e-9c7a-1d2e3f4a5b6c", "100001", "Forza Horizon 4 Standard Edition", CloudPlayTypes.Ready, false,
            [new CloudStoreLink(CloudStores.Xbox, XboxStoreParsingTests.Fh4Standard)]);
        var match = Assert.Single(CloudMatcher.Match(CloudServices.GeForceNow, [entry], _t.Repo.GetCloudLibrary(), _store.ProductPfns()));
        Assert.Equal((gameId, CloudMatchKind.StoreId), (match.GameId, match.Kind));
        // Without the Store's answer it isn't matched at all (GeForce NOW never guesses Xbox copies by title).
        Assert.Empty(CloudMatcher.Match(CloudServices.GeForceNow, [entry], _t.Repo.GetCloudLibrary(), new Dictionary<string, string>()));
    }

    [Fact]
    public async Task Store_art_replaces_only_weak_art()
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0 };
        var requested = new List<Uri>();
        using var http = new HttpClient(new FakeHandler(r =>
        {
            lock (requested) requested.Add(r.RequestUri!);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(png) { Headers = { ContentType = new("image/png") } }, RequestMessage = r };
        }));
        var art = new ArtworkService(new AppPaths(Path.Combine(_t.Dir.Path, "data2")), _t.Repo, http);
        var gameId = Forza();
        _t.Repo.SetArtwork(gameId, ArtworkKind.Cover, "x/cover.png", "xbox-local", isUser: false);
        _t.Repo.SetArtwork(gameId, ArtworkKind.Hero, "x/hero.png", "user", isUser: true);
        var e = XboxStoreCacheEntry.From(XboxStoreParsingTests.Fh4Pfn, XboxStoreLookupClient.Parse(XboxStoreParsingTests.Fixture("msstore_lookup_fh4.json"), XboxStoreParsingTests.Fh4Pfn));

        Assert.Equal(2, await art.ApplyXboxStoreArtAsync(gameId, e.Poster, e.Hero, e.Logo, CancellationToken.None)); // cover + icon, not your hero
        var sources = _t.Repo.GetArtworkSources(gameId);
        Assert.Equal(ArtworkService.XboxStoreArtSource, sources["cover"].Source);
        Assert.Equal(ArtworkService.XboxStoreArtSource, sources["icon"].Source);
        Assert.True(sources["hero"].IsUser);
        Assert.All(requested, u => Assert.Equal("store-images.s-microsoft.com", u.Host));
        Assert.Contains(requested, u => u.Query == "?w=600&h=900&q=90");

        // Store art isn't weak: asked again, nothing is downloaded.
        requested.Clear();
        Assert.Equal(0, await art.ApplyXboxStoreArtAsync(gameId, e.Poster, e.Hero, e.Logo, CancellationToken.None));
        Assert.Empty(requested);
        // Unsafe URLs are never fetched.
        Assert.Equal(0, await art.ApplyXboxStoreArtAsync(Forza(), "https://evil.example/x.png", null, null, CancellationToken.None));
        Assert.Empty(requested);
    }
}
